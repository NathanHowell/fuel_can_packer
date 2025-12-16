const SPECS = [
  { key: "msr110", name: "MSR 110g", capacity: 110, emptyWeight: 101 },
  { key: "msr227", name: "MSR 227g", capacity: 227, emptyWeight: 147 },
  { key: "msr450", name: "MSR 450g", capacity: 450, emptyWeight: 216 },
];

function updateFillIndicator(input) {
  const cell = input.closest(".cell");
  if (!cell) return;
  const raw = input.value.trim();
  if (!raw) {
    cell.style.removeProperty("--fill-pct");
    cell.style.removeProperty("--fill-color");
    return;
  }
  const spec = SPECS.find((s) => s.key === input.dataset.spec);
  const gross = Number(raw);
  if (!spec || !Number.isFinite(gross)) {
    cell.style.removeProperty("--fill-pct");
    cell.style.removeProperty("--fill-color");
    return;
  }
  const fuel = gross - spec.emptyWeight;
  const pct = Math.max(0, Math.min(1, fuel / spec.capacity));
  const hue = 120 * pct; // 0=red, 120=green
  cell.style.setProperty("--fill-pct", `${(pct * 100).toFixed(1)}%`);
  cell.style.setProperty("--fill-color", `hsl(${hue}, 70%, 55%)`);
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

// Pure-JS optimizer: lexicographic comparison for [emptyCost, pairCount, transferTotal]
function lexLess(a, b) {
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return a[i] < b[i];
  }
  return false;
}

// Create n×n zero matrix
function zeros2(n) {
  return Array.from({ length: n }, () => Array(n).fill(0));
}

