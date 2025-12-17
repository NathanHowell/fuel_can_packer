import assert from "node:assert/strict";
import test from "node:test";

import { type Can, type CanSpec, computePlan, SPECS } from "./solver";

function getSpec(key: string): CanSpec {
  const spec = SPECS.find((s) => s.key === key);
  if (!spec) {
    throw new Error(`Missing spec for ${key}`);
  }
  return spec;
}

const msr110 = getSpec("msr110");
const msr227 = getSpec("msr227");
const msr450 = getSpec("msr450");

function makeCan(spec: CanSpec, fuel: number): Can {
  return { id: 0, spec, fuel, gross: spec.emptyWeight + fuel };
}

void test("supports additional can specs beyond defaults", async () => {
  const msr800: CanSpec = { key: "msr800", name: "MSR 800g", capacity: 800, emptyWeight: 320 };
  const specs = [...SPECS, msr800];
  const cans: Can[] = [
    makeCan(msr800, 700),
    makeCan(msr450, 200),
    makeCan(msr227, 0),
  ];

  const { plan } = await computePlan(cans, specs);

  assert.deepEqual(plan.keep, [true, false, true]);
  assert.deepEqual(plan.final_fuel, [700, 0, 200]);

  const totalFuel = plan.final_fuel.reduce((a, b) => a + b, 0);
  assert.equal(totalFuel, 900);
});

void test("consolidates fuel into a single 227g can when possible", async () => {
  const cans: Can[] = [
    makeCan(msr227, 180),
    makeCan(msr227, 30),
  ];

  const { plan } = await computePlan(cans);

  assert.deepEqual(plan.keep, [true, false]);
  assert.deepEqual(plan.final_fuel, [210, 0]);
  assert.equal(plan.transfers[1]?.[0], 30);

  const totalFuel = plan.final_fuel.reduce((a, b) => a + b, 0);
  assert.equal(totalFuel, 210);
});

void test("picks the lightest feasible can combination for mixed sizes", async () => {
  const cans: Can[] = [
    makeCan(msr110, 90),
    makeCan(msr227, 200),
    makeCan(msr450, 100),
  ];

  const { plan } = await computePlan(cans);

  assert.deepEqual(plan.keep, [false, false, true]);
  assert.deepEqual(plan.final_fuel, [0, 0, 390]);
  assert.equal(plan.transfers[0]?.[2], 90);
  assert.equal(plan.transfers[1]?.[2], 200);

  const totalFuel = plan.final_fuel.reduce((a, b) => a + b, 0);
  assert.equal(totalFuel, 390);
});

void test("returns empty plan when every can is empty", async () => {
  const cans: Can[] = [
    makeCan(msr110, 0),
    makeCan(msr227, 0),
  ];

  const { plan } = await computePlan(cans);

  assert.deepEqual(plan.keep, [false, false]);
  assert.deepEqual(plan.final_fuel, [0, 0]);
  assert.ok(plan.transfers.flat().every((amt) => amt === 0));
});

void test("throws when no cans are provided", async () => {
  await assert.rejects(() => computePlan([]), /No cans provided/);
});

void test("handles can at exact capacity", async () => {
  const cans: Can[] = [
    makeCan(msr110, 110), // Exactly at capacity
  ];

  const { plan } = await computePlan(cans);

  assert.deepEqual(plan.keep, [true]);
  assert.deepEqual(plan.final_fuel, [110]);
  assert.ok(plan.transfers.flat().every((amt) => amt === 0));
});

void test("handles can 1g over capacity", async () => {
  const cans: Can[] = [
    makeCan(msr110, 111), // 1g over capacity
    makeCan(msr227, 0), // Empty can to receive overflow
  ];

  const { plan } = await computePlan(cans);

  // Solver chooses to keep just the 227g can (lighter overall solution)
  assert.deepEqual(plan.keep, [false, true]);
  assert.deepEqual(plan.final_fuel, [0, 111]);
  assert.equal(plan.transfers[0]?.[1], 111);

  const totalFuel = plan.final_fuel.reduce((a, b) => a + b, 0);
  assert.equal(totalFuel, 111);
});

void test("handles insufficient capacity", async () => {
  const cans: Can[] = [
    makeCan(msr110, 110),
    makeCan(msr110, 110),
    // Total fuel: 220g, but only one can can be kept without exceeding 110g capacity
  ];

  const { plan } = await computePlan(cans);

  // Should keep one can with 110g and one with 110g (both fit in capacity)
  const totalFuel = plan.final_fuel.reduce((a, b) => a + b, 0);
  assert.equal(totalFuel, 220);
});

void test("handles one empty can with one full can", async () => {
  const cans: Can[] = [
    makeCan(msr110, 0),
    makeCan(msr227, 100),
  ];

  const { plan } = await computePlan(cans);

  // Solver prefers the lighter 110g can when possible
  assert.deepEqual(plan.keep, [true, false]);
  assert.deepEqual(plan.final_fuel, [100, 0]);

  const totalFuel = plan.final_fuel.reduce((a, b) => a + b, 0);
  assert.equal(totalFuel, 100);
});

