import "./styles.css";
import { SPECS, type Can, type Plan, type CanSpec } from "./solver";

function getTransferAmount(plan: Plan, from: number, to: number): number {
  const row = plan.transfers[from];
  return row?.[to] ?? 0;
}

function getFinalFuel(plan: Plan, idx: number): number {
  return plan.final_fuel[idx] ?? 0;
}

interface FillColors {
  oklch: string;
  hsl: string;
}

type FillState = "normal" | "overflow" | "underflow";

function fillColors(fuel: number, capacity: number): FillColors {
  if (fuel > capacity) {
    return { oklch: "var(--color-danger)", hsl: "var(--color-danger)" };
  }

  const ratio = Math.max(0, Math.min(1, fuel / capacity));
  const pct = ratio * 100;

  const redOklch = "oklch(0.62 0.24 29)";
  const greenOklch = "oklch(0.77 0.19 142)";
  const redHsl = "hsl(0 70% 55%)";
  const greenHsl = "hsl(120 70% 55%)";

  return {
    oklch: `color-mix(in oklch, ${redOklch} ${100 - pct}%, ${greenOklch} ${pct}%)`,
    hsl: `color-mix(in hsl, ${redHsl} ${100 - pct}%, ${greenHsl} ${pct}%)`,
  };
}

function applyFillStyle(
  el: HTMLElement,
  fuel: number,
  capacity: number,
  opts?: { gross?: number; emptyWeight?: number }
): void {
  const pct = Math.max(0, Math.min(100, (fuel / capacity) * 100));
  const colors = fillColors(fuel, capacity);
  el.style.setProperty("--fill-pct", `${pct}%`);
  el.style.setProperty("--fill-color-oklch", colors.oklch);
  el.style.setProperty("--fill-color-hsl", colors.hsl);

  let state: FillState = "normal";
  if (opts?.gross !== undefined && opts.emptyWeight !== undefined && opts.gross < opts.emptyWeight) {
    state = "underflow";
  } else if (fuel > capacity) {
    state = "overflow";
  }

  if (state === "normal") {
    el.removeAttribute("data-fill-state");
  } else {
    el.setAttribute("data-fill-state", state);
  }
}

// DOM interaction
const formEl = document.getElementById("pack-form") as HTMLFormElement;
const columnsEl = document.getElementById("columns") as HTMLDivElement;
const columnTemplateEl = document.getElementById("column-template") as HTMLTemplateElement | null;
const cellTemplateEl = document.getElementById("cell-template") as HTMLTemplateElement | null;
const resultsEl = document.getElementById("results") as HTMLDivElement;
const graphPanelEl = document.querySelector<HTMLDivElement>(".graph-panel");
const donorColumnEl = document.getElementById("donor-column") as HTMLDivElement;
const recipientColumnEl = document.getElementById("recipient-column") as HTMLDivElement;
const graphGridEl = document.querySelector<HTMLDivElement>(".graph-grid");
const graphSpacerEl = document.querySelector<HTMLDivElement>(".graph-grid .spacer");
const graphSvgEl = document.getElementById("graph-svg") as unknown as SVGSVGElement;
const keepListEl = document.getElementById("keep-list") as HTMLUListElement | null;
const transferListEl = document.getElementById("transfer-list") as HTMLUListElement | null;
const totalsListEl = document.getElementById("totals-list") as HTMLUListElement | null;
const inputErrorsEl = document.getElementById("input-errors") as HTMLDivElement | null;
const overflowErrorEl = document.querySelector<HTMLDivElement>('[data-error="overflow"]');
const underflowErrorEl = document.querySelector<HTMLDivElement>('[data-error="underflow"]');
const statusRowEl = document.getElementById("status-row") as HTMLDivElement | null;
const statusTextEl = document.getElementById("status-text") as HTMLDivElement | null;
const hoverStyleId = "graph-hover-style";
let hoverStyleEl: HTMLStyleElement | null = null;
let computeTimer: number | null = null;
let currentRequestId = 0;
let pendingWorker: Worker | null = null;

type StatusState = "idle" | "solving" | "success" | "error";

interface WorkerRequest {
  readonly requestId: number;
  readonly cans: readonly Can[];
}

type WorkerResponse =
  | {
      readonly requestId: number;
      readonly ok: true;
      readonly plan: Plan;
      readonly cans: readonly Can[];
    }
  | {
      readonly requestId: number;
      readonly ok: false;
      readonly error: string;
    };

