import { init } from "./z3-solver-browser.js";

const SPECS = {
  msr110: { name: "MSR 110g", capacity: 110, emptyWeight: 101 },
  msr227: { name: "MSR 227g", capacity: 227, emptyWeight: 147 },
  msr450: { name: "MSR 450g", capacity: 450, emptyWeight: 216 },
};

let z3CtxPromise = null;

async function ensureCtx() {
  if (z3CtxPromise) return z3CtxPromise;
  z3CtxPromise = (async () => {
    const { Context } = await init();
    return new Context("fuel-can");
  })();
  return z3CtxPromise;
}

function parseLine(raw) {
  if (!raw.trim()) return [];
  return raw
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((v) => {
      const n = Number(v);
      if (!Number.isFinite(n)) {
        throw new Error(`Invalid number "${v}"`);
      }
      return Math.round(n);
    });
}

function buildCans(payload) {
  const cans = [];
  const push = (specKey, grossList) => {
    const spec = SPECS[specKey];
    grossList.forEach((gross) => {
      const fuel = gross - spec.emptyWeight;
      if (fuel < 0) {
        throw new Error(
          `Gross weight ${gross}g for ${spec.name} is lighter than empty weight ${spec.emptyWeight}g`
        );
      }
      cans.push({
        id: "",
        spec,
        gross,
        fuel,
      });
    });
  };
  push("msr110", payload.msr_110 || []);
  push("msr227", payload.msr_227 || []);
  push("msr450", payload.msr_450 || []);
  return cans;
}

function assignIds(cans) {
  cans.forEach((can, idx) => {
    can.id = `Can #${idx + 1} (${can.gross}g start)`;
  });
}

function sum(Int, exprs) {
  if (exprs.length === 0) return Int.val(0);
  return exprs.reduce((acc, e) => acc.add(e));
}

async function solveWithZ3(cans) {
  if (!cans.length) throw new Error("No cans provided");
  const ctx = await ensureCtx();
  const { Optimize, Int } = ctx;
  const opt = new Optimize();
  const n = cans.length;
  const totalFuel = cans.reduce((acc, c) => acc + c.fuel, 0);

  const keepVars = [];
  const fuelVars = [];
  const transferVars = [];
  const pairVars = [];

  for (let d = 0; d < n; d++) {
    const row = [];
    const prow = [];
    for (let r = 0; r < n; r++) {
      const t = Int.const(`t_${d}_${r}`);
      const p = Int.const(`p_${d}_${r}`);
      opt.add(t.ge(0));
      opt.add(p.ge(0));
      opt.add(p.le(1));
      if (d === r) {
        opt.add(t.eq(0));
        opt.add(p.eq(0));
      } else {
        const bigM = Int.val(totalFuel);
        opt.add(t.le(p.mul(bigM)));
      }
      row.push(t);
      prow.push(p);
    }
    transferVars.push(row);
    pairVars.push(prow);
  }

  for (let idx = 0; idx < n; idx++) {
    const can = cans[idx];
    const keep = Int.const(`keep_${idx}`);
    const fuel = Int.const(`fuel_${idx}`);
    opt.add(keep.ge(0));
    opt.add(keep.le(1));
    opt.add(fuel.ge(0));
    opt.add(fuel.le(can.spec.capacity));
    opt.add(fuel.le(keep.mul(can.spec.capacity)));

    const inflow = sum(
      Int,
      transferVars.map((row) => row[idx])
    );
    const outflow = sum(Int, transferVars[idx]);
    const init = Int.val(can.fuel);
    opt.add(fuel.eq(init.add(inflow).sub(outflow)));
    opt.add(outflow.le(init));

    keepVars.push(keep);
    fuelVars.push(fuel);
  }

  const fuelSum = sum(Int, fuelVars);
  opt.add(fuelSum.eq(totalFuel));

  const emptyTerms = keepVars.map((keep, i) => keep.mul(cans[i].spec.emptyWeight));
  const emptyCost = sum(Int, emptyTerms);

  const pairCount = sum(
    Int,
    pairVars.flatMap((row) => row)
  );

  const transferTerms = [];
  for (let d = 0; d < n; d++) {
    for (let r = 0; r < n; r++) {
      if (d === r) continue;
      transferTerms.push(transferVars[d][r]);
    }
  }
  const transferTotal = sum(Int, transferTerms);

  opt.minimize(emptyCost);
  opt.minimize(pairCount);
  opt.minimize(transferTotal);

  const status = await opt.check();
  if (status !== "sat") {
    throw new Error(`Solver returned ${status}`);
  }
  const model = opt.model();

  const intVal = (expr) => {
    const v = model.eval(expr, true).value();
    return typeof v === "bigint" ? Number(v) : Number(v);
  };

  const keepOut = keepVars.map((k) => intVal(k) === 1);
  const fuelOut = fuelVars.map((f) => intVal(f));
  const transfersOut = Array.from({ length: n }, () => Array(n).fill(0));
  for (let d = 0; d < n; d++) {
    for (let r = 0; r < n; r++) {
      transfersOut[d][r] = intVal(transferVars[d][r]);
    }
  }

  return {
    keep: keepOut,
    final_fuel: fuelOut,
    transfers: transfersOut,
  };
}

