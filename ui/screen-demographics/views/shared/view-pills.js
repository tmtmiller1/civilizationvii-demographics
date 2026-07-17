// view-pills.js
//
// The shared "pill" selector: a row of rounded toggle buttons (one highlighted), used wherever the
// Demographics screen offers a small in-view choice (the Historical Data metric row, the migration
// metric/view group, etc.). One button per item; clicking a different one calls onPick(key).

/**
 * The inline style for one selector button. Default = a rounded gold-FILLED pill (view choices,
 * e.g. the metric selector). `variant: "filter"` = the flat, square-cornered, gold-BOXED look the
 * time/age
 * filters use, for choices that FILTER/transform the data (e.g. Scaled vs Civ numbers).
 * @param {boolean} on Whether this button is the active one.
 * @param {string} [variant] "filter" for the flat boxed filter look, else the rounded pill.
 * @returns {string} The cssText.
 */
function buttonStyle(on, variant) {
  if (variant === "filter") {
    return "cursor:pointer;padding:0.18rem 0.55rem;border-radius:0.2rem;font-size:0.78rem;"
      + "text-transform:uppercase;letter-spacing:0.06em;border:0.0555rem solid rgba(201,162,76,0.4);"
      + (on
        ? "color:#f3c34c;background:rgba(60,45,20,0.85);border-color:rgba(243,195,76,0.95);font-weight:bold;"
        : "color:#bfae86;background:rgba(9,12,19,0.5);");
  }
  return "cursor:pointer;padding:0.34rem 1.15rem;border-radius:1rem;font-size:1rem;"
    + "border:0.0555rem solid rgba(201,162,76,0.4);"
    + (on ? "color:#1c1408;background:#f3c34c;font-weight:bold;" : "color:#bfae86;");
}

/**
 * Build a pill-row selector.
 * @param {{key:*, label:string, marker?:string}[]} items The choices. An item's optional
 *   `marker` appends a small badge (e.g. "+") after the label to flag a drill-down.
 * @param {*} activeKey The currently-selected key.
 * @param {(key:*)=>void} onPick Called with the chosen key when a different pill is clicked.
 * @param {string} [variant] "filter" → flat boxed filter buttons (vs the default rounded pills).
 * @returns {HTMLElement} The pill row element.
 */
export function pillRow(items, activeKey, onPick, variant) {
  const row = document.createElement("div");
  row.className = "demographics-pill-row";
  row.style.cssText = "display:flex;gap:0.4rem;justify-content:center;margin:0.3rem 0;flex-wrap:wrap;";
  for (const it of items) {
    const b = document.createElement("div");
    b.textContent = it.label;
    b.style.cssText = buttonStyle(it.key === activeKey, variant);
    if (it.marker) {
      const badge = document.createElement("span");
      badge.textContent = it.marker;
      badge.style.cssText = "margin-left:0.3rem;font-weight:bold;";
      b.appendChild(badge);
    }
    b.addEventListener("click", () => { if (it.key !== activeKey) onPick(it.key); });
    row.appendChild(b);
  }
  return row;
}
