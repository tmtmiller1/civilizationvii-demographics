// view-pills.js
//
// The shared "pill" selector: a row of rounded toggle buttons (one highlighted), used wherever the
// Demographics screen offers a small in-view choice (the Historical Data metric row, the migration
// metric/view group, etc.). One button per item; clicking a different one calls onPick(key).

/**
 * Build a pill-row selector.
 * @param {{key:*, label:string}[]} items The choices.
 * @param {*} activeKey The currently-selected key.
 * @param {(key:*)=>void} onPick Called with the chosen key when a different pill is clicked.
 * @returns {HTMLElement} The pill row element.
 */
export function pillRow(items, activeKey, onPick) {
  const row = document.createElement("div");
  row.className = "demographics-pill-row";
  row.style.cssText = "display:flex;gap:0.4rem;justify-content:center;margin:0.3rem 0;flex-wrap:wrap;";
  for (const it of items) {
    const b = document.createElement("div");
    b.textContent = it.label;
    const on = it.key === activeKey;
    b.style.cssText = "cursor:pointer;padding:0.34rem 1.15rem;border-radius:1rem;font-size:1rem;"
      + "border:0.0555rem solid rgba(201,162,76,0.4);"
      + (on ? "color:#1c1408;background:#f3c34c;font-weight:bold;" : "color:#bfae86;");
    b.addEventListener("click", () => { if (it.key !== activeKey) onPick(it.key); });
    row.appendChild(b);
  }
  return row;
}