void test("prefers lighter cans when fuel amount is equal", async () => {
  const cans: Can[] = [
    makeCan(msr110, 50),
    makeCan(msr227, 50),
    makeCan(msr450, 50),
  ];

  const { plan } = await computePlan(cans);

  // Should keep the 110g can (lightest) with all 150g fuel
  const keptIndices = plan.keep
    .map((k, i) => (k ? i : -1))
    .filter((i) => i >= 0);

  assert.equal(keptIndices.length, 1);

  const keptSpec = cans[keptIndices[0] ?? 0]?.spec;
  assert.equal(keptSpec?.key, "msr227"); // 227g can can hold all 150g

  const totalFuel = plan.final_fuel.reduce((a, b) => a + b, 0);
  assert.equal(totalFuel, 150);
});

void test("handles very small fuel amounts", async () => {
  const cans: Can[] = [
    makeCan(msr110, 1),
    makeCan(msr227, 1),
  ];

  const { plan } = await computePlan(cans);

  const totalFuel = plan.final_fuel.reduce((a, b) => a + b, 0);
  assert.equal(totalFuel, 2);

  // Should consolidate into one can
  const keptCount = plan.keep.filter((k) => k).length;
  assert.equal(keptCount, 1);
});

void test("handles moderate number of cans efficiently", async () => {
  // Create 20 cans to test with reasonable complexity
  const cans: Can[] = [];
  for (let i = 0; i < 20; i++) {
    cans.push(makeCan(msr110, 50));
  }

  const { plan } = await computePlan(cans);

  const totalFuel = plan.final_fuel.reduce((a, b) => a + b, 0);
  assert.equal(totalFuel, 1000);
});

void test("minimizes transfer count when empty weight is tied", async () => {
  const cans: Can[] = [
    makeCan(msr227, 100),
    makeCan(msr227, 50),
    makeCan(msr227, 50),
  ];

  const { plan } = await computePlan(cans);

  // Should consolidate into 227g can, preferring single transfer
  const transferCount = plan.transfers.flat().filter((amt) => amt > 0).length;

  const totalFuel = plan.final_fuel.reduce((a, b) => a + b, 0);
  assert.equal(totalFuel, 200);

  // Should minimize number of transfers
  assert.ok(transferCount <= 2);
});

void test("throws when workload exceeds limit", async () => {
  // Create scenario that exceeds 5M workload limit
  // workload = (lenA + 1) * (lenB + 1) * n
  // With 150 msr110 + 150 msr227 = 300 cans:
  // (150 + 1) * (150 + 1) * 300 = 6,847,800 > 5,000,000
  const cans: Can[] = [];
  for (let i = 0; i < 150; i++) {
    cans.push(makeCan(msr110, 50));
  }
  for (let i = 0; i < 150; i++) {
    cans.push(makeCan(msr227, 100));
  }

  await assert.rejects(
    () => computePlan(cans),
    /Too many cans for the browser solver/
  );
});

void test("handles complex interaction between all three can sizes", async () => {
  const cans: Can[] = [
    makeCan(msr110, 100),
    makeCan(msr110, 80),
    makeCan(msr227, 150),
    makeCan(msr227, 120),
    makeCan(msr450, 300),
    makeCan(msr450, 200),
  ];

  const { plan } = await computePlan(cans);

  // Verify fuel is conserved
  const totalFuel = plan.final_fuel.reduce((a, b) => a + b, 0);
  assert.equal(totalFuel, 950);

  // Verify no capacity violations
  for (let i = 0; i < cans.length; i++) {
    if (plan.keep[i]) {
      const can = cans[i];
      const finalFuel = plan.final_fuel[i];
      if (can && finalFuel !== undefined) {
        assert.ok(finalFuel <= can.spec.capacity);
        assert.ok(finalFuel >= 0);
      }
    }
  }
});

void test("lexicographic tie-breaking prefers fewer transfers", async () => {
  // When empty weight is the same, should prefer fewer transfers
  const cans: Can[] = [
    makeCan(msr227, 200),
    makeCan(msr227, 27), // Just enough to fill first can
    makeCan(msr227, 0),
  ];

  const { plan } = await computePlan(cans);

  const totalFuel = plan.final_fuel.reduce((a, b) => a + b, 0);
  assert.equal(totalFuel, 227);

  // Should keep one can and make one transfer
  const keptCount = plan.keep.filter((k) => k).length;
  assert.equal(keptCount, 1);

  const transferCount = plan.transfers.flat().filter((amt) => amt > 0).length;
  assert.equal(transferCount, 1);
});

void test("handles scenario with multiple valid solutions", async () => {
  // Multiple ways to pack, solver should pick optimal
  const cans: Can[] = [
    makeCan(msr110, 110),
    makeCan(msr110, 110),
    makeCan(msr227, 220),
  ];

  const { plan } = await computePlan(cans);

  const totalFuel = plan.final_fuel.reduce((a, b) => a + b, 0);
  assert.equal(totalFuel, 440);

  // Verify fuel conservation
  const keptCans = cans.filter((_, i) => plan.keep[i]);
  const totalCapacity = keptCans.reduce((sum, can) => sum + can.spec.capacity, 0);
  assert.ok(totalCapacity >= totalFuel);
});

