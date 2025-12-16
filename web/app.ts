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
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) {return a[i]! < b[i]!;}
  }
  return false;
}

function zeros2(n: number): number[][] {
  return Array.from({ length: n }, () => Array(n).fill(0));
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
          if (caps[i]! > 0) {
            best = i;
            break;
          }
        }
        if (best < 0) {return null;}
        const take = Math.min(left, caps[best]!);
        edges.push({ from: d.from, to: recipients[best]!.to, amt: take });
        caps[best]! -= take;
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
    for (let i = 0; i < Math.min(k, tmp.length); i++) {s += tmp[i]!;}
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

    const d = donors[dIdx]!;
    const need = d.amt;

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
      for (let i = 0; i < R; i++) {if (caps[i]! > 0) {candIdxs.push(i);}}

      const combo: number[] = new Array(pieces);

      function chooseCombo(pos: number, start: number): readonly Edge[] | null {
        if (pos === pieces) {
          let sum = 0;
          for (let k = 0; k < pieces; k++) {sum += caps[combo[k]!]!;}
          if (sum < need) {return null;}

          const assigns: number[] = new Array(pieces).fill(0);

          function assignAmounts(p: number, left: number): boolean {
            if (p === pieces - 1) {
              const idx = combo[p]!;
              if (left < 1 || left > caps[idx]!) {return false;}
              assigns[p] = left;
              return true;
            }
            const idx = combo[p]!;
            const capHere = caps[idx]!;

            let restMax = 0;
            for (let q = p + 1; q < pieces; q++) {restMax += caps[combo[q]!]!;}

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
            const ridx = combo[k]!;
            const amt = assigns[k]!;
            nextCaps[ridx]! -= amt;
            edgeList.push({ from: d.from, to: recipients[ridx]!.to, amt });
          }

          const tail = dfs(dIdx + 1, edgesLeft - pieces, nextCaps, memo);
          if (!tail) {return null;}
          return [...edgeList, ...tail];
        }

        for (let i = start; i <= candIdxs.length - (pieces - pos); i++) {
          combo[pos] = candIdxs[i]!;
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
        merged.set(k, (merged.get(k) || 0) + e.amt);
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
        capSum += caps[i]!;
        emptyCost += empties[i]!;
      }
    }
    if (capSum < totalFuel) {continue;}

    const keep: boolean[] = Array(n).fill(false);
    for (let i = 0; i < n; i++) {keep[i] = !!(mask & (1 << i));}

    const baseline: number[] = Array(n).fill(0);
    const slack: Recipient[] = [];
    for (let i = 0; i < n; i++) {
      if (!keep[i]) {continue;}
      baseline[i] = Math.min(init[i]!, caps[i]!);
      const s = caps[i]! - baseline[i]!;
      if (s > 0) {slack.push({ to: i, cap: s });}
    }

    const donors: Donor[] = [];
    for (let i = 0; i < n; i++) {
      if (!keep[i]) {
        if (init[i]! > 0) {donors.push({ from: i, amt: init[i]! });}
      } else {
        const excess = Math.max(0, init[i]! - caps[i]!);
        if (excess > 0) {donors.push({ from: i, amt: excess });}
      }
    }

    const alloc = allocateMinEdgesAndMinTransfer(donors, slack);
    if (!alloc) {continue;}

    const transfers: number[][] = zeros2(n);
    for (const e of alloc.edges) {transfers[e.from]![e.to]! += e.amt;}

    const finalFuel: number[] = Array(n).fill(0);
    for (let i = 0; i < n; i++) {finalFuel[i] = keep[i] ? baseline[i]! : 0;}
    for (const e of alloc.edges) {finalFuel[e.to]! += e.amt;}

    for (let i = 0; i < n; i++) {
      if (!keep[i] && finalFuel[i] !== 0) {
        throw new Error("internal: non-kept can ended with fuel");
      }
      if (keep[i] && (finalFuel[i]! < 0 || finalFuel[i]! > caps[i]!)) {
        throw new Error("internal: capacity violation");
      }
      const out = transfers[i]!.reduce((a, b) => a + b, 0);
      if (out > init[i]!) {throw new Error("internal: outflow > initial fuel");}
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
    cans[i]!.id = i;
  }
}

async function compute(cans: readonly Can[]): Promise<SolutionResult> {
  assignIds([...cans]);
  const plan = await solveWithJS(cans);
  return { plan, cans };
}

// DOM interaction
const formEl = document.getElementById("pack-form") as HTMLFormElement;
const columnsEl = document.getElementById("columns") as HTMLDivElement;
const statusEl = document.getElementById("status") as HTMLDivElement;
const resultsEl = document.getElementById("results") as HTMLDivElement;
const donorColumnEl = document.getElementById("donor-column") as HTMLDivElement;
const recipientColumnEl = document.getElementById("recipient-column") as HTMLDivElement;
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
  const cellsContainer = columnsEl.querySelector(`.cells[data-spec="${specKey}"]`)!;
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
    if (input.value && !input.placeholder) {
      const cells = cellsContainer.querySelectorAll(".cell");
      const lastCell = cells[cells.length - 1];
      if (lastCell) {
        const lastInput = lastCell.querySelector("input");
        if (lastInput && lastInput.value) {
          addCell(specKey);
        }
      }
    }

    updateCellFill(cell, input);
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
    const can = cans[idx]!;
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
    const can = cans[idx]!;
    const finalFuel = plan.final_fuel[idx]!;
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
  const svgRect = graphSvgEl.getBoundingClientRect();

  for (let i = 0; i < cans.length; i++) {
    for (let j = 0; j < cans.length; j++) {
      const amt = plan.transfers[i]![j]!;
      if (amt <= 0) {continue;}

      const fromNode = donorColumnEl.querySelector(`[data-can-id="${i}"]`)!;
      const toNode = recipientColumnEl.querySelector(`[data-can-id="${j}"]`)!;

      if (!fromNode || !toNode) {continue;}

      const fromRect = fromNode.getBoundingClientRect();
      const toRect = toNode.getBoundingClientRect();

      const x1 = fromRect.right - svgRect.left;
      const y1 = fromRect.top + fromRect.height / 2 - svgRect.top;
      const x2 = toRect.left - svgRect.left;
      const y2 = toRect.top + toRect.height / 2 - svgRect.top;

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
      const can = cans[i]!;
      text += `  • Can #${i + 1}: ${can.spec.name} with ${plan.final_fuel[i]}g fuel\n`;
    }
  }

  text += "\nTransfers:\n";
  let hasTransfers = false;
  for (let i = 0; i < cans.length; i++) {
    for (let j = 0; j < cans.length; j++) {
      const amt = plan.transfers[i]![j]!;
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
      plan.keep[i] ? sum + can.spec.emptyWeight + plan.final_fuel[i]! : sum,
    0
  );

  text += `\nTotal fuel: ${totalFuel}g\n`;
  text += `Total weight to carry: ${totalWeight}g\n`;

  outputEl.textContent = text;
}

// Initialize on load
initializeColumns();
