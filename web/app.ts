import "./styles.css";
import { computePlan, SPECS, type Can, type Plan, type CanSpec } from "./solver";

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
const statusEl = document.getElementById("status") as HTMLDivElement;
const resultsEl = document.getElementById("results") as HTMLDivElement;
const donorColumnEl = document.getElementById("donor-column") as HTMLDivElement;
const recipientColumnEl = document.getElementById("recipient-column") as HTMLDivElement;
const graphGridEl = document.querySelector<HTMLDivElement>(".graph-grid");
const graphSvgEl = document.getElementById("graph-svg") as unknown as SVGSVGElement;
const outputEl = document.getElementById("output") as HTMLPreElement;
const inputErrorsEl = document.getElementById("input-errors") as HTMLDivElement | null;
const overflowErrorEl = document.querySelector<HTMLDivElement>('[data-error="overflow"]');
const underflowErrorEl = document.querySelector<HTMLDivElement>('[data-error="underflow"]');
let computeTimer: number | null = null;
let computeGeneration = 0;

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

async function runCompute(): Promise<void> {
  const requestId = ++computeGeneration;
  // Gather all filled cans
  const cans: Can[] = [];
  let foundUnderflow = false;
  let foundOverflow = false;

  for (const spec of SPECS) {
    const cells = columnsEl.querySelectorAll<HTMLInputElement>(`.cells[data-spec="${spec.key}"] input`);

    for (const input of Array.from(cells)) {
      const gross = parseFloat(input.value);
      if (!isNaN(gross) && gross > 0) {
        const fuel = Math.max(0, gross - spec.emptyWeight);
        if (gross < spec.emptyWeight) {foundUnderflow = true;}
        if (fuel > spec.capacity) {foundOverflow = true;}
        cans.push({ id: -1, spec, fuel, gross });
      }
    }
  }

  if (cans.length === 0) {
    if (requestId !== computeGeneration) {return;}
    statusEl.textContent = "Add gross weights to compute";
    statusEl.classList.remove("error");
    if (inputErrorsEl !== null) {
      inputErrorsEl.setAttribute("data-visible", "false");
    }
    resultsEl.setAttribute("data-visible", "false");
    donorColumnEl.innerHTML = "";
    recipientColumnEl.innerHTML = "";
    graphSvgEl.innerHTML = "";
    outputEl.textContent = "";
    return;
  }

  if (foundUnderflow || foundOverflow) {
    statusEl.textContent = "Invalid input found. Fix the highlighted cans.";
    statusEl.classList.add("error");
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
    donorColumnEl.innerHTML = "";
    recipientColumnEl.innerHTML = "";
    graphSvgEl.innerHTML = "";
    outputEl.textContent = "";
    return;
  }

  statusEl.textContent = "Solving…";
  statusEl.classList.remove("error");
  if (inputErrorsEl !== null) {
    inputErrorsEl.setAttribute("data-visible", "false");
  }
  resultsEl.setAttribute("data-visible", "false");

  try {
    const { plan, cans: canObjects } = await computePlan(cans);
    if (requestId !== computeGeneration) {return;}

    // Render graph visualization
    renderGraph(canObjects, plan);

    // Render text output
    renderTextOutput(canObjects, plan);

    // Show results using CSS data attribute
    resultsEl.setAttribute("data-visible", "true");
    statusEl.textContent = "Complete";
  } catch (err: unknown) {
    if (requestId !== computeGeneration) {return;}
    statusEl.textContent = `Error: ${err instanceof Error ? err.message : String(err)}`;
    statusEl.classList.add("error");
  }
}

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

    applyFillStyle(node, can.fuel, can.spec.capacity);

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

    applyFillStyle(node, finalFuel, can.spec.capacity);

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
  const recipientSums = new Map<number, number>();

  interface EdgeRender {
    fromIdx: number;
    toIdx: number;
    amt: number;
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    labelOffset: number;
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

      const fromRect = fromNode.getBoundingClientRect();
      const toRect = toNode.getBoundingClientRect();
      const x1 = fromRect.right - gridRect.left;
      const y1 = fromRect.top + fromRect.height / 2 - gridRect.top;
      const x2 = toRect.left - gridRect.left;
      const y2 = toRect.top + toRect.height / 2 - gridRect.top;

      edgesToRender.push({ fromIdx: i, toIdx: j, amt, x1, y1, x2, y2, labelOffset: 0 });
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

    const bbox = text.getBBox();
    const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    rect.setAttribute("x", String(bbox.x - 4));
    rect.setAttribute("y", String(bbox.y - 2));
    rect.setAttribute("width", String(bbox.width + 8));
    rect.setAttribute("height", String(bbox.height + 4));
    rect.setAttribute("rx", "4");
    rect.setAttribute("class", "edge-label-bg");

    group.insertBefore(rect, text);
  }

  for (const edge of edgesToRender) {
    const { toIdx, amt, x1, y1, x2, y2, labelOffset } = edge;
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    const midX = (x1 + x2) / 2;
    path.setAttribute("d", `M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`);
    path.setAttribute("fill", "none");
    path.setAttribute("class", "edge");
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
renderColumns();
