// Types
interface CanSpec {
  readonly key: string;
  readonly name: string;
  readonly capacity: number;
  readonly emptyWeight: number;
}

interface Can {
  id: number;
  spec: CanSpec;
  fuel: number;
  gross: number;
}

interface Edge {
  from: number;
  to: number;
  amt: number;
}

interface Plan {
  keep: readonly boolean[];
  final_fuel: readonly number[];
  transfers: readonly (readonly number[])[];
}

interface SolutionResult {
  plan: Plan;
  cans: readonly Can[];
}

interface Donor {
  from: number;
  amt: number;
}

interface Recipient {
  to: number;
  cap: number;
}

interface AllocationResult {
  edges: readonly Edge[];
  pairCount: number;
  transferTotal: number;
}

type Score = readonly [number, number, number];

interface BestSolution {
  score: Score;
  plan: Plan;
}

// Constants
const SPECS: readonly CanSpec[] = [
  { key: "msr110", name: "MSR 110g", capacity: 110, emptyWeight: 101 },
  { key: "msr227", name: "MSR 227g", capacity: 227, emptyWeight: 147 },
  { key: "msr450", name: "MSR 450g", capacity: 450, emptyWeight: 216 },
] as const;

// Utilities
function lexLess(a: Score, b: Score): boolean {
  if (a[0] !== b[0]) {return a[0] < b[0];}
  if (a[1] !== b[1]) {return a[1] < b[1];}
  if (a[2] !== b[2]) {return a[2] < b[2];}
  return false;
}

function zeros2(n: number): number[][] {
  return Array.from({ length: n }, () => Array<number>(n).fill(0));
}

