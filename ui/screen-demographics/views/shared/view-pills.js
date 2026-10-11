// view-pills.js
//
// The shared "pill" selector: a row of rounded toggle buttons (one highlighted), used wherever the
// Demographics screen offers a small in-view choice (the Historical Data metric row, the migration
// metric/view group, etc.). One button per item; clicking a different one calls onPick(key).

/**
 * The inline style for one selector button. Default is a rounded gold-filled pill (view choices,
 * e.g. the metric selector). `variant: "filter"` is the flat, square-cornered, gold-boxed look the
 * time/age filters use, for choices that filter or transform the data (Scaled vs Civ numbers).
 * @param {boolean} on
 * @param {string} [variant] "filter" for the flat boxed filter look, else the rounded pill.
 * @returns {string}
 */
function buttonStyle(on, variant) {
  // Type sizes come from the `--dg-fs-*` ladder (published from the player's Font Size setting by
  // screen-demographics.js) rather than literal rem, so these pills track that setting and the
  // density stylesheet's compaction the same way the CSS-class pills do. `--dg-fs-78` / `--dg-fs-100`
  // are the ladder steps for these pills' default sizes. Single-arg var() only; Coherent's parser
  // rejects the two-arg fallback form.
  if (variant === "filter") {
    return "cursor:pointer;padding:0.18rem 0.55rem;border-radius:0.2rem;font-size:var(--dg-fs-78);"
      + "text-transform:uppercase;letter-spacing:0.06em;border:1px solid rgba(201,162,76,0.4);"
      + (on
        ? "color:#f3c34c;background:rgba(60,45,20,0.85);border-color:rgba(243,195,76,0.95);font-weight:bold;"
        : "color:#bfae86;background:rgba(9,12,19,0.5);");
  }
  return "cursor:pointer;padding:0.34rem 1.15rem;border-radius:1rem;font-size:var(--dg-fs-100);"
    + "border:1px solid rgba(201,162,76,0.4);"
    + (on ? "color:#1c1408;background:#f3c34c;font-weight:bold;" : "color:#bfae86;");
}

/**
 * Build a pill-row selector.
 * @param {{key:*, label:string, marker?:string}[]} items The choices. An item's optional
 *   `marker` appends a small badge (e.g. "+") after the label to flag a drill-down.
 * @param {*} activeKey
 * @param {(key:*)=>void} onPick Called with the chosen key when a different pill is clicked.
 * @param {string} [variant] "filter" → flat boxed filter buttons (vs the default rounded pills).
 * @returns {HTMLElement}
 */
export function pillRow(items, activeKey, onPick, variant) {
  const row = document.createElement("div");
  row.className = "demographics-pill-row";
  // Two-value gap for consistency with the stylesheets. It is not a bug workaround: on 1.5.0
  // `gap:0.4rem` and `gap:0.4rem 0.4rem` measure identical on a wrapping flex row set through
  // this same style.cssText path. See the row-gap note at the top of
  // screen-demographics-base.css.
  row.style.cssText = "display:flex;gap:0.4rem 0.4rem;justify-content:center;margin:0.3rem 0;flex-wrap:wrap;";
  for (const item of items) {
    const button = document.createElement("div");
    button.textContent = item.label;
    button.style.cssText = buttonStyle(item.key === activeKey, variant);
    if (item.marker) {
      const badge = document.createElement("span");
      badge.textContent = item.marker;
      badge.style.cssText = "margin-left:0.3rem;font-weight:bold;";
      button.appendChild(badge);
    }
    button.addEventListener("click", () => {
      if (item.key !== activeKey) onPick(item.key);
    });
    row.appendChild(button);
  }
  return row;
}