function setStatus(state: StatusState, message: string): void {
  if (!statusRowEl || !statusTextEl) {return;}

  statusRowEl.setAttribute("data-state", state);
  statusTextEl.textContent = message;
}

interface ListItem {
  readonly text: string;
  readonly muted?: boolean;
}

function renderList(list: HTMLUListElement, items: readonly ListItem[]): void {
  list.innerHTML = "";
  for (const item of items) {
    const li = document.createElement("li");
    li.textContent = item.text;
    if (item.muted) {li.classList.add("muted");}
    list.appendChild(li);
  }
}

function clearSolutionLists(): void {
  for (const list of [keepListEl, transferListEl, totalsListEl]) {
    if (list) {list.innerHTML = "";}
  }
}

let inputNameCounter = 0;

function nextInputName(specKey: string): string {
  inputNameCounter += 1;
  return `gross_${specKey}_${Date.now()}_${inputNameCounter}`;
}

function createCell(specKey: string): { cell: HTMLDivElement; input: HTMLInputElement } {
  const fallback = (): { cell: HTMLDivElement; input: HTMLInputElement } => {
    const cell = document.createElement("div");
    cell.className = "cell";
    const input = document.createElement("input");
    input.type = "number";
    input.placeholder = "Gross weight (g)";
    input.min = "0";
    input.step = "1";
    cell.appendChild(input);
    return { cell, input };
  };

  if (!cellTemplateEl?.content) {return fallback();}
  const fragment = cellTemplateEl.content.cloneNode(true) as DocumentFragment;
  const cell = fragment.querySelector<HTMLDivElement>(".cell");
  const input = fragment.querySelector<HTMLInputElement>("input");
  if (!cell || !input) {return fallback();}
  input.dataset["spec"] = specKey;
  return { cell, input };
}

function bindCell(
  cellsContainer: Element,
  cell: HTMLDivElement,
  input: HTMLInputElement,
  specKey: string
): void {
  input.dataset["spec"] = specKey;
  if (input.name === "") {input.name = nextInputName(specKey);}
  if (input.placeholder === "") {input.placeholder = "Gross weight (g)";}
  if (input.min === "") {input.min = "0";}
  if (input.step === "") {input.step = "1";}

  input.addEventListener("input", () => {
    updateCellFill(cell, input);

    const cells = Array.from(
      cellsContainer.querySelectorAll<HTMLInputElement>(".cell input")
    );
    const lastInput = cells[cells.length - 1];
    if (input.value !== "" && lastInput === input) {
      appendCell(cellsContainer, specKey);
    }

    cleanupEmptyCells(cellsContainer);

    scheduleCompute();
  });

  updateCellFill(cell, input);
}

function createColumn(spec: CanSpec): { column: HTMLDivElement; cellsContainer: HTMLDivElement } {
  const fallback = (): { column: HTMLDivElement; cellsContainer: HTMLDivElement } => {
    const column = document.createElement("div");
    column.className = "column";
    column.dataset["spec"] = spec.key;

    const heading = document.createElement("h2");
    heading.textContent = spec.name;
    column.appendChild(heading);

    const hint = document.createElement("p");
    hint.className = "hint";
    hint.textContent = `Capacity: ${spec.capacity}g • Empty: ${spec.emptyWeight}g`;
    column.appendChild(hint);

    const cellsContainer = document.createElement("div");
    cellsContainer.className = "cells";
    cellsContainer.dataset["spec"] = spec.key;
    column.appendChild(cellsContainer);

    return { column, cellsContainer };
  };

  if (!columnTemplateEl?.content) {return fallback();}
  const fragment = columnTemplateEl.content.cloneNode(true) as DocumentFragment;
  const column = fragment.querySelector<HTMLDivElement>(".column");
  const cellsContainer = fragment.querySelector<HTMLDivElement>(".cells");
  const heading = fragment.querySelector<HTMLElement>('[data-part="name"]');
  const hint = fragment.querySelector<HTMLElement>('[data-part="hint"]');
  if (!column || !cellsContainer || !heading || !hint) {return fallback();}

  column.dataset["spec"] = spec.key;
  cellsContainer.dataset["spec"] = spec.key;
  heading.textContent = spec.name;
  hint.textContent = `Capacity: ${spec.capacity}g • Empty: ${spec.emptyWeight}g`;

  return { column, cellsContainer };
}

function appendCell(cellsContainer: Element, specKey: string): void {
  const { cell, input } = createCell(specKey);
  cellsContainer.appendChild(cell);
  bindCell(cellsContainer, cell, input, specKey);
}