function allocateMinEdgesAndMinTransfer(
  donorsInput: readonly Donor[],
  recipientsInput: readonly Recipient[]
): AllocationResult | null {
  let donors = donorsInput.filter((d) => d.amt > 0);
  let recipients = recipientsInput.filter((r) => r.cap > 0);

  const totalNeed = donors.reduce((a, d) => a + d.amt, 0);
  const totalCap = recipients.reduce((a, r) => a + r.cap, 0);
  if (totalNeed === 0) {return { edges: [], pairCount: 0, transferTotal: 0 };}
  if (totalNeed > totalCap) {return null;}

  donors = donors.slice().sort((a, b) => b.amt - a.amt);
  recipients = recipients.slice().sort((a, b) => b.cap - a.cap);

  const R = recipients.length;

  const greedy = ((): AllocationResult | null => {
    const caps = recipients.map((r) => r.cap);
    const edges: Edge[] = [];
    for (const d of donors) {
      let left = d.amt;
      while (left > 0) {
        let best = -1;
        for (let i = 0; i < R; i++) {
          const cap = caps[i];
          if (cap !== undefined && cap > 0) {
            best = i;
            break;
          }
        }
        if (best < 0) {return null;}
        const capAtBest = caps[best];
        const recipient = recipients[best];
        if (capAtBest === undefined || recipient === undefined) {return null;}
        const take = Math.min(left, capAtBest);
        edges.push({ from: d.from, to: recipient.to, amt: take });
        caps[best] = capAtBest - take;
        left -= take;
      }
    }
    const pairCount = edges.length;
    const transferTotal = totalNeed;
    return { edges, pairCount, transferTotal };
  })();

  if (!greedy) {return null;}

  const edgesLB = donors.length;
  const edgesUB = Math.min(
    greedy.pairCount,
    donors.reduce((acc, d) => acc + Math.min(d.amt, R), 0)
  );

  function keyOf(idx: number, edgesLeft: number, caps: readonly number[]): string {
    return `${idx}|${edgesLeft}|${caps.join(",")}`;
  }

  function sumTopCaps(caps: readonly number[], k: number): number {
    const tmp = caps.filter((c) => c > 0).sort((a, b) => b - a);
    let s = 0;
    for (const cap of tmp.slice(0, Math.min(k, tmp.length))) {s += cap;}
    return s;
  }

  function dfs(
    dIdx: number,
    edgesLeft: number,
    caps: readonly number[],
    memo: Map<string, number>
  ): readonly Edge[] | null {
    if (dIdx === donors.length) {return [];}
    const memoKey = keyOf(dIdx, edgesLeft, caps);
    if (memo.has(memoKey)) {return null;}

    const remainingDonors = donors.length - dIdx;
    if (edgesLeft < remainingDonors) {
      memo.set(memoKey, 1);
      return null;
    }

    const d = donors[dIdx];
    if (!d) {
      memo.set(memoKey, 1);
      return null;
    }
    const donor = d;
    const need = donor.amt;

    const nonZeroCaps = caps.reduce((a, c) => a + (c > 0 ? 1 : 0), 0);
    if (nonZeroCaps === 0) {
      memo.set(memoKey, 1);
      return null;
    }
    const maxPiecesHere = Math.min(
      need,
      nonZeroCaps,
      edgesLeft - (remainingDonors - 1)
    );
    if (maxPiecesHere <= 0) {
      memo.set(memoKey, 1);
      return null;
    }

    const maxCapNow = Math.max(...caps);
    const minPiecesHere = Math.max(1, Math.ceil(need / Math.max(1, maxCapNow)));

    for (let pieces = minPiecesHere; pieces <= maxPiecesHere; pieces++) {
      if (sumTopCaps(caps, pieces) < need) {continue;}

      const candIdxs: number[] = [];
      for (let i = 0; i < R; i++) {
        const cap = caps[i];
        if (cap !== undefined && cap > 0) {candIdxs.push(i);}
      }

      const combo: number[] = new Array<number>(pieces);

      function chooseCombo(pos: number, start: number): readonly Edge[] | null {
        if (pos === pieces) {
          let sum = 0;
          for (let k = 0; k < pieces; k++) {
            const idx = combo[k];
            if (idx === undefined) {return null;}
            const cap = caps[idx];
            if (cap === undefined) {return null;}
            sum += cap;
          }
          if (sum < need) {return null;}

          const assigns: number[] = new Array<number>(pieces).fill(0);

          function assignAmounts(p: number, left: number): boolean {
            const idx = combo[p];
            if (idx === undefined) {return false;}
            const capHere = caps[idx];
            if (capHere === undefined) {return false;}
            if (p === pieces - 1) {
              if (left < 1 || left > capHere) {return false;}
              assigns[p] = left;
              return true;
            }

            let restMax = 0;
            for (let q = p + 1; q < pieces; q++) {
              const nextIdx = combo[q];
              if (nextIdx === undefined) {return false;}
              const cap = caps[nextIdx];
              if (cap === undefined) {return false;}
              restMax += cap;
            }

            const minHere = Math.max(1, left - restMax);
            const maxHere = Math.min(capHere, left - (pieces - p - 1));
            if (minHere > maxHere) {return false;}

            for (let x = maxHere; x >= minHere; x--) {
              assigns[p] = x;
              if (assignAmounts(p + 1, left - x)) {return true;}
            }
            return false;
          }

          if (!assignAmounts(0, need)) {return null;}

          const nextCaps = caps.slice();
          const edgeList: Edge[] = [];
          for (let k = 0; k < pieces; k++) {
            const ridx = combo[k];
            const amt = assigns[k];
            if (ridx === undefined || amt === undefined) {return null;}
            const nextCap = nextCaps[ridx];
            const recipient = recipients[ridx];
            if (nextCap === undefined || recipient === undefined) {return null;}
            nextCaps[ridx] = nextCap - amt;
            edgeList.push({ from: donor.from, to: recipient.to, amt });
          }

          const tail = dfs(dIdx + 1, edgesLeft - pieces, nextCaps, memo);
          if (!tail) {return null;}
          return [...edgeList, ...tail];
        }

        for (let i = start; i <= candIdxs.length - (pieces - pos); i++) {
          const candIdx = candIdxs[i];
          if (candIdx === undefined) {continue;}
          combo[pos] = candIdx;
          const res = chooseCombo(pos + 1, i + 1);
          if (res) {return res;}
        }
        return null;
      }

      const res = chooseCombo(0, 0);
      if (res) {return res;}
    }

    memo.set(memoKey, 1);
    return null;
  }

  for (let edgeBudget = edgesLB; edgeBudget <= edgesUB; edgeBudget++) {
    const memo = new Map<string, number>();
    const caps0 = recipients.map((r) => r.cap);
    const edges = dfs(0, edgeBudget, caps0, memo);
    if (edges) {
      const merged = new Map<string, number>();
      for (const e of edges) {
        const k = `${e.from}|${e.to}`;
        merged.set(k, (merged.get(k) ?? 0) + e.amt);
      }
      const out: Edge[] = [];
      for (const [k, amt] of merged.entries()) {
        const [fromS, toS] = k.split("|");
        out.push({ from: Number(fromS), to: Number(toS), amt });
      }
      out.sort((a, b) => b.amt - a.amt);
      return { edges: out, pairCount: out.length, transferTotal: totalNeed };
    }
  }

  return greedy;
}