// Allocate donors to recipients minimizing transfer edges, then total grams
function allocateMinEdgesAndMinTransfer(donors, recipients) {
  // donors: [{ from, amt }]
  // recipients: [{ to, cap }]  cap is remaining receivable slack for transfers
  donors = donors.filter((d) => d.amt > 0);
  recipients = recipients.filter((r) => r.cap > 0);

  const totalNeed = donors.reduce((a, d) => a + d.amt, 0);
  const totalCap = recipients.reduce((a, r) => a + r.cap, 0);
  if (totalNeed === 0) return { edges: [], pairCount: 0, transferTotal: 0 };
  if (totalNeed > totalCap) return null;

  // Sort for faster search: big donors first, big recipients first.
  donors = donors.slice().sort((a, b) => b.amt - a.amt);
  recipients = recipients.slice().sort((a, b) => b.cap - a.cap);

  const R = recipients.length;

  // Upper bound: greedy
  const greedy = (() => {
    const caps = recipients.map((r) => r.cap);
    const edges = [];
    for (const d of donors) {
      let left = d.amt;
      while (left > 0) {
        let best = -1;
        for (let i = 0; i < R; i++) {
          if (caps[i] > 0) {
            best = i;
            break;
          }
        }
        if (best < 0) return null;
        const take = Math.min(left, caps[best]);
        edges.push({ from: d.from, to: recipients[best].to, amt: take });
        caps[best] -= take;
        left -= take;
      }
    }
    const pairCount = edges.length; // greedy may split a lot
    const transferTotal = totalNeed;
    return { edges, pairCount, transferTotal };
  })();

  if (!greedy) return null;

  const edgesLB = donors.length; // each donor needs at least one edge (in this transfer-only subproblem)
  const edgesUB = Math.min(
    greedy.pairCount,
    donors.reduce((acc, d) => acc + Math.min(d.amt, R), 0)
  );

  function keyOf(idx, edgesLeft, caps) {
    return `${idx}|${edgesLeft}|${caps.join(",")}`;
  }

  function sumTopCaps(caps, k) {
    // caps are kept in fixed order (recipients order)
    // take the k largest from caps (k small). Simple O(R log R) is fine for R<=16.
    const tmp = caps.filter((c) => c > 0).sort((a, b) => b - a);
    let s = 0;
    for (let i = 0; i < Math.min(k, tmp.length); i++) s += tmp[i];
    return s;
  }

  function dfs(dIdx, edgesLeft, caps, memo) {
    if (dIdx === donors.length) return [];
    const memoKey = keyOf(dIdx, edgesLeft, caps);
    if (memo.has(memoKey)) return null;

    const remainingDonors = donors.length - dIdx;
    if (edgesLeft < remainingDonors) {
      memo.set(memoKey, 1);
      return null;
    }

    const d = donors[dIdx];
    const need = d.amt;

    // Quick impossibility: even if we use all remaining edges on this donor, can we fit?
    const nonZeroCaps = caps.reduce((a, c) => a + (c > 0 ? 1 : 0), 0);
    if (nonZeroCaps === 0) {
      memo.set(memoKey, 1);
      return null;
    }
    const maxPiecesHere = Math.min(
      need, // each piece >=1g
      nonZeroCaps,
      edgesLeft - (remainingDonors - 1) // must leave >=1 edge for each remaining donor
    );
    if (maxPiecesHere <= 0) {
      memo.set(memoKey, 1);
      return null;
    }

    // Lower bound on pieces for this donor based on current max cap
    const maxCapNow = Math.max(...caps);
    const minPiecesHere = Math.max(1, Math.ceil(need / Math.max(1, maxCapNow)));

    // Try fewer pieces first (minimize edge count)
    for (let pieces = minPiecesHere; pieces <= maxPiecesHere; pieces++) {
      // Another prune: total capacity across best 'pieces' recipients must cover need
      if (sumTopCaps(caps, pieces) < need) continue;

      // Choose 'pieces' recipient indices (combinations), biased toward larger caps.
      const candIdxs = [];
      for (let i = 0; i < R; i++) if (caps[i] > 0) candIdxs.push(i);

      const combo = new Array(pieces);

      function chooseCombo(pos, start) {
        if (pos === pieces) {
          // Check sum caps
          let sum = 0;
          for (let k = 0; k < pieces; k++) sum += caps[combo[k]];
          if (sum < need) return null;

          // Assign positive amounts to each chosen recipient summing to need.
          // Heuristic: fill earlier recipients as much as possible.
          const assigns = new Array(pieces).fill(0);

          function assignAmounts(p, left) {
            if (p === pieces - 1) {
              const idx = combo[p];
              if (left < 1 || left > caps[idx]) return null;
              assigns[p] = left;
              return true;
            }
            const idx = combo[p];
            const capHere = caps[idx];

            // Compute remaining max capacity after this slot
            let restMax = 0;
            for (let q = p + 1; q < pieces; q++) restMax += caps[combo[q]];

            const minHere = Math.max(1, left - restMax);
            const maxHere = Math.min(capHere, left - (pieces - p - 1)); // leave >=1 for each remaining slot
            if (minHere > maxHere) return null;

            for (let x = maxHere; x >= minHere; x--) {
              assigns[p] = x;
              if (assignAmounts(p + 1, left - x)) return true;
            }
            return null;
          }

          if (!assignAmounts(0, need)) return null;

          const nextCaps = caps.slice();
          const edgeList = [];
          for (let k = 0; k < pieces; k++) {
            const ridx = combo[k];
            const amt = assigns[k];
            nextCaps[ridx] -= amt;
            edgeList.push({ from: d.from, to: recipients[ridx].to, amt });
          }

          const tail = dfs(dIdx + 1, edgesLeft - pieces, nextCaps, memo);
          if (!tail) return null;
          return edgeList.concat(tail);
        }

        for (let i = start; i <= candIdxs.length - (pieces - pos); i++) {
          combo[pos] = candIdxs[i];
          const res = chooseCombo(pos + 1, i + 1);
          if (res) return res;
        }
        return null;
      }

      const res = chooseCombo(0, 0);
      if (res) return res;
    }

    memo.set(memoKey, 1);
    return null;
  }

  // Iterative deepening on edge budget to guarantee minimum pairCount
  for (let edgeBudget = edgesLB; edgeBudget <= edgesUB; edgeBudget++) {
    const memo = new Map();
    const caps0 = recipients.map((r) => r.cap);
    const edges = dfs(0, edgeBudget, caps0, memo);
    if (edges) {
      // Among minimal edges (this edgeBudget), transfer grams is fixed = totalNeed.
      // Still, normalize: merge duplicates (same from/to) to keep output clean.
      const merged = new Map();
      for (const e of edges) {
        const k = `${e.from}|${e.to}`;
        merged.set(k, (merged.get(k) || 0) + e.amt);
      }
      const out = [];
      for (const [k, amt] of merged.entries()) {
        const [fromS, toS] = k.split("|");
        out.push({ from: Number(fromS), to: Number(toS), amt });
      }
      out.sort((a, b) => b.amt - a.amt);
      return { edges: out, pairCount: out.length, transferTotal: totalNeed };
    }
  }

  // Fallback (should be rare with n<=16): return greedy.
  return greedy;
}