function cleanupEmptyCells(cellsContainer: Element): void {
  const inputs = Array.from(
    cellsContainer.querySelectorAll<HTMLInputElement>(".cell input")
  );
  if (inputs.length === 0) {return;}

  let lastFilled = -1;
  inputs.forEach((input, idx) => {
    if (input.value.trim() !== "") {lastFilled = idx;}
  });

  const keepEmptyIdx = Math.min(Math.max(0, lastFilled + 1), inputs.length - 1);

  for (let i = inputs.length - 1; i >= 0; i--) {
    const input = inputs[i];
    if (!input) {continue;}
    if (input.value.trim() === "" && i !== keepEmptyIdx) {
      input.closest(".cell")?.remove();
    }
  }
}

function renderColumns(): void {
  columnsEl.innerHTML = "";
  for (const spec of SPECS) {
    const { column, cellsContainer } = createColumn(spec);
    columnsEl.appendChild(column);
    appendCell(cellsContainer, spec.key);
  }
}

function updateCellFill(cell: HTMLDivElement, input: HTMLInputElement): void {
  const specKey = input.dataset["spec"] ?? input.name.split("_")[1];
  const spec = SPECS.find((s) => s.key === specKey);
  if (!spec) {return;}

  if (input.value === "") {
    cell.style.setProperty("--fill-pct", "0%");
    cell.style.removeProperty("--fill-color-oklch");
    cell.style.removeProperty("--fill-color-hsl");
    cell.removeAttribute("data-fill-state");
    return;
  }

  const gross = parseFloat(input.value) || 0;
  const fuel = Math.max(0, gross - spec.emptyWeight);
  applyFillStyle(cell, fuel, spec.capacity, { gross, emptyWeight: spec.emptyWeight });
}

formEl.addEventListener("submit", (e: Event) => {
  e.preventDefault();
  scheduleCompute();
});

function scheduleCompute(): void {
  if (computeTimer !== null) {
    window.clearTimeout(computeTimer);
  }
  computeTimer = window.setTimeout(() => {
    computeTimer = null;
    void runCompute();
  }, 350);
}

function terminatePendingWorker(): void {
  if (pendingWorker) {
    pendingWorker.terminate();
    pendingWorker = null;
  }
}

function startWorkerSolve(requestId: number, cans: Can[]): void {
  const worker = new Worker(new URL("./solver-worker.js", import.meta.url), { type: "module" });
  pendingWorker = worker;

  const handleMessage = (event: MessageEvent<WorkerResponse>): void => {
    const data = event.data;
    const isCurrent = data.requestId === currentRequestId;
    cleanup();

    if (!isCurrent) {
      return;
    }

    if (data.ok) {
      const { plan, cans: canObjects } = data;
      renderGraph(canObjects, plan);
      renderSolution(canObjects, plan);
      resultsEl.setAttribute("data-visible", "true");
      resultsEl.removeAttribute("data-loading");
      setStatus("success", "Complete");
    } else {
      resultsEl.removeAttribute("data-loading");
      setStatus("error", `Error: ${data.error}`);
    }
  };

  const handleError = (event: ErrorEvent | MessageEvent<unknown>): void => {
    const isCurrent = requestId === currentRequestId;
    const message = event instanceof ErrorEvent ? event.message : "Worker error";
    cleanup();
    if (!isCurrent) {
      return;
    }
    resultsEl.removeAttribute("data-loading");
    setStatus("error", `Error: ${message}`);
  };

  const cleanup = (): void => {
    worker.removeEventListener("message", handleMessage);
    worker.removeEventListener("error", handleError);
    worker.removeEventListener("messageerror", handleError);
    worker.terminate();
    if (pendingWorker === worker) {
      pendingWorker = null;
    }
  };

  worker.addEventListener("message", handleMessage);
  worker.addEventListener("error", handleError);
  worker.addEventListener("messageerror", handleError);

  worker.postMessage({ requestId, cans } satisfies WorkerRequest);
}