async function solveWithJS(cans: readonly Can[]): Promise<Plan> {
  if (!cans.length) {throw new Error("No cans provided");}
  if (cans.length > 16) {throw new Error("Pure-JS solver supports up to 16 cans");}

  const n = cans.length;
  const caps = cans.map((c) => c.spec.capacity);
  const empties = cans.map((c) => c.spec.emptyWeight);
  const init = cans.map((c) => c.fuel);
  const totalFuel = init.reduce((a, b) => a + b, 0);

  if (totalFuel === 0) {
    return {
      keep: Array(n).fill(false),
      final_fuel: Array(n).fill(0),
      transfers: zeros2(n),
    };
  }

  let best: BestSolution | null = null;

  const maxMask = 1 << n;
  for (let mask = 1; mask < maxMask; mask++) {
    let capSum = 0;
    let emptyCost = 0;
    for (let i = 0; i < n; i++) {
      if (mask & (1 << i)) {
        const capVal = caps[i];
        const emptyVal = empties[i];
        if (capVal === undefined || emptyVal === undefined) {
          throw new Error("internal: missing can data");
        }
        capSum += capVal;
        emptyCost += emptyVal;
      }
    }
    if (capSum < totalFuel) {continue;}

    const keep: boolean[] = Array<boolean>(n).fill(false);
    for (let i = 0; i < n; i++) {keep[i] = !!(mask & (1 << i));}

    const baseline: number[] = Array<number>(n).fill(0);
    const slack: Recipient[] = [];
    for (let i = 0; i < n; i++) {
      if (!keep[i]) {continue;}
      const initVal = init[i];
      const capVal = caps[i];
      if (initVal === undefined || capVal === undefined) {
        throw new Error("internal: missing can data");
      }
      const base = Math.min(initVal, capVal);
      baseline[i] = base;
      const s = capVal - base;
      if (s > 0) {slack.push({ to: i, cap: s });}
    }

    const donors: Donor[] = [];
    for (let i = 0; i < n; i++) {
      const initVal = init[i];
      const capVal = caps[i];
      if (initVal === undefined || capVal === undefined) {
        throw new Error("internal: missing can data");
      }
      if (!keep[i]) {
        if (initVal > 0) {donors.push({ from: i, amt: initVal });}
      } else {
        const excess = Math.max(0, initVal - capVal);
        if (excess > 0) {donors.push({ from: i, amt: excess });}
      }
    }

    const alloc = allocateMinEdgesAndMinTransfer(donors, slack);
    if (!alloc) {continue;}

    const transfers: number[][] = zeros2(n);
    for (const e of alloc.edges) {
      const row = transfers[e.from];
      if (!row) {throw new Error("internal: missing transfer row");}
      const current = row[e.to];
      if (current === undefined) {throw new Error("internal: missing transfer entry");}
      row[e.to] = current + e.amt;
    }

    const finalFuel: number[] = Array<number>(n).fill(0);
    for (let i = 0; i < n; i++) {
      const base = baseline[i];
      if (base === undefined) {throw new Error("internal: missing baseline");}
      finalFuel[i] = keep[i] ? base : 0;
    }
    for (const e of alloc.edges) {
      const current = finalFuel[e.to];
      if (current === undefined) {throw new Error("internal: invalid recipient index");}
      finalFuel[e.to] = current + e.amt;
    }

    for (let i = 0; i < n; i++) {
      const finalFuelVal = finalFuel[i];
      const capVal = caps[i];
      const initVal = init[i];
      if (finalFuelVal === undefined || capVal === undefined || initVal === undefined) {
        throw new Error("internal: missing can data");
      }
      if (!keep[i] && finalFuelVal !== 0) {
        throw new Error("internal: non-kept can ended with fuel");
      }
      if (keep[i] && (finalFuelVal < 0 || finalFuelVal > capVal)) {
        throw new Error("internal: capacity violation");
      }
      const row = transfers[i];
      if (!row) {throw new Error("internal: missing transfer row");}
      const out = row.reduce((a, b) => a + b, 0);
      if (out > initVal) {throw new Error("internal: outflow > initial fuel");}
    }
    const sumFinal = finalFuel.reduce((a, b) => a + b, 0);
    if (sumFinal !== totalFuel) {throw new Error("internal: fuel not conserved");}

    const score: Score = [emptyCost, alloc.pairCount, alloc.transferTotal];
    if (!best || lexLess(score, best.score)) {
      best = {
        score,
        plan: { keep, final_fuel: finalFuel, transfers },
      };
    }
  }

  if (!best) {throw new Error("No feasible plan found");}
  return best.plan;
}