async function solveWithJS(cans) {
  if (!cans.length) throw new Error("No cans provided");
  if (cans.length > 16) throw new Error("Pure-JS solver supports up to 16 cans");

  const n = cans.length;
  const caps = cans.map((c) => c.spec.capacity);
  const empties = cans.map((c) => c.spec.emptyWeight);
  const init = cans.map((c) => c.fuel);
  const totalFuel = init.reduce((a, b) => a + b, 0);

  // totalFuel==0: choose to keep nothing (min empty cost).
  if (totalFuel === 0) {
    return {
      keep: Array(n).fill(false),
      final_fuel: Array(n).fill(0),
      transfers: zeros2(n),
    };
  }

  let best = null;

  const maxMask = 1 << n;
  for (let mask = 1; mask < maxMask; mask++) {
    // capacity feasibility
    let capSum = 0;
    let emptyCost = 0;
    for (let i = 0; i < n; i++) {
      if (mask & (1 << i)) {
        capSum += caps[i];
        emptyCost += empties[i];
      }
    }
    if (capSum < totalFuel) continue;

    const keep = Array(n).fill(false);
    for (let i = 0; i < n; i++) keep[i] = !!(mask & (1 << i));

    // Baseline: keep as much of each kept can's own fuel as possible without transfers.
    const baseline = Array(n).fill(0);
    const slack = [];
    for (let i = 0; i < n; i++) {
      if (!keep[i]) continue;
      baseline[i] = Math.min(init[i], caps[i]);
      const s = caps[i] - baseline[i];
      if (s > 0) slack.push({ to: i, cap: s });
    }

    // Donors for transfers:
    // - any non-kept can must donate all its fuel
    // - any overfull kept can donates its excess above capacity
    const donors = [];
    for (let i = 0; i < n; i++) {
      if (!keep[i]) {
        if (init[i] > 0) donors.push({ from: i, amt: init[i] });
      } else {
        const excess = Math.max(0, init[i] - caps[i]);
        if (excess > 0) donors.push({ from: i, amt: excess });
      }
    }

    const alloc = allocateMinEdgesAndMinTransfer(donors, slack);
    if (!alloc) continue;

    const transfers = zeros2(n);
    for (const e of alloc.edges) transfers[e.from][e.to] += e.amt;

    const finalFuel = Array(n).fill(0);
    for (let i = 0; i < n; i++) finalFuel[i] = keep[i] ? baseline[i] : 0;
    for (const e of alloc.edges) finalFuel[e.to] += e.amt;

    // Sanity checks
    for (let i = 0; i < n; i++) {
      if (!keep[i] && finalFuel[i] !== 0) {
        throw new Error("internal: non-kept can ended with fuel");
      }
      if (keep[i] && (finalFuel[i] < 0 || finalFuel[i] > caps[i])) {
        throw new Error("internal: capacity violation");
      }
      const out = transfers[i].reduce((a, b) => a + b, 0);
      if (out > init[i]) throw new Error("internal: outflow > initial fuel");
    }
    const sumFinal = finalFuel.reduce((a, b) => a + b, 0);
    if (sumFinal !== totalFuel) throw new Error("internal: fuel not conserved");

    const score = [emptyCost, alloc.pairCount, alloc.transferTotal];
    if (!best || lexLess(score, best.score)) {
      best = {
        score,
        plan: { keep, final_fuel: finalFuel, transfers },
      };
    }
  }

  if (!best) throw new Error("No feasible plan found (total fuel exceeds available kept capacity?)");
  return best.plan;
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
    if (!plan.keep[i] || outgoing > 0) {
      donors.push({ idx: i, total: outgoing });
    }
    if (plan.keep[i]) {
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
    const fuelBasis = plan.keep[node.idx] ? targetFuel : can.fuel;
    const pct = Math.max(0, Math.min(1, fuelBasis / can.spec.capacity));
    const hue = 120 * pct;
    div.style.setProperty("--fill-pct", `${(pct * 100).toFixed(1)}%`);
    div.style.setProperty("--fill-color", `hsl(${hue}, 70%, 55%)`);
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
  const plan = await solveWithJS(cans);
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
  updateFillIndicator(input);
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
    const input = cell.querySelector("input");
    input.addEventListener("input", () => {
      updateFillIndicator(input);
      syncColumn(specKey);
    });
    container.appendChild(cell);
    inputs.push(input);
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
  // Update indicators in case ordering changed.
  container.querySelectorAll("input").forEach(updateFillIndicator);
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
  statusEl.textContent = "Solving…";
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
