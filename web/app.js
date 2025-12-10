import { init } from "./z3-solver-browser.js";

const SPECS = [
  { key: "msr110", name: "MSR 110g", capacity: 110, emptyWeight: 101 },
  { key: "msr227", name: "MSR 227g", capacity: 227, emptyWeight: 147 },
  { key: "msr450", name: "MSR 450g", capacity: 450, emptyWeight: 216 },
];

let z3CtxPromise = null;

async function ensureCtx() {
  if (z3CtxPromise) return z3CtxPromise;
  z3CtxPromise = (async () => {
    const { Context } = await init();
    return new Context("fuel-can");
  })();
  return z3CtxPromise;
}

function buildCans(payload) {
  const cans = [];
  const push = (specKey, grossList) => {
    const spec = SPECS.find((s) => s.key === specKey);
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

function renderGraph(cans, plan) {
  const donorCol = document.getElementById("donor-column");
  const recipCol = document.getElementById("recipient-column");
  const svg = document.getElementById("graph-svg");
  donorCol.innerHTML = "";
  recipCol.innerHTML = "";
  svg.innerHTML = "";
  if (!plan) return;

  const panelRect = svg.parentElement.getBoundingClientRect();
  const donorRect = donorCol.getBoundingClientRect();
  const recipRect = recipCol.getBoundingClientRect();
  const donorX = donorRect.right - panelRect.left - 8;
  const recipX = recipRect.left - panelRect.left + 8;

  const donors = [];
  const recipients = [];
  const edges = [];

  for (let i = 0; i < cans.length; i++) {
    const outgoing = plan.transfers[i].reduce((a, b) => a + b, 0);
    const incoming = plan.transfers.reduce((a, row) => a + row[i], 0);
    if (outgoing > 0) {
      donors.push({ idx: i, total: outgoing });
    }
    if (plan.keep[i] && incoming > 0) {
      recipients.push({ idx: i, total: incoming });
    }
    for (let j = 0; j < cans.length; j++) {
      const amt = plan.transfers[i][j];
      if (amt > 0) edges.push({ from: i, to: j, amt });
    }
  }

  const makeNode = (node, column) => {
    const div = document.createElement("div");
    div.className = "node";
    div.dataset.idx = String(node.idx);
    const can = cans[node.idx];
    const title = document.createElement("strong");
    title.textContent = can.id;
    const detail = document.createElement("div");
    detail.className = "muted";
    const targetFuel = plan.final_fuel[node.idx];
    const targetGross = targetFuel + can.spec.emptyWeight;
    detail.textContent = `${can.spec.name} — ${targetGross} g gross`;
    div.append(title, detail);
    column.appendChild(div);
    return div;
  };

  const donorEls = donors.map((d) => makeNode(d, donorCol));
  const recipEls = recipients.map((r) => makeNode(r, recipCol));
  if (edges.length === 0) return;

  const centers = new Map();
  [...donorEls, ...recipEls].forEach((el) => {
    const r = el.getBoundingClientRect();
    centers.set(Number(el.dataset.idx), {
      x: r.left + r.width / 2 - panelRect.left,
      y: r.top + r.height / 2 - panelRect.top,
    });
  });

  svg.setAttribute("width", panelRect.width);
  svg.setAttribute("height", panelRect.height);

  edges.forEach((edge) => {
    if (!centers.has(edge.from) || !centers.has(edge.to)) return;
    const a = centers.get(edge.from);
    const b = centers.get(edge.to);
    const x1 = donorX;
    const x2 = recipX;
    const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
    line.setAttribute("x1", x1);
    line.setAttribute("y1", a.y);
    line.setAttribute("x2", x2);
    line.setAttribute("y2", b.y);
    line.setAttribute("class", "edge");
    svg.appendChild(line);

    const label = document.createElementNS("http://www.w3.org/2000/svg", "text");
    label.setAttribute("x", (x1 + x2) / 2);
    label.setAttribute("y", (a.y + b.y) / 2 - 4);
    label.setAttribute("class", "edge-label");
    label.textContent = `${edge.amt} g`;
    svg.appendChild(label);
  });
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
  return { plan, cans };
}

function createInputCell(specKey, idx) {
  const cell = document.createElement("div");
  cell.className = "cell";
  const input = document.createElement("input");
  input.type = "number";
  input.min = "0";
  input.inputMode = "numeric";
  input.id = `${specKey}-${idx}`;
  input.className = "can-input";
  input.dataset.spec = specKey;
  input.placeholder = "gross g";
  input.setAttribute("aria-label", `${specKey} can gross weight`);
  cell.append(input);
  return cell;
}

function syncColumn(specKey) {
  const container = document.querySelector(`[data-column="${specKey}"] .cells`);
  const inputs = Array.from(
    container.querySelectorAll('input[type="number"][data-spec]')
  );
  const filled = inputs.filter((input) => input.value.trim() !== "");
  const desired = filled.length + 1;

  while (inputs.length < desired) {
    const cell = createInputCell(specKey, inputs.length);
    cell.querySelector("input").addEventListener("input", () => syncColumn(specKey));
    container.appendChild(cell);
    inputs.push(cell.querySelector("input"));
  }

  // Remove extra empties while keeping the trailing spare.
  let current = Array.from(
    container.querySelectorAll('input[type="number"][data-spec]')
  );
  while (current.length > desired) {
    const last = current[current.length - 1];
    if (last.value.trim() !== "") break;
    last.parentElement.remove();
    current.pop();
  }
}

function renderColumns() {
  const colWrap = document.getElementById("columns");
  SPECS.forEach((spec) => {
    const col = document.createElement("section");
    col.className = "column";
    col.dataset.column = spec.key;

    const title = document.createElement("h2");
    title.textContent = spec.name;
    const hint = document.createElement("p");
    hint.className = "hint";
    hint.textContent = `Capacity ${spec.capacity} g, empty ${spec.emptyWeight} g`;

    const cells = document.createElement("div");
    cells.className = "cells";
    col.append(title, hint, cells);
    colWrap.appendChild(col);
    syncColumn(spec.key);
  });
}

function readPayload() {
  const payload = { msr_110: [], msr_227: [], msr_450: [] };
  document.querySelectorAll(".can-input").forEach((input) => {
    const value = input.value.trim();
    if (!value) return;
    const n = Number(value);
    if (!Number.isFinite(n)) {
      throw new Error(`Invalid number "${value}"`);
    }
    const rounded = Math.round(n);
    if (input.dataset.spec === "msr110") payload.msr_110.push(rounded);
    if (input.dataset.spec === "msr227") payload.msr_227.push(rounded);
    if (input.dataset.spec === "msr450") payload.msr_450.push(rounded);
  });
  return payload;
}

renderColumns();

const statusEl = document.getElementById("status");
const outputEl = document.getElementById("output");
const form = document.getElementById("pack-form");

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  outputEl.textContent = "";
  outputEl.classList.remove("error");
  statusEl.textContent = "Loading Z3…";
  try {
    const payload = readPayload();
    const { plan, cans } = await compute(payload);
    outputEl.textContent = formatPlan(cans, plan);
    renderGraph(cans, plan);
    statusEl.textContent = "Plan ready";
  } catch (err) {
    statusEl.textContent = "Error";
    outputEl.textContent = String(err);
    outputEl.classList.add("error");
  }
});
