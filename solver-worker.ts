/// <reference lib="webworker" />

import { computePlan, type Can, type Plan } from "./solver";

interface WorkerRequest {
  readonly requestId: number;
  readonly cans: readonly Can[];
}

interface WorkerSuccess {
  readonly requestId: number;
  readonly ok: true;
  readonly plan: Plan;
  readonly cans: readonly Can[];
}

interface WorkerError {
  readonly requestId: number;
  readonly ok: false;
  readonly error: string;
}

const workerScope: DedicatedWorkerGlobalScope = self as unknown as DedicatedWorkerGlobalScope;

workerScope.addEventListener("message", async (event: MessageEvent<WorkerRequest>) => {
  const { requestId, cans } = event.data;
  try {
    const { plan, cans: solvedCans } = await computePlan(cans);
    const message: WorkerSuccess = { requestId, ok: true, plan, cans: solvedCans };
    workerScope.postMessage(message);
  } catch (err: unknown) {
    const message: WorkerError = {
      requestId,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
    workerScope.postMessage(message);
  }
});