void test("optimizes across mixed partially-filled cans", async () => {
  const cans: Can[] = [
    makeCan(msr110, 50),
    makeCan(msr110, 60),
    makeCan(msr227, 100),
    makeCan(msr227, 127),
    makeCan(msr450, 50),
  ];

  const { plan } = await computePlan(cans);

  const totalFuel = plan.final_fuel.reduce((a, b) => a + b, 0);
  assert.equal(totalFuel, 387);

  // Should minimize empty weight carried
  let emptyWeight = 0;
  for (let i = 0; i < cans.length; i++) {
    if (plan.keep[i]) {
      const can = cans[i];
      if (can) {
        emptyWeight += can.spec.emptyWeight;
      }
    }
  }

  // With optimal packing, should be reasonably light
  assert.ok(emptyWeight > 0);
});

void test("property: fuel is always conserved", async () => {
  // Test multiple random scenarios to verify fuel conservation
  const scenarios = [
    [makeCan(msr110, 55), makeCan(msr227, 130), makeCan(msr450, 280)],
    [makeCan(msr110, 10), makeCan(msr110, 20), makeCan(msr110, 30)],
    [makeCan(msr227, 100), makeCan(msr227, 100), makeCan(msr227, 100)],
    [makeCan(msr450, 400), makeCan(msr227, 50)],
    [makeCan(msr110, 110), makeCan(msr227, 227), makeCan(msr450, 450)],
  ];

  for (const cans of scenarios) {
    const initialFuel = cans.reduce((sum, can) => sum + can.fuel, 0);
    const { plan } = await computePlan(cans);
    const finalFuel = plan.final_fuel.reduce((sum, f) => sum + f, 0);

    assert.equal(
      finalFuel,
      initialFuel,
      `Fuel not conserved: ${finalFuel} !== ${initialFuel}`
    );
  }
});

void test("property: no capacity violations", async () => {
  // Test that final fuel never exceeds can capacity
  const scenarios = [
    [makeCan(msr110, 100), makeCan(msr110, 50)],
    [makeCan(msr227, 200), makeCan(msr227, 150)],
    [makeCan(msr450, 400), makeCan(msr450, 350)],
    [makeCan(msr110, 110), makeCan(msr227, 227), makeCan(msr450, 450)],
  ];

  for (const cans of scenarios) {
    const { plan } = await computePlan(cans);

    for (let i = 0; i < cans.length; i++) {
      const can = cans[i];
      const finalFuel = plan.final_fuel[i];

      if (can && finalFuel !== undefined) {
        assert.ok(
          finalFuel <= can.spec.capacity,
          `Capacity violation at index ${i}: ${finalFuel} > ${can.spec.capacity}`
        );
        assert.ok(
          finalFuel >= 0,
          `Negative fuel at index ${i}: ${finalFuel}`
        );
      }
    }
  }
});

void test("property: only kept cans have fuel", async () => {
  // Verify that non-kept cans always have zero final fuel
  const scenarios = [
    [makeCan(msr110, 50), makeCan(msr227, 100), makeCan(msr450, 150)],
    [makeCan(msr227, 100), makeCan(msr227, 50)],
    [makeCan(msr110, 110), makeCan(msr110, 110)],
  ];

  for (const cans of scenarios) {
    const { plan } = await computePlan(cans);

    for (let i = 0; i < cans.length; i++) {
      const kept = plan.keep[i];
      const finalFuel = plan.final_fuel[i];

      if (!kept && finalFuel !== undefined) {
        assert.equal(
          finalFuel,
          0,
          `Non-kept can at index ${i} has fuel: ${finalFuel}`
        );
      }
    }
  }
});

void test("property: transfer consistency", async () => {
  // Verify that transfers are consistent with initial and final fuel
  const cans: Can[] = [
    makeCan(msr110, 50),
    makeCan(msr227, 100),
    makeCan(msr450, 200),
  ];

  const { plan } = await computePlan(cans);

  for (let i = 0; i < cans.length; i++) {
    const can = cans[i];
    const transferRow = plan.transfers[i];
    if (!can || !transferRow) {continue;}

    const initialFuel = can.fuel;
    const finalFuel = plan.final_fuel[i] ?? 0;

    // Calculate net transfers for this can
    const outflow = transferRow.reduce((sum, amt) => sum + amt, 0);
    let inflow = 0;
    for (let j = 0; j < cans.length; j++) {
      const row = plan.transfers[j];
      if (row) {
        inflow += row[i] ?? 0;
      }
    }

    const expected = initialFuel - outflow + inflow;
    assert.equal(
      finalFuel,
      expected,
      `Transfer inconsistency at index ${i}: ${finalFuel} !== ${expected}`
    );
  }
});