async function runCompute(): Promise<void> {
  const requestId = ++currentRequestId;
  terminatePendingWorker();
  // Gather all filled cans
  const cans: Can[] = [];
  let foundUnderflow = false;
  let foundOverflow = false;
  columnsEl.querySelectorAll<HTMLDivElement>(".cell").forEach((cell) => {
    cell.removeAttribute("data-can-num");
  });

  for (const spec of SPECS) {
    const cells = columnsEl.querySelectorAll<HTMLInputElement>(`.cells[data-spec="${spec.key}"] input`);

    for (const input of Array.from(cells)) {
      const gross = parseFloat(input.value);
      if (!isNaN(gross) && gross > 0) {
        const cell = input.closest<HTMLDivElement>(".cell");
        const canNum = cans.length + 1;
        const fuel = Math.max(0, gross - spec.emptyWeight);
        if (gross < spec.emptyWeight) {foundUnderflow = true;}
        if (fuel > spec.capacity) {foundOverflow = true;}
        cans.push({ id: canNum, spec, fuel, gross });
        if (cell) {
          cell.dataset["canNum"] = String(canNum);
        }
      }
    }
  }

  if (cans.length === 0) {
    if (requestId !== currentRequestId) {return;}
    setStatus("idle", "Add gross weights to compute");
    if (inputErrorsEl !== null) {
      inputErrorsEl.setAttribute("data-visible", "false");
    }
    resultsEl.setAttribute("data-visible", "false");
    resultsEl.removeAttribute("data-loading");
    donorColumnEl.innerHTML = "";
    recipientColumnEl.innerHTML = "";
    graphSvgEl.innerHTML = "";
    clearSolutionLists();
    return;
  }

  if (foundUnderflow || foundOverflow) {
    if (requestId !== currentRequestId) {return;}
    setStatus("error", "Invalid input found. Fix the highlighted cans.");
    if (inputErrorsEl !== null) {
      inputErrorsEl.setAttribute("data-visible", "true");
      if (overflowErrorEl) {
        overflowErrorEl.style.display = foundOverflow ? "block" : "none";
      }
      if (underflowErrorEl) {
        underflowErrorEl.style.display = foundUnderflow ? "block" : "none";
      }
    }
    resultsEl.setAttribute("data-visible", "false");
    resultsEl.removeAttribute("data-loading");
    donorColumnEl.innerHTML = "";
    recipientColumnEl.innerHTML = "";
    graphSvgEl.innerHTML = "";
    clearSolutionLists();
    return;
  }

  setStatus("solving", "Solving…");
  if (inputErrorsEl !== null) {
    inputErrorsEl.setAttribute("data-visible", "false");
  }
  resultsEl.setAttribute("data-visible", "true");
  resultsEl.setAttribute("data-loading", "true");

  startWorkerSolve(requestId, cans);
}

