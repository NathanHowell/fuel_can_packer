// Core solver logic for fuel can packing.

export interface CanSpec {
  readonly key: string;
  readonly name: string;
  readonly capacity: number;
  readonly emptyWeight: number;
}

export interface Can {
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

export interface Plan {
  keep: readonly boolean[];
  final_fuel: readonly number[];
  transfers: readonly (readonly number[])[];
}

export interface SolutionResult {
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

export const SPECS: readonly CanSpec[] = [
  { key: "msr110", name: "MSR 110g", capacity: 110, emptyWeight: 101 },
  { key: "msr227", name: "MSR 227g", capacity: 227, emptyWeight: 147 },
  { key: "msr450", name: "MSR 450g", capacity: 450, emptyWeight: 216 },
] as const;

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

export async function computePlan(cans: readonly Can[]): Promise<SolutionResult> {
  assignIds([...cans]);
  const plan = await solveWithJS(cans);
  return { plan, cans };
}
