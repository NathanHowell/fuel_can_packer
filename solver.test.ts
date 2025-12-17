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

test("consolidates fuel into a single 227g can when possible", async () => {
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

test("picks the lightest feasible can combination for mixed sizes", async () => {
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

test("returns empty plan when every can is empty", async () => {
  const cans: Can[] = [
    makeCan(msr110, 0),
    makeCan(msr227, 0),
  ];

  const { plan } = await computePlan(cans);

  assert.deepEqual(plan.keep, [false, false]);
  assert.deepEqual(plan.final_fuel, [0, 0]);
  assert.ok(plan.transfers.flat().every((amt) => amt === 0));
});

test("throws when no cans are provided", async () => {
  await assert.rejects(() => computePlan([]), /No cans provided/);
});