function formatPlan(cans, plan) {
  let out = "";
  const recipients = [];
  cans.forEach((can, idx) => {
    if (plan.keep[idx]) {
      const delta = plan.final_fuel[idx] - can.fuel;
      recipients.push({ idx, can, delta });
    }
  });
  recipients.sort((a, b) => b.delta - a.delta);

  out += "Transfer plan:\n";
  for (const { idx, can, delta } of recipients) {
    if (delta <= 0) continue;
    const targetGross = plan.final_fuel[idx] + can.spec.emptyWeight;
    out += `- ${can.id} (${can.spec.name}): add ${delta} g -> target fuel ${plan.final_fuel[idx]} g (gross ${targetGross} g, start gross ${can.gross} g)\n`;
    const donors = [];
    plan.transfers.forEach((row, dIdx) => {
      const amt = row[idx];
      if (amt > 0 && dIdx !== idx) donors.push({ dIdx, amt });
    });
    donors.sort((a, b) => b.amt - a.amt);
    donors.forEach(({ dIdx, amt }) => {
      const donor = cans[dIdx];
      out += `    from ${donor.id} (${donor.spec.name}): ${amt} g\n`;
    });
  }

  const keptIdxs = plan.keep
    .map((keep, idx) => (keep ? idx : -1))
    .filter((idx) => idx >= 0);
  const totalGross = keptIdxs.reduce(
    (acc, idx) => acc + plan.final_fuel[idx] + cans[idx].spec.emptyWeight,
    0
  );
  out += `\nCarry ${keptIdxs.length} cans, total gross weight ${totalGross} g.\n`;

  out += "\nFinal fuel per can (including empties):\n";
  cans.forEach((can, idx) => {
    const finalFuel = plan.final_fuel[idx];
    const finalGross = finalFuel + can.spec.emptyWeight;
    out += `- ${can.id} (${can.spec.name}): start gross ${can.gross} g, final fuel ${finalFuel} g, final gross ${finalGross} g${
      plan.keep[idx] ? "" : " (left behind)"
    }\n`;
  });

  return out;
}

async function compute(payload) {
  const cans = buildCans(payload);
  assignIds(cans);
  if (!window.crossOriginIsolated) {
    throw new Error(
      "Page is not crossOriginIsolated. Please run `npm start` from the web/ folder and open http://localhost:3000 so COOP/COEP headers enable SharedArrayBuffer (required by Z3 wasm)."
    );
  }
  const plan = await solveWithZ3(cans);
  return formatPlan(cans, plan);
}

const statusEl = document.getElementById("status");
const outputEl = document.getElementById("output");
const form = document.getElementById("pack-form");

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  outputEl.textContent = "";
  outputEl.classList.remove("error");
  statusEl.textContent = "Loading Z3…";
  try {
    const payload = {
      msr_110: parseLine(document.getElementById("gross-110").value),
      msr_227: parseLine(document.getElementById("gross-227").value),
      msr_450: parseLine(document.getElementById("gross-450").value),
    };
    const result = await compute(payload);
    outputEl.textContent = result;
    statusEl.textContent = "Plan ready";
  } catch (err) {
    statusEl.textContent = "Error";
    outputEl.textContent = String(err);
    outputEl.classList.add("error");
  }
});