function assignIds(cans: Can[]): void {
  for (let i = 0; i < cans.length; i++) {
    const can = cans[i];
    if (!can) {continue;}
    can.id = i;
  }
}

async function compute(cans: readonly Can[]): Promise<SolutionResult> {
  assignIds([...cans]);
  const plan = await solveWithJS(cans);
  return { plan, cans };
}

function getTransferAmount(plan: Plan, from: number, to: number): number {
  const row = plan.transfers[from];
  return row?.[to] ?? 0;
}

function getFinalFuel(plan: Plan, idx: number): number {
  return plan.final_fuel[idx] ?? 0;
}

// DOM interaction
const formEl = document.getElementById("pack-form") as HTMLFormElement;
const columnsEl = document.getElementById("columns") as HTMLDivElement;
const statusEl = document.getElementById("status") as HTMLDivElement;
const resultsEl = document.getElementById("results") as HTMLDivElement;
const donorColumnEl = document.getElementById("donor-column") as HTMLDivElement;
const recipientColumnEl = document.getElementById("recipient-column") as HTMLDivElement;
const graphGridEl = document.querySelector<HTMLDivElement>(".graph-grid");
const graphSvgEl = document.getElementById("graph-svg") as unknown as SVGSVGElement;
const outputEl = document.getElementById("output") as HTMLPreElement;

// Initialize columns with one can type each
function initializeColumns(): void {
  columnsEl.innerHTML = "";

  for (const spec of SPECS) {
    const col = document.createElement("div");
    col.className = "column";
    col.setAttribute("data-spec", spec.key);

    col.innerHTML = `
      <h2>${spec.name}</h2>
      <p class="hint">Capacity: ${spec.capacity}g • Empty: ${spec.emptyWeight}g</p>
      <div class="cells" data-spec="${spec.key}"></div>
    `;

    columnsEl.appendChild(col);

    // Add one empty cell to start
    addCell(spec.key);
  }
}

function addCell(specKey: string): void {
  const cellsContainer = columnsEl.querySelector(`.cells[data-spec="${specKey}"]`);
  if (!cellsContainer) {return;}

  const cell = document.createElement("div");
  cell.className = "cell";

  const input = document.createElement("input");
  input.type = "number";
  input.name = `gross_${specKey}_${Date.now()}`;
  input.placeholder = "Gross weight (g)";
  input.min = "0";
  input.step = "1";

  // Add another cell when this one is filled
  input.addEventListener("input", () => {
    updateCellFill(cell, input);

    const cells = Array.from(
      cellsContainer.querySelectorAll<HTMLInputElement>(".cell input")
    );
    const lastInput = cells[cells.length - 1];
    if (input.value !== "" && lastInput === input) {
      addCell(specKey);
    }

    // Keep only one trailing empty input
    const updatedInputs = Array.from(
      cellsContainer.querySelectorAll<HTMLInputElement>(".cell input")
    );
    while (updatedInputs.length > 1) {
      const last = updatedInputs.at(-1);
      const prev = updatedInputs.at(-2);
      if (!last || !prev) {break;}
      if (last.value === "" && prev.value === "") {
        last.parentElement?.remove();
        updatedInputs.pop();
        continue;
      }
      break;
    }
  });

  cell.appendChild(input);
  cellsContainer.appendChild(cell);
}

