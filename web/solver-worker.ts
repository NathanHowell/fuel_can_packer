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

// Global error handler for uncaught errors in the worker
workerScope.addEventListener("error", (event: ErrorEvent) => {
  console.error("Worker uncaught error:", {
    message: event.message,
    filename: event.filename,
    lineno: event.lineno,
    colno: event.colno,
    errorString: String(event.error),
    stack: event.error instanceof Error ? event.error.stack : undefined,
  });
});

// Global handler for unhandled promise rejections in the worker
workerScope.addEventListener("unhandledrejection", (event: PromiseRejectionEvent) => {
  console.error("Worker unhandled promise rejection:", {
    reasonString: String(event.reason),
    reasonStack: event.reason instanceof Error ? event.reason.stack : undefined,
  });
});

workerScope.addEventListener("message", async (event: MessageEvent<WorkerRequest>) => {
  const { requestId, cans } = event.data;
  
  console.log("Worker received message:", {
    requestId,
    cansCount: cans.length,
    cans: cans.map(c => ({ spec: c.spec.key, fuel: c.fuel, gross: c.gross })),
  });
  
  try {
    const { plan, cans: solvedCans } = await computePlan(cans);
    const message: WorkerSuccess = { requestId, ok: true, plan, cans: solvedCans };
    console.log("Worker computed plan successfully:", { requestId, keptCans: plan.keep.filter(k => k).length });
    workerScope.postMessage(message);
  } catch (err: unknown) {
    // Enhanced error logging for debugging
    const errorMessage = err instanceof Error ? err.message : String(err);
    const errorStack = err instanceof Error ? err.stack : undefined;
    
    console.error("Worker error during computation:", {
      requestId,
      error: err,
      errorMessage,
      errorStack,
      errorType: err?.constructor?.name,
      errorString: String(err),
    });
    
    const message: WorkerError = {
      requestId,
      ok: false,
      error: errorMessage,
    };
    workerScope.postMessage(message);
  }
});
