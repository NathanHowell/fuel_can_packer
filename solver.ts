// Core solver logic for fuel can packing.

/**
 * Specification for a fuel can type, defining its capacity and weight characteristics.
 */
export interface CanSpec {
  /** Unique identifier for this can specification (e.g., "msr110", "msr227") */
  readonly key: string;
  /** Human-readable name for display (e.g., "MSR 110g", "MSR 227g") */
  readonly name: string;
  /** Maximum fuel capacity in grams */
  readonly capacity: number;
  /** Weight of the empty can in grams */
  readonly emptyWeight: number;
}

/**
 * Represents a physical fuel can with its current state.
 */
export interface Can {
  /** Unique identifier for this can instance */
  id: number;
  /** The specification defining this can's properties */
  spec: CanSpec;
  /** Current amount of fuel in grams (may exceed capacity initially) */
  fuel: number;
  /** Total weight of can including fuel in grams */
  gross: number;
}

interface Edge {
  from: number;
  to: number;
  amt: number;
}

/**
 * A fuel transfer plan that optimally redistributes fuel across cans.
 *
 * The plan minimizes three objectives in lexicographic order:
 * 1. Total empty weight of kept cans
 * 2. Number of transfer operations
 * 3. Total grams of fuel transferred
 */
export interface Plan {
  /** Array indicating which cans to keep (true) or discard (false) */
  keep: readonly boolean[];
  /** Final fuel amount in each can after executing all transfers */
  final_fuel: readonly number[];
  /**
   * Transfer matrix where transfers[i][j] represents grams to transfer from can i to can j.
   * Only non-zero values represent actual transfers.
   */
  transfers: readonly (readonly number[])[];
}

/**
 * Result of computing an optimal fuel transfer plan.
 */