function updateCellFill(cell: HTMLDivElement, input: HTMLInputElement): void {
  const specKey = input.name.split("_")[1];
  const spec = SPECS.find((s) => s.key === specKey);
  if (!spec) {return;}

  const gross = parseFloat(input.value) || 0;
  const fuel = Math.max(0, gross - spec.emptyWeight);
  const fillPct = (fuel / spec.capacity) * 100;

  cell.style.setProperty("--fill-pct", `${Math.min(fillPct, 100)}%`);
  cell.style.setProperty("--fill-color", fillPct > 100 ? "var(--danger)" : "var(--accent)");
}

formEl.addEventListener("submit", async (e: Event) => {
  e.preventDefault();

  // Gather all filled cans
  const cans: Can[] = [];

  for (const spec of SPECS) {
    const cells = columnsEl.querySelectorAll<HTMLInputElement>(`.cells[data-spec="${spec.key}"] input`);

    for (const input of Array.from(cells)) {
      const gross = parseFloat(input.value);
      if (!isNaN(gross) && gross > 0) {
        const fuel = Math.max(0, gross - spec.emptyWeight);
        cans.push({ id: -1, spec, fuel, gross });
      }
    }
  }

  if (cans.length === 0) {
    statusEl.textContent = "Please enter at least one can";
    statusEl.classList.add("error");
    return;
  }

  statusEl.textContent = "Solving…";
  statusEl.classList.remove("error");
  resultsEl.setAttribute("data-visible", "false");

  try {
    const { plan, cans: canObjects } = await compute(cans);

    // Render graph visualization
    renderGraph(canObjects, plan);

    // Render text output
    renderTextOutput(canObjects, plan);

    // Show results using CSS data attribute
    resultsEl.setAttribute("data-visible", "true");
    statusEl.textContent = "Complete";
  } catch (err: unknown) {
    statusEl.textContent = `Error: ${err instanceof Error ? err.message : String(err)}`;
    statusEl.classList.add("error");
  }
});

function renderGraph(cans: readonly Can[], plan: Plan): void {
  donorColumnEl.innerHTML = "";
  recipientColumnEl.innerHTML = "";
  graphSvgEl.innerHTML = "";
  if (graphGridEl && graphSvgEl.parentElement !== graphGridEl) {
    graphGridEl.appendChild(graphSvgEl);
    graphSvgEl.style.gridColumn = "1 / -1";
    graphSvgEl.style.gridRow = "1 / -1";
  }

  // Separate donors and recipients
  const donors: number[] = [];
  const recipients: number[] = [];

  for (let i = 0; i < cans.length; i++) {
    if (!plan.keep[i]) {
      donors.push(i);
    } else {
      recipients.push(i);
    }
  }

  // Render donor nodes
  for (const idx of donors) {
    const can = cans[idx];
    if (!can) {continue;}
    const node = document.createElement("div");
    node.className = "node";
    node.setAttribute("data-can-id", String(idx));

    const fillPct = (can.fuel / can.spec.capacity) * 100;
    node.style.setProperty("--fill-pct", `${Math.min(fillPct, 100)}%`);
    node.style.setProperty("--fill-color", "var(--accent)");

    node.innerHTML = `
      <strong>Can #${idx + 1}</strong>
      <div class="muted">${can.spec.name}</div>
      <div class="muted">${can.fuel}g → discarded</div>
    `;

    donorColumnEl.appendChild(node);
  }

  // Render recipient nodes
  for (const idx of recipients) {
    const can = cans[idx];
    if (!can) {continue;}
    const finalFuel = getFinalFuel(plan, idx);
    const node = document.createElement("div");
    node.className = "node";
    node.setAttribute("data-can-id", String(idx));

    const fillPct = (finalFuel / can.spec.capacity) * 100;
    node.style.setProperty("--fill-pct", `${Math.min(fillPct, 100)}%`);
    node.style.setProperty("--fill-color", "var(--accent)");

    node.innerHTML = `
      <strong>Can #${idx + 1}</strong>
      <div class="muted">${can.spec.name}</div>
      <div class="muted">${can.fuel}g → ${finalFuel}g</div>
    `;

    recipientColumnEl.appendChild(node);
  }

  // Draw transfer edges
  setTimeout(() => drawEdges(cans, plan, donors, recipients), 0);
}