function renderGraph(cans: readonly Can[], plan: Plan): void {
  donorColumnEl.innerHTML = "";
  recipientColumnEl.innerHTML = "";
  graphSvgEl.innerHTML = "";
  const svgParent = graphSpacerEl ?? graphGridEl;
  if (svgParent && graphSvgEl.parentElement !== svgParent) {
    svgParent.appendChild(graphSvgEl);
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
    const canNum = can.id;
    const node = document.createElement("div");
    node.className = "node donor-node";
    node.setAttribute("data-can-id", String(idx));
    node.dataset["canNum"] = String(canNum);

    applyFillStyle(node, can.fuel, can.spec.capacity);

    node.innerHTML = `
      <strong>Can #${canNum}</strong>
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
    const canNum = can.id;
    const node = document.createElement("div");
    node.className = "node recipient-node";
    node.setAttribute("data-can-id", String(idx));
    node.dataset["canNum"] = String(canNum);

    applyFillStyle(node, finalFuel, can.spec.capacity);

    node.innerHTML = `
      <strong>Can #${canNum}</strong>
      <div class="muted">${can.spec.name}</div>
      <div class="muted">${can.fuel}g → ${finalFuel}g</div>
    `;

    recipientColumnEl.appendChild(node);
  }

  // Draw transfer edges
  window.requestAnimationFrame(() => drawEdges(cans, plan, donors, recipients));
}

function drawEdges(cans: readonly Can[], plan: Plan, donors: number[], recipients: number[]): void {
  if (!graphGridEl) {return;}

  const gridRect = graphGridEl.getBoundingClientRect();
  const panelRect = graphPanelEl?.getBoundingClientRect();
  const height = Math.max(1, Math.floor(gridRect.height));
  // Track the horizontal extent of all edges so we can keep the SVG as narrow as possible.
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  const recipientSums = new Map<number, number>();
  const donorTargets = new Map<number, Set<number>>();
  const recipientSources = new Map<number, Set<number>>();
  const canNums = cans.map((can) => can.id);
  const donorNumsAll = donors
    .map((idx) => canNums[idx])
    .filter((num): num is number => num !== undefined);
  const recipientNumsAll = recipients
    .map((idx) => canNums[idx])
    .filter((num): num is number => num !== undefined);

  interface EdgeRender {
    fromIdx: number;
    toIdx: number;
    fromNum: number;
    toNum: number;
    amt: number;
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    labelOffset: number;
    strokeWidth: number;
  }
  const edgesToRender: EdgeRender[] = [];

  // Collect all edges with geometry
  for (let i = 0; i < cans.length; i++) {
    for (let j = 0; j < cans.length; j++) {
      const amt = getTransferAmount(plan, i, j);
      if (amt <= 0) {continue;}

      const fromNode = donorColumnEl.querySelector(`[data-can-id="${i}"]`);
      const toNode = recipientColumnEl.querySelector(`[data-can-id="${j}"]`);
      if (!fromNode || !toNode) {continue;}

      const fromNum = canNums[i];
      const toNum = canNums[j];
      if (fromNum === undefined || toNum === undefined) {continue;}
      const fromRect = fromNode.getBoundingClientRect();
      const toRect = toNode.getBoundingClientRect();
      const x1 = fromRect.right - gridRect.left;
      const y1 = fromRect.top + fromRect.height / 2 - gridRect.top;
      const x2 = toRect.left - gridRect.left;
      const y2 = toRect.top + toRect.height / 2 - gridRect.top;
      minX = Math.min(minX, x1, x2);
      maxX = Math.max(maxX, x1, x2);

      let targetSet = donorTargets.get(fromNum);
      if (!targetSet) {
        targetSet = new Set<number>();
        donorTargets.set(fromNum, targetSet);
      }
      targetSet.add(toNum);

      let sourceSet = recipientSources.get(toNum);
      if (!sourceSet) {
        sourceSet = new Set<number>();
        recipientSources.set(toNum, sourceSet);
      }
      sourceSet.add(fromNum);

      edgesToRender.push({
        fromIdx: i,
        toIdx: j,
        fromNum,
        toNum,
        amt,
        x1,
        y1,
        x2,
        y2,
        labelOffset: 0,
        strokeWidth: 0,
      });
    }
  }

  // Offset labels per donor to avoid overlap while keeping the same anchor x
  const labelSpacing = 16;
  const edgesByFrom = new Map<number, EdgeRender[]>();
  for (const edge of edgesToRender) {
    const list = edgesByFrom.get(edge.fromIdx);
    if (list) {
      list.push(edge);
    } else {
      edgesByFrom.set(edge.fromIdx, [edge]);
    }
  }
  for (const list of edgesByFrom.values()) {
    list.sort((a, b) => a.y2 - b.y2);
    const mid = (list.length - 1) / 2;
    list.forEach((edge, idx) => {
      edge.labelOffset = (idx - mid) * labelSpacing;
    });
  }

  if (edgesToRender.length === 0) {
    return;
  }

  // Fit the SVG horizontally to just the space the edges occupy.
  const horizontalPadding = 16;
  if (!Number.isFinite(minX) || !Number.isFinite(maxX)) {
    minX = 0;
    maxX = 1;
  }
  const paddedMinX = minX - horizontalPadding;
  const paddedMaxX = maxX + horizontalPadding;
  const width = Math.max(1, Math.ceil(paddedMaxX - paddedMinX));
  graphSvgEl.setAttribute("width", String(width));
  graphSvgEl.setAttribute("height", String(height));
  graphSvgEl.setAttribute("viewBox", `${paddedMinX} 0 ${width} ${height}`);
  const panelLeft = panelRect?.left ?? gridRect.left;
  graphSvgEl.style.left = `${paddedMinX + gridRect.left - panelLeft}px`;
  graphSvgEl.style.right = "auto";
  graphSvgEl.style.width = `${width}px`;
  graphSvgEl.style.top = "0";
  graphSvgEl.style.bottom = "0";

  // Scale stroke/opacity to grams transferred so thicker flows represent more fuel.
  const maxAmt = edgesToRender.reduce((max, edge) => Math.max(max, edge.amt), 0);
  const minStroke = 1.5;
  const maxStroke = 12;
  const strokeForAmt = (amt: number): number => {
    if (maxAmt <= 0) {return minStroke;}
    const t = Math.sqrt(amt / maxAmt);
    return minStroke + (maxStroke - minStroke) * t;
  };

  // Draw thicker flows first so thinner ones sit on top.
  edgesToRender.sort((a, b) => b.amt - a.amt);

  const packEdgeGroup = (
    list: EdgeRender[],
    anchorY: number,
    sortKey: (edge: EdgeRender) => number,
    assign: (edge: EdgeRender, y: number) => void
  ): void => {
    if (list.length === 0) {return;}
    list.sort((a, b) => sortKey(a) - sortKey(b));
    const totalWidth = list.reduce((sum, edge) => sum + edge.strokeWidth, 0);
    let cursor = anchorY - totalWidth / 2;
    for (const edge of list) {
      cursor += edge.strokeWidth / 2;
      assign(edge, cursor);
      cursor += edge.strokeWidth / 2;
    }
  };

  // Compute stroke styles and pack recipient Y positions so strokes touch at the destination.
  const edgesByTo = new Map<number, EdgeRender[]>();
  for (const edge of edgesToRender) {
    edge.strokeWidth = strokeForAmt(edge.amt);
    const list = edgesByTo.get(edge.toIdx);
    if (list) {
      list.push(edge);
    } else {
      edgesByTo.set(edge.toIdx, [edge]);
    }
  }

  // Tag nodes with connection classes for CSS-only hover highlighting.
  for (const [fromNum, targets] of donorTargets.entries()) {
    const node = donorColumnEl.querySelector<HTMLElement>(`.donor-node[data-can-num="${fromNum}"]`);
    if (!node) {continue;}
    for (const toNum of targets) {
      node.classList.add(`link-to-${toNum}`);
    }
  }
  for (const [toNum, sources] of recipientSources.entries()) {
    const node = recipientColumnEl.querySelector<HTMLElement>(`.recipient-node[data-can-num="${toNum}"]`);
    if (!node) {continue;}
    for (const fromNum of sources) {
      node.classList.add(`link-from-${fromNum}`);
    }
  }

  // Pack donors (start Y) so strokes touch at the source.
  for (const list of edgesByFrom.values()) {
    const anchorY = list[0]?.y1 ?? 0;
    packEdgeGroup(list, anchorY, (edge) => edge.y2, (edge, y) => { edge.y1 = y; });
  }

  // Pack recipients (end Y) so strokes touch at the destination.
  for (const list of edgesByTo.values()) {
    const anchorY = list[0]?.y2 ?? 0;
    packEdgeGroup(list, anchorY, (edge) => edge.y1, (edge, y) => { edge.y2 = y; });
  }

  function addLabel(x: number, y: number, anchor: "start" | "middle" | "end", textValue: string): void {
    const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
    const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
    text.setAttribute("x", String(x));
    text.setAttribute("y", String(y));
    text.setAttribute("text-anchor", anchor);
    text.setAttribute("class", "edge-label");
    text.textContent = textValue;

    group.appendChild(text);
    graphSvgEl.appendChild(group);
  }

  for (const edge of edgesToRender) {
    const { toIdx, amt, x1, y1, x2, y2, labelOffset, strokeWidth } = edge;
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    const midX = (x1 + x2) / 2;
    // Nudge the start point slightly into the donor box so square caps meet the edge without gaps or overshoot.
    const startX = x1 - 1;
    path.setAttribute("d", `M ${startX} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`);
    path.setAttribute("fill", "none");
    path.setAttribute("class", "edge");
    path.dataset["fromNum"] = String(edge.fromNum);
    path.dataset["toNum"] = String(edge.toNum);
    path.style.setProperty("--edge-width", `${strokeWidth}px`);
    path.style.setProperty("--edge-opacity", "0.5");
    graphSvgEl.appendChild(path);

    const labelX = x1 + 12; // keep label aligned with donor
    const labelY = y1 + labelOffset;
    addLabel(labelX, labelY, "start", `${amt}g`);

    const prevSum = recipientSums.get(toIdx) ?? 0;
    recipientSums.set(toIdx, prevSum + amt);
  }

  for (const [toIdx, total] of recipientSums.entries()) {
    const toNode = recipientColumnEl.querySelector(`[data-can-id="${toIdx}"]`);
    if (!toNode) {continue;}
    const toRect = toNode.getBoundingClientRect();
    const x = toRect.left - gridRect.left - 10;
    const y = toRect.top + toRect.height / 2 - gridRect.top;

    addLabel(x, y, "end", `${total}g`);
  }

  const ensureHoverStyleEl = (): HTMLStyleElement => {
    if (hoverStyleEl && document.head.contains(hoverStyleEl)) {
      return hoverStyleEl;
    }
    const style = document.createElement("style");
    style.id = hoverStyleId;
    document.head.appendChild(style);
    hoverStyleEl = style;
    return style;
  };

  const donorEdgeNums = Array.from(donorTargets.keys());
  const recipientEdgeNums = Array.from(recipientSources.keys());
  const connectionPairs: { from: number; to: number }[] = [];
  const pairSeen = new Set<string>();
  for (const [from, targets] of donorTargets.entries()) {
    for (const to of targets) {
      const key = `${from}-${to}`;
      if (!pairSeen.has(key)) {
        pairSeen.add(key);
        connectionPairs.push({ from, to });
      }
    }
  }

  const graphScope = ".graph-panel";
  const shellScope = ".shell";

  const edgeHighlightSelectors = new Set<string>();
  edgeHighlightSelectors.add(`${graphScope} .edge:hover`);
  donorEdgeNums.forEach((id) => {
    edgeHighlightSelectors.add(`${graphScope}:has(.donor-node[data-can-num="${id}"]:hover) .edge[data-from-num="${id}"]`);
    edgeHighlightSelectors.add(`${shellScope}:has(.cell[data-can-num="${id}"]:hover) ${graphScope} .edge[data-from-num="${id}"]`);
  });
  recipientEdgeNums.forEach((id) => {
    edgeHighlightSelectors.add(`${graphScope}:has(.recipient-node[data-can-num="${id}"]:hover) .edge[data-to-num="${id}"]`);
    edgeHighlightSelectors.add(`${shellScope}:has(.cell[data-can-num="${id}"]:hover) ${graphScope} .edge[data-to-num="${id}"]`);
  });
  connectionPairs.forEach(({ from, to }) => {
    edgeHighlightSelectors.add(`${shellScope}:has(${graphScope} .edge[data-from-num="${from}"][data-to-num="${to}"]:hover) ${graphScope} .edge[data-from-num="${from}"]`);
    edgeHighlightSelectors.add(`${shellScope}:has(${graphScope} .edge[data-from-num="${from}"][data-to-num="${to}"]:hover) ${graphScope} .edge[data-to-num="${to}"]`);
  });

  const canHighlightSelectors = new Set<string>();
  // Self hover (nodes + cells)
  canHighlightSelectors.add(`${graphScope} .donor-node:hover`);
  canHighlightSelectors.add(`${graphScope} .recipient-node:hover`);
  canHighlightSelectors.add(`${shellScope} .cell[data-can-num]:hover`);
  // Edge hover to endpoints (nodes + cells)
  connectionPairs.forEach(({ from, to }) => {
    canHighlightSelectors.add(`${graphScope}:has(.edge[data-from-num="${from}"][data-to-num="${to}"]:hover) .donor-node[data-can-num="${from}"]`);
    canHighlightSelectors.add(`${graphScope}:has(.edge[data-from-num="${from}"][data-to-num="${to}"]:hover) .recipient-node[data-can-num="${to}"]`);
    canHighlightSelectors.add(`${shellScope}:has(${graphScope} .edge[data-from-num="${from}"][data-to-num="${to}"]:hover) .cell[data-can-num="${from}"]`);
    canHighlightSelectors.add(`${shellScope}:has(${graphScope} .edge[data-from-num="${from}"][data-to-num="${to}"]:hover) .cell[data-can-num="${to}"]`);
  });
  // Node hover to own cell
  donorNumsAll.forEach((id) => {
    canHighlightSelectors.add(`${shellScope}:has(.graph-panel .donor-node[data-can-num="${id}"]:hover) .cell[data-can-num="${id}"]`);
  });
  recipientNumsAll.forEach((id) => {
    canHighlightSelectors.add(`${shellScope}:has(.graph-panel .recipient-node[data-can-num="${id}"]:hover) .cell[data-can-num="${id}"]`);
  });
  // Cell hover to own node
  donorNumsAll.forEach((id) => {
    canHighlightSelectors.add(`${shellScope}:has(.cell[data-can-num="${id}"]:hover) ${graphScope} .donor-node[data-can-num="${id}"]`);
  });
  recipientNumsAll.forEach((id) => {
    canHighlightSelectors.add(`${shellScope}:has(.cell[data-can-num="${id}"]:hover) ${graphScope} .recipient-node[data-can-num="${id}"]`);
  });
  // Node hover to opposite nodes and cells via connections
  connectionPairs.forEach(({ from, to }) => {
    canHighlightSelectors.add(`${graphScope}:has(.donor-node[data-can-num="${from}"]:hover) .recipient-node[data-can-num="${to}"]`);
    canHighlightSelectors.add(`${shellScope}:has(.graph-panel .donor-node[data-can-num="${from}"]:hover) .cell[data-can-num="${to}"]`);
    canHighlightSelectors.add(`${graphScope}:has(.recipient-node[data-can-num="${to}"]:hover) .donor-node[data-can-num="${from}"]`);
    canHighlightSelectors.add(`${shellScope}:has(.graph-panel .recipient-node[data-can-num="${to}"]:hover) .cell[data-can-num="${from}"]`);
  });
  // Cell hover to opposite nodes and cells via connections
  connectionPairs.forEach(({ from, to }) => {
    canHighlightSelectors.add(`${shellScope}:has(.cell[data-can-num="${from}"]:hover) ${graphScope} .recipient-node[data-can-num="${to}"]`);
    canHighlightSelectors.add(`${shellScope}:has(.cell[data-can-num="${from}"]:hover) .cell[data-can-num="${to}"]`);
    canHighlightSelectors.add(`${shellScope}:has(.cell[data-can-num="${to}"]:hover) ${graphScope} .donor-node[data-can-num="${from}"]`);
    canHighlightSelectors.add(`${shellScope}:has(.cell[data-can-num="${to}"]:hover) .cell[data-can-num="${from}"]`);
  });

  const edgeHighlightList = Array.from(edgeHighlightSelectors);
  const canHighlightList = Array.from(canHighlightSelectors);

  const hoverCss = `
${edgeHighlightList.join(",\n")} {
  stroke: var(--color-focus);
  stroke-opacity: 0.95;
  filter: drop-shadow(0 0 6px rgba(0, 51, 153, 0.25));
}

${canHighlightList.join(",\n")} {
  border-color: var(--color-focus);
  box-shadow: 0 0 0 1px color-mix(in oklch, var(--color-focus) 35%, transparent), 0 6px 18px -12px rgba(0, 0, 0, 0.35);
}
`;

  const styleEl = ensureHoverStyleEl();
  styleEl.textContent = hoverCss;
}

function renderSolution(cans: readonly Can[], plan: Plan): void {
  if (!keepListEl || !transferListEl || !totalsListEl) {return;}

  const keepItems: ListItem[] = [];
  for (let i = 0; i < cans.length; i++) {
    if (!plan.keep[i]) {continue;}
    const can = cans[i];
    if (!can) {continue;}
    const finalFuel = getFinalFuel(plan, i);
    const canNum = can.id;
    keepItems.push({
      text: `Can #${canNum} — ${can.spec.name} — ${finalFuel}g fuel`,
    });
  }
  if (keepItems.length === 0) {
    keepItems.push({ text: "No cans kept", muted: true });
  }

  const transferItems: ListItem[] = [];
  let transferCount = 0;
  for (let i = 0; i < cans.length; i++) {
    for (let j = 0; j < cans.length; j++) {
      const amt = getTransferAmount(plan, i, j);
      if (amt > 0) {
        transferCount += 1;
        const fromCan = cans[i];
        const toCan = cans[j];
        if (!fromCan || !toCan) {continue;}
        const fromNum = fromCan.id;
        const toNum = toCan.id;
        transferItems.push({
          text: `Can #${fromNum} -> Can #${toNum} — ${amt}g`,
        });
      }
    }
  }
  if (transferItems.length === 0) {
    transferItems.push({ text: "No transfers needed", muted: true });
  }

  const totalFuel = plan.final_fuel.reduce((a, b) => a + b, 0);
  const totalWeight = cans.reduce(
    (sum, can, i) =>
      plan.keep[i] ? sum + can.spec.emptyWeight + getFinalFuel(plan, i) : sum,
    0
  );
  const keptCount = plan.keep.reduce((a, keep) => a + (keep ? 1 : 0), 0);

  const totalsItems: ListItem[] = [
    { text: `Total fuel: ${totalFuel}g` },
    { text: `Total weight to carry: ${totalWeight}g` },
    { text: `Cans carried: ${keptCount}` },
    { text: `Transfer steps: ${transferCount}` },
  ];

  renderList(keepListEl, keepItems);
  renderList(transferListEl, transferItems);
  renderList(totalsListEl, totalsItems);
}

// Initialize on load
renderColumns();
setStatus("idle", "Ready");
