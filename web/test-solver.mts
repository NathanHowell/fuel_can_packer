#!/usr/bin/env node

// Simple test to verify the pure-JS solver works correctly

interface CanSpec {
  readonly key: string;
  readonly name: string;
  readonly capacity: number;
  readonly emptyWeight: number;
}

interface Can {
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

const SPECS: readonly CanSpec[] = [
  { key: "msr110", name: "MSR 110g", capacity: 110, emptyWeight: 101 },
  { key: "msr227", name: "MSR 227g", capacity: 227, emptyWeight: 147 },
  { key: "msr450", name: "MSR 450g", capacity: 450, emptyWeight: 216 },
] as const;

function lexLess(a: Score, b: Score): boolean {
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return a[i]! < b[i]!;
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
  if (totalNeed === 0) return { edges: [], pairCount: 0, transferTotal: 0 };
  if (totalNeed > totalCap) return null;

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
        if (best < 0) return null;
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

  if (!greedy) return null;

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
    for (let i = 0; i < Math.min(k, tmp.length); i++) s += tmp[i]!;
    return s;
  }

  function dfs(
    dIdx: number,
    edgesLeft: number,
    caps: readonly number[],
    memo: Map<string, number>
  ): readonly Edge[] | null {
    if (dIdx === donors.length) return [];
    const memoKey = keyOf(dIdx, edgesLeft, caps);
    if (memo.has(memoKey)) return null;

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
      if (sumTopCaps(caps, pieces) < need) continue;

      const candIdxs: number[] = [];
      for (let i = 0; i < R; i++) if (caps[i]! > 0) candIdxs.push(i);

      const combo: number[] = new Array(pieces);

      function chooseCombo(pos: number, start: number): readonly Edge[] | null {
        if (pos === pieces) {
          let sum = 0;
          for (let k = 0; k < pieces; k++) sum += caps[combo[k]!]!;
          if (sum < need) return null;

          const assigns: number[] = new Array(pieces).fill(0);

          function assignAmounts(p: number, left: number): boolean {
            if (p === pieces - 1) {
              const idx = combo[p]!;
              if (left < 1 || left > caps[idx]!) return false;
              assigns[p] = left;
              return true;
            }
            const idx = combo[p]!;
            const capHere = caps[idx]!;

            let restMax = 0;
            for (let q = p + 1; q < pieces; q++) restMax += caps[combo[q]!]!;

            const minHere = Math.max(1, left - restMax);
            const maxHere = Math.min(capHere, left - (pieces - p - 1));
            if (minHere > maxHere) return false;

            for (let x = maxHere; x >= minHere; x--) {
              assigns[p] = x;
              if (assignAmounts(p + 1, left - x)) return true;
            }
            return false;
          }

          if (!assignAmounts(0, need)) return null;

          const nextCaps = caps.slice();
          const edgeList: Edge[] = [];
          for (let k = 0; k < pieces; k++) {
            const ridx = combo[k]!;
            const amt = assigns[k]!;
            nextCaps[ridx]! -= amt;
            edgeList.push({ from: d.from, to: recipients[ridx]!.to, amt });
          }

          const tail = dfs(dIdx + 1, edgesLeft - pieces, nextCaps, memo);
          if (!tail) return null;
          return [...edgeList, ...tail];
        }

        for (let i = start; i <= candIdxs.length - (pieces - pos); i++) {
          combo[pos] = candIdxs[i]!;
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
  if (!cans.length) throw new Error("No cans provided");
  if (cans.length > 16) throw new Error("Pure-JS solver supports up to 16 cans");

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
    if (capSum < totalFuel) continue;

    const keep: boolean[] = Array(n).fill(false);
    for (let i = 0; i < n; i++) keep[i] = !!(mask & (1 << i));

    const baseline: number[] = Array(n).fill(0);
    const slack: Recipient[] = [];
    for (let i = 0; i < n; i++) {
      if (!keep[i]) continue;
      baseline[i] = Math.min(init[i]!, caps[i]!);
      const s = caps[i]! - baseline[i]!;
      if (s > 0) slack.push({ to: i, cap: s });
    }

    const donors: Donor[] = [];
    for (let i = 0; i < n; i++) {
      if (!keep[i]) {
        if (init[i]! > 0) donors.push({ from: i, amt: init[i]! });
      } else {
        const excess = Math.max(0, init[i]! - caps[i]!);
        if (excess > 0) donors.push({ from: i, amt: excess });
      }
    }

    const alloc = allocateMinEdgesAndMinTransfer(donors, slack);
    if (!alloc) continue;

    const transfers: number[][] = zeros2(n);
    for (const e of alloc.edges) transfers[e.from]![e.to]! += e.amt;

    const finalFuel: number[] = Array(n).fill(0);
    for (let i = 0; i < n; i++) finalFuel[i] = keep[i] ? baseline[i]! : 0;
    for (const e of alloc.edges) finalFuel[e.to]! += e.amt;

    for (let i = 0; i < n; i++) {
      if (!keep[i] && finalFuel[i] !== 0) {
        throw new Error("internal: non-kept can ended with fuel");
      }
      if (keep[i] && (finalFuel[i]! < 0 || finalFuel[i]! > caps[i]!)) {
        throw new Error("internal: capacity violation");
      }
      const out = transfers[i]!.reduce((a, b) => a + b, 0);
      if (out > init[i]!) throw new Error("internal: outflow > initial fuel");
    }
    const sumFinal = finalFuel.reduce((a, b) => a + b, 0);
    if (sumFinal !== totalFuel) throw new Error("internal: fuel not conserved");

    const score: Score = [emptyCost, alloc.pairCount, alloc.transferTotal];
    if (!best || lexLess(score, best.score)) {
      best = {
        score,
        plan: { keep, final_fuel: finalFuel, transfers },
      };
    }
  }

  if (!best) throw new Error("No feasible plan found");
  return best.plan;
}

// Test cases
async function runTests(): Promise<void> {
  console.log("Testing pure-JS solver...\\n");

  // Test 1: Two MSR 227g cans, one nearly empty, one nearly full
  console.log("Test 1: Two MSR 227g cans");
  const test1: Can[] = [
    { spec: SPECS[1]!, fuel: 180, gross: 327 },
    { spec: SPECS[1]!, fuel: 30, gross: 177 },
  ];
  const result1 = await solveWithJS(test1);
  console.log("  Keep:", result1.keep);
  console.log("  Final fuel:", result1.final_fuel);
  console.log("  Total fuel:", result1.final_fuel.reduce((a, b) => a + b, 0));
  console.log();

  // Test 2: Mix of can sizes
  console.log("Test 2: Mixed can sizes");
  const test2: Can[] = [
    { spec: SPECS[0]!, fuel: 90, gross: 191 },   // MSR 110g
    { spec: SPECS[1]!, fuel: 200, gross: 347 },  // MSR 227g
    { spec: SPECS[2]!, fuel: 100, gross: 316 },  // MSR 450g
  ];
  const result2 = await solveWithJS(test2);
  console.log("  Keep:", result2.keep);
  console.log("  Final fuel:", result2.final_fuel);
  console.log("  Total fuel:", result2.final_fuel.reduce((a, b) => a + b, 0));
  console.log();

  // Test 3: Empty cans
  console.log("Test 3: All empty cans");
  const test3: Can[] = [
    { spec: SPECS[0]!, fuel: 0, gross: 101 },
    { spec: SPECS[1]!, fuel: 0, gross: 147 },
  ];
  const result3 = await solveWithJS(test3);
  console.log("  Keep:", result3.keep);
  console.log("  Final fuel:", result3.final_fuel);
  console.log();

  console.log("All tests completed successfully!");
}

runTests().catch(err => {
  console.error("Test failed:", err);
  process.exit(1);
});