function drawEdges(cans: readonly Can[], plan: Plan, _donors: number[], _recipients: number[]): void {
  if (!graphGridEl) {return;}

  const gridRect = graphGridEl.getBoundingClientRect();
  const width = Math.max(1, Math.floor(gridRect.width));
  const height = Math.max(1, Math.floor(gridRect.height));
  graphSvgEl.setAttribute("width", String(width));
  graphSvgEl.setAttribute("height", String(height));
  graphSvgEl.setAttribute("viewBox", `0 0 ${width} ${height}`);

  for (let i = 0; i < cans.length; i++) {
    for (let j = 0; j < cans.length; j++) {
      const amt = getTransferAmount(plan, i, j);
      if (amt <= 0) {continue;}

      const fromNode = donorColumnEl.querySelector(`[data-can-id="${i}"]`);
      const toNode = recipientColumnEl.querySelector(`[data-can-id="${j}"]`);

      if (!fromNode || !toNode) {continue;}

      const fromRect = fromNode.getBoundingClientRect();
      const toRect = toNode.getBoundingClientRect();

      const x1 = fromRect.right - gridRect.left;
      const y1 = fromRect.top + fromRect.height / 2 - gridRect.top;
      const x2 = toRect.left - gridRect.left;
      const y2 = toRect.top + toRect.height / 2 - gridRect.top;

      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      const midX = (x1 + x2) / 2;
      path.setAttribute("d", `M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`);
      path.setAttribute("class", "edge");
      graphSvgEl.appendChild(path);

      const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
      text.setAttribute("x", String(midX));
      text.setAttribute("y", String((y1 + y2) / 2 - 4));
      text.setAttribute("text-anchor", "middle");
      text.setAttribute("class", "edge-label");
      text.textContent = `${amt}g`;
      graphSvgEl.appendChild(text);
    }
  }
}

function renderTextOutput(cans: readonly Can[], plan: Plan): void {
  let text = "SOLUTION\n\n";

  text += "Cans to keep:\n";
  for (let i = 0; i < cans.length; i++) {
    if (plan.keep[i]) {
      const can = cans[i];
      if (!can) {continue;}
      const finalFuel = getFinalFuel(plan, i);
      text += `  • Can #${i + 1}: ${can.spec.name} with ${finalFuel}g fuel\n`;
    }
  }

  text += "\nTransfers:\n";
  let hasTransfers = false;
  for (let i = 0; i < cans.length; i++) {
    for (let j = 0; j < cans.length; j++) {
      const amt = getTransferAmount(plan, i, j);
      if (amt > 0) {
        hasTransfers = true;
        text += `  • ${amt}g from Can #${i + 1} to Can #${j + 1}\n`;
      }
    }
  }
  if (!hasTransfers) {
    text += "  • No transfers needed\n";
  }

  const totalFuel = plan.final_fuel.reduce((a, b) => a + b, 0);
  const totalWeight = cans.reduce(
    (sum, can, i) =>
      plan.keep[i] ? sum + can.spec.emptyWeight + getFinalFuel(plan, i) : sum,
    0
  );

  text += `\nTotal fuel: ${totalFuel}g\n`;
  text += `Total weight to carry: ${totalWeight}g\n`;

  outputEl.textContent = text;
}

// Initialize on load
initializeColumns();
