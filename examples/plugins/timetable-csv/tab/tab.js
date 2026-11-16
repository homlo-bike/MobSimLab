// Tab page of the example plugin. It runs in a sandboxed frame with no network and no access to the app;
// everything goes through the app's message API (docs/plugins/README.md#tabs).
"use strict";

let next = 1;
const waiting = new Map();

window.addEventListener("message", (e) => {
  if (e.source !== window.parent || !e.data || e.data.mobsimlab !== 1) return;
  const w = waiting.get(e.data.id);
  if (!w) return;
  waiting.delete(e.data.id);
  if ("error" in e.data) w.reject(new Error(e.data.error));
  else w.resolve(e.data.result);
});

/** Ask the app; resolves with the result or rejects with the app's message. */
function ask(method, params) {
  const id = next++;
  return new Promise((resolve, reject) => {
    waiting.set(id, { resolve, reject });
    window.parent.postMessage({ mobsimlab: 1, id, method, params }, "*");
  });
}

const status = document.getElementById("status");

function cell(row, value, numeric) {
  const td = document.createElement("td");
  td.textContent = value === null || value === undefined ? "–" : String(value);
  if (numeric) td.className = "n";
  row.append(td);
}

async function show() {
  status.textContent = "Calculating…";
  try {
    const out = await ask("run", { calculation: "route_summary" });
    const kpis = document.getElementById("kpis");
    kpis.replaceChildren();
    for (const k of out.kpis || []) {
      const dt = document.createElement("dt");
      dt.textContent = k.label;
      const dd = document.createElement("dd");
      dd.textContent = String(k.value);
      kpis.append(dt, dd);
    }
    const table = document.getElementById("table");
    const head = document.createElement("tr");
    for (const c of out.table.columns) {
      const th = document.createElement("th");
      th.textContent = c.unit ? `${c.label} (${c.unit})` : c.label;
      head.append(th);
    }
    table.tHead.replaceChildren(head);
    table.tBodies[0].replaceChildren(
      ...out.table.rows.map((r) => {
        const tr = document.createElement("tr");
        r.forEach((v) => cell(tr, v, typeof v === "number"));
        return tr;
      }),
    );
    table.hidden = out.table.rows.length === 0;
    status.textContent = out.table.rows.length ? "" : "The project has no routes with trips yet.";
  } catch (e) {
    status.textContent = e.message;
  }
}

ask("context").then((ctx) => {
  document.documentElement.lang = ctx.language;
  document.documentElement.dataset.theme = ctx.theme;
  show();
});
document.getElementById("again").addEventListener("click", show);