export interface SolutionResult {
  /** The computed transfer plan */
  plan: Plan;
  /** The input cans with assigned IDs */
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

interface GroupedCans {
  spec: CanSpec;
  indices: readonly number[];
}

interface SolverInputs {
  n: number;
  caps: readonly number[];
  empties: readonly number[];
  init: readonly number[];
  totalFuel: number;
}

interface PlanValidationInput {
  keep: readonly boolean[];
  finalFuel: readonly number[];
  transfers: readonly (readonly number[])[];
  caps: readonly number[];
  init: readonly number[];
  totalFuel: number;
}

/**
 * Available fuel can specifications.
 * Currently supports MSR IsoPro canisters in three sizes: 110g, 227g, and 450g.
 */
export const SPECS: readonly CanSpec[] = [
  { key: "msr110", name: "MSR 110g", capacity: 110, emptyWeight: 101 },
  { key: "msr227", name: "MSR 227g", capacity: 227, emptyWeight: 147 },
  { key: "msr450", name: "MSR 450g", capacity: 450, emptyWeight: 216 },
] as const;

export function buildSpecMap(specs: readonly CanSpec[]): ReadonlyMap<string, CanSpec> {
  return new Map(specs.map((spec) => [spec.key, spec]));
}

export const SPEC_BY_KEY: ReadonlyMap<string, CanSpec> = buildSpecMap(SPECS);

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

function emptyPlan(n: number): Plan {
  return { keep: Array(n).fill(false), final_fuel: Array(n).fill(0), transfers: zeros2(n) };
}

function prepareInputs(cans: readonly Can[]): SolverInputs {
  if (!cans.length) {throw new Error("No cans provided");}
  const caps = cans.map((c) => c.spec.capacity);
  const empties = cans.map((c) => c.spec.emptyWeight);
  const init = cans.map((c) => c.fuel);
  const totalFuel = init.reduce((a, b) => a + b, 0);
  return { n: cans.length, caps, empties, init, totalFuel };
}

function groupCansBySpec(cans: readonly Can[], specs: readonly CanSpec[]): GroupedCans[] {
  const grouped: GroupedCans[] = [];
  const indexByKey = new Map<string, number>();

  specs.forEach((spec) => {
    indexByKey.set(spec.key, grouped.length);
    grouped.push({ spec, indices: [] });
  });

  cans.forEach((c, idx) => {
    const key = c.spec.key;
    let groupIdx = indexByKey.get(key);
    if (groupIdx === undefined) {
      groupIdx = grouped.length;
      indexByKey.set(key, groupIdx);
      grouped.push({ spec: c.spec, indices: [] });
    }
    const group = grouped[groupIdx];
    group.indices.push(idx);
  });

  grouped.forEach((group) => {
    group.indices.sort((a, b) => {
      const aFuel = cans[a]?.fuel ?? 0;
      const bFuel = cans[b]?.fuel ?? 0;
      return bFuel - aFuel;
    });
  });

  return grouped;
}

function estimateWorkload(grouped: readonly GroupedCans[], n: number): number {
  const product = grouped.reduce((acc, group) => acc * (group.indices.length + 1), 1);
  // Guard against overflow if specs grow unexpectedly large.
  if (!Number.isFinite(product)) {return Number.MAX_SAFE_INTEGER;}
  return product * n;
}

function buildKeepMask(
  grouped: readonly GroupedCans[],
  keepCounts: readonly number[],
  n: number
): boolean[] {
  const keep: boolean[] = Array<boolean>(n).fill(false);
  for (let i = 0; i < grouped.length; i++) {
    const group = grouped[i];
    const count = keepCounts[i] ?? 0;
    for (const idx of group.indices.slice(0, count)) {
      keep[idx] = true;
    }
  }
  return keep;
}

function capacityAndWeight(
  keep: readonly boolean[],
  caps: readonly number[],
  empties: readonly number[]
): { capSum: number; emptyCost: number } {
  let capSum = 0;
  let emptyCost = 0;
  for (let i = 0; i < keep.length; i++) {
    if (!keep[i]) {continue;}
    const capVal = caps[i];
    const emptyVal = empties[i];
    if (capVal === undefined || emptyVal === undefined) {
      throw new Error("internal: missing can data");
    }
    capSum += capVal;
    emptyCost += emptyVal;
  }
  return { capSum, emptyCost };
}

function buildBaselineAndSlack(
  keep: readonly boolean[],
  init: readonly number[],
  caps: readonly number[]
): { baseline: number[]; slack: Recipient[] } {
  const baseline: number[] = Array<number>(keep.length).fill(0);
  const slack: Recipient[] = [];
  for (let i = 0; i < keep.length; i++) {
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
  return { baseline, slack };
}

function collectDonors(
  keep: readonly boolean[],
  init: readonly number[],
  caps: readonly number[]
): Donor[] {
  const donors: Donor[] = [];
  for (let i = 0; i < keep.length; i++) {
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
  return donors;
}

function buildTransfersMatrix(n: number, edges: readonly Edge[]): number[][] {
  const transfers: number[][] = zeros2(n);
  for (const e of edges) {
    const row = transfers[e.from];
    if (!row) {throw new Error("internal: missing transfer row");}
    const current = row[e.to];
    if (current === undefined) {throw new Error("internal: missing transfer entry");}
    row[e.to] = current + e.amt;
  }
  return transfers;
}

function buildFinalFuel(
  keep: readonly boolean[],
  baseline: readonly number[],
  edges: readonly Edge[],
  n: number
): number[] {
  const finalFuel: number[] = Array<number>(n).fill(0);
  for (let i = 0; i < n; i++) {
    const base = baseline[i];
    if (base === undefined) {throw new Error("internal: missing baseline");}
    finalFuel[i] = keep[i] ? base : 0;
  }
  for (const e of edges) {
    const current = finalFuel[e.to];
    if (current === undefined) {throw new Error("internal: invalid recipient index");}
    finalFuel[e.to] = current + e.amt;
  }
  return finalFuel;
}

function validatePlanState(input: PlanValidationInput): void {
  const { keep, finalFuel, transfers, caps, init, totalFuel } = input;
  for (let i = 0; i < keep.length; i++) {
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
}

function buildPlanForKeep(keep: readonly boolean[], inputs: SolverInputs): BestSolution | null {
  const { caps, empties, init, totalFuel, n } = inputs;
  const { capSum, emptyCost } = capacityAndWeight(keep, caps, empties);
  if (capSum < totalFuel) {return null;}

  const { baseline, slack } = buildBaselineAndSlack(keep, init, caps);
  const donors = collectDonors(keep, init, caps);
  const alloc = allocateMinEdgesAndMinTransfer(donors, slack);
  if (!alloc) {return null;}

  const transfers = buildTransfersMatrix(n, alloc.edges);
  const finalFuel = buildFinalFuel(keep, baseline, alloc.edges, n);
  validatePlanState({ keep, finalFuel, transfers, caps, init, totalFuel });

  const score: Score = [emptyCost, alloc.pairCount, alloc.transferTotal];
  return { score, plan: { keep, final_fuel: finalFuel, transfers } };
}

function findBestPlan(inputs: SolverInputs, grouped: readonly GroupedCans[]): BestSolution | null {
  const groupCount = grouped.length;
  const maxCapSuffix: number[] = Array<number>(groupCount + 1).fill(0);
  for (let i = groupCount - 1; i >= 0; i--) {
    const group = grouped[i];
    const capHere = (group?.spec.capacity ?? 0) * (group?.indices.length ?? 0);
    maxCapSuffix[i] = maxCapSuffix[i + 1] + capHere;
  }

  const keepCounts: number[] = Array<number>(groupCount).fill(0);
  let best: BestSolution | null = null;

  const dfs = (idx: number, capSoFar: number, emptySoFar: number): void => {
    if (idx === groupCount) {
      if (capSoFar < inputs.totalFuel) {return;}
      const keepMask = buildKeepMask(grouped, keepCounts, inputs.n);
      const candidate = buildPlanForKeep(keepMask, inputs);
      if (!candidate) {return;}
      if (!best || lexLess(candidate.score, best.score)) {
        best = candidate;
      }
      return;
    }

    const group = grouped[idx];
    if (!group) {return;}
    const len = group.indices.length;
    const capPer = group.spec.capacity;
    const emptyPer = group.spec.emptyWeight;
    const remainingCap = maxCapSuffix[idx + 1];

    for (let keep = 0; keep <= len; keep++) {
      const newCap = capSoFar + capPer * keep;
      const capNeeded = inputs.totalFuel - newCap;
      if (capNeeded > remainingCap) {continue;}

      const newEmpty = emptySoFar + emptyPer * keep;
      if (best && newEmpty > best.score[0]) {continue;}

      keepCounts[idx] = keep;
      dfs(idx + 1, newCap, newEmpty);
    }
  };

  dfs(0, 0, 0);
  return best;
}

async function solve(cans: readonly Can[], specs: readonly CanSpec[]): Promise<Plan> {
  performance.mark("solver-start");

  const inputs = prepareInputs(cans);
  if (inputs.totalFuel === 0) {
    performance.mark("solver-end");
    performance.measure("solver-total", "solver-start", "solver-end");
    return emptyPlan(inputs.n);
  }

  const grouped = groupCansBySpec(cans, specs);
  const workEstimate = estimateWorkload(grouped, inputs.n);
  if (workEstimate > 5_000_000) {
    throw new Error("Too many cans for the browser solver (try reducing to ~300 cans)");
  }

  performance.mark("solver-search-start");
  const best = findBestPlan(inputs, grouped);
  performance.mark("solver-search-end");
  performance.measure("solver-search", "solver-search-start", "solver-search-end");

  if (!best) {throw new Error("No feasible plan found");}

  performance.mark("solver-end");
  performance.measure("solver-total", "solver-start", "solver-end");

  return best.plan;
}

function assignIds(cans: Can[]): void {
  for (let i = 0; i < cans.length; i++) {
    const can = cans[i];
    if (!can) {continue;}
    if (!Number.isFinite(can.id) || can.id === 0 || can.id === -1) {
      can.id = i + 1;
    }
  }
}

/**
 * Computes an optimal fuel transfer plan that minimizes carried weight.
 *
 * The algorithm uses a greedy search with backtracking to find the plan that:
 * 1. Minimizes total empty can weight (primary objective)
 * 2. Minimizes number of transfer operations (secondary objective)
 * 3. Minimizes total grams transferred (tertiary objective)
 *
 * @param cans - Array of cans with their current fuel levels. Fuel values should be
 *               non-negative. Cans may temporarily exceed capacity during initial state.
 * @returns A promise resolving to the optimal plan and normalized can array
 * @throws {Error} When no cans are provided
 * @throws {Error} When no feasible plan exists (insufficient total capacity)
 * @throws {Error} When input complexity exceeds ~300 cans (workload > 5M operations)
 *
 * @example
 * ```typescript
 * const cans = [
 *   { id: 1, spec: msr227, fuel: 180, gross: 327 },
 *   { id: 2, spec: msr227, fuel: 30, gross: 177 }
 * ];
 * const { plan } = await computePlan(cans);
 * // plan.keep === [true, false]
 * // plan.final_fuel === [210, 0]
 * // plan.transfers[1][0] === 30 (transfer 30g from can 1 to can 0)
 * ```
 */
export async function computePlan(
  cans: readonly Can[],
  specs: readonly CanSpec[] = SPECS
): Promise<SolutionResult> {
  assignIds([...cans]);
  const plan = await solve(cans, specs);
  return { plan, cans };
}
