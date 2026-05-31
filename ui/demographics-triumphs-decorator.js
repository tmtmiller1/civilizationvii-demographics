// demographics-triumphs-decorator.js
//
// Augments the native Legacies → Triumphs cards with per-civilization
// progress bars. Replaces the cloned Race tab that previously lived
// inside the Demographics screen; bars now render directly on the
// in-game cards.
//
// On first use, builds a (localized-name → GameInfo.Legacies row) map.
// A MutationObserver watches the document for nodes with `.triumph-card`
// (the class applied by native triumph-card.js). For each card we
// resolve the legacy row from the title text, query each major civ's
// progress via Players.get(pid).Legacies.getProgress(legacyType), and
// append a bars block to the card.
//
// A `_demographicsDecorated` sentinel on each card prevents re-injection
// on Solid reactivity updates.

const DBG = true;
function dlog(...a) {
  if (DBG) console.warn("[Demographics.triumphsDecorator]", ...a);
}
function derr(...a) {
  console.error("[Demographics.triumphsDecorator]", ...a);
}

let _nameToRow = null;
function buildNameToRow() {
  if (_nameToRow) return _nameToRow;
  _nameToRow = new Map();
  try {
    if (typeof GameInfo === "undefined" || !GameInfo.Legacies) return _nameToRow;
    for (const row of GameInfo.Legacies) {
      if (!row || !row.Name) continue;
      let name = row.Name;
      try {
        if (typeof Locale?.compose === "function") {
          const c = Locale.compose(row.Name);
          if (typeof c === "string" && c.length > 0) name = c;
        }
      } catch (_) {
        /* */
      }
      const key = name.trim().toUpperCase();
      // Race triumphs (LegacyType ending in "_RACE") are FirstPlayerOnly
      // and share their display name with a paired non-race row whose
      // LegacyType is the same string without "_RACE". The paired row
      // is the one with actual per-civ getProgress data — the _RACE
      // row returns null progress. Prefer the non-_RACE row whenever
      // a name collision occurs.
      const existing = _nameToRow.get(key);
      const isRace = typeof row.LegacyType === "string" && /_RACE$/.test(row.LegacyType);
      if (existing) {
        const existingIsRace =
          typeof existing.LegacyType === "string" && /_RACE$/.test(existing.LegacyType);
        if (existingIsRace && !isRace) {
          _nameToRow.set(key, row); // upgrade to non-race
        }
        // Otherwise keep existing (we already have non-race, or
        // both are race — either way, no win in overwriting).
      } else {
        _nameToRow.set(key, row);
      }
    }
    dlog("nameToRow built; entries=" + _nameToRow.size);
  } catch (e) {
    derr("buildNameToRow:", e?.message);
  }
  return _nameToRow;
}

function alliveMajorIds() {
  try {
    if (typeof Players?.getAliveMajorIds === "function") {
      return Array.from(Players.getAliveMajorIds());
    }
  } catch (_) {
    /* */
  }
  return [];
}

function civDisplayName(pid) {
  try {
    const p = Players.get(pid);
    let leader = "";
    let civ = "";
    try {
      if (typeof p?.leaderName === "string") leader = Locale.compose(p.leaderName);
    } catch (_) {}
    try {
      if (typeof p?.civilizationName === "string") civ = Locale.compose(p.civilizationName);
    } catch (_) {}
    if (leader && civ) return leader + " (" + civ + ")";
    return leader || civ || "Player " + pid;
  } catch (_) {
    return "Player " + pid;
  }
}

function civColor(pid) {
  try {
    if (typeof UI?.Player?.getPrimaryColorValueAsString === "function") {
      const s = UI.Player.getPrimaryColorValueAsString(pid);
      if (typeof s === "string" && s.length > 0) {
        const m = s.match(/^#?([0-9a-fA-F]{6,8})$/);
        if (m) return "#" + m[1].slice(-6);
      }
    }
  } catch (_) {
    /* */
  }
  return "#85878c";
}

// Enumerate every major-civ pid we can find. `Players.getAliveMajorIds` is
// the canonical accessor when present; if not, scan the Players list for
// `isMajor` flags. Either way, log on first invocation so we know what we
// got.
let _pidsLogged = false;
function allMajorPids() {
  let pids = [];
  try {
    if (typeof Players?.getAliveMajorIds === "function") {
      pids = Array.from(Players.getAliveMajorIds());
    }
  } catch (_) {
    /* */
  }
  if (pids.length === 0) {
    // Fallback: probe pid 0..63 for major civs.
    try {
      for (let i = 0; i < 64; i++) {
        const p = Players?.get?.(i);
        if (!p) continue;
        const isMajor = (p.isMajor === true || p.isAlive === true) && !p.isMinor;
        if (isMajor) pids.push(i);
      }
    } catch (_) {
      /* */
    }
  }
  if (!_pidsLogged) {
    _pidsLogged = true;
    dlog("allMajorPids returned:", JSON.stringify(pids));
    // Probe pid 0's Legacies API to see what's available.
    try {
      const p0 = Players?.get?.(pids[0] ?? 0);
      const pl = p0?.Legacies;
      dlog(
        "Players.get(" + (pids[0] ?? 0) + ") =",
        typeof p0,
        "Legacies =",
        typeof pl,
        "Legacies.getProgress =",
        typeof pl?.getProgress,
        "Legacies keys =",
        pl ? Object.keys(pl).slice(0, 10).join(",") : "n/a"
      );
    } catch (e) {
      dlog("probe failed:", e?.message);
    }
  }
  return pids;
}

let _firstRowLogged = false;
function getProgressForRow(row) {
  const out = [];
  let total = 0;
  let winner = -1;
  try {
    const pids = allMajorPids();
    let logSamples = [];
    for (const pid of pids) {
      const p = Players.get(pid);
      const pl = p?.Legacies;
      if (!pl) continue;
      let prog = null;
      try {
        prog = pl.getProgress?.(row.LegacyType);
      } catch (_) {}
      let triggered = false;
      try {
        triggered = !!pl.isTriggered?.(row.LegacyType);
      } catch (_) {}
      const cur = prog?.progress?.[0]?.current ?? 0;
      const tot = prog?.progress?.[0]?.total ?? 0;
      if (tot > total) total = tot;
      if (typeof prog?.raceWinner === "number" && prog.raceWinner !== -1) winner = prog.raceWinner;
      if (!_firstRowLogged && logSamples.length < 3) {
        logSamples.push({
          pid,
          hasProg: !!prog,
          progStr: prog ? JSON.stringify(prog).slice(0, 200) : "null",
          triggered,
          cur,
          tot
        });
      }
      // Include EVERY major civ — even zero-progress — so every card
      // renders at the same height regardless of how many civs are
      // making progress on a particular triumph.
      out.push({ pid, current: cur, total: tot, triggered });
    }
    if (!_firstRowLogged) {
      _firstRowLogged = true;
      dlog("first-row probe for " + row.LegacyType + ":", JSON.stringify(logSamples));
    }
    out.sort((a, b) => {
      if (a.pid === winner && b.pid !== winner) return -1;
      if (b.pid === winner && a.pid !== winner) return 1;
      if (a.triggered !== b.triggered) return a.triggered ? -1 : 1;
      if (a.current !== b.current) return b.current - a.current;
      return a.pid - b.pid; // stable tiebreak
    });
  } catch (_) {
    /* */
  }
  return { civs: out, total, winner };
}

let _logCount = 0;
function decorateCard(card) {
  if (!card || card._demographicsDecorated) return;

  // Read the triumph title. The native template structure varies — try
  // several selectors and fall back to scanning all descendants for an
  // uppercase font-title bearing element.
  let titleEl =
    card.querySelector(".text-secondary.uppercase.font-title") ||
    card.querySelector(".font-title.uppercase") ||
    card.querySelector(".font-title");
  if (!titleEl) {
    if (_logCount < 5) dlog("no title el on card; sample html=", card.outerHTML?.slice(0, 400));
    _logCount++;
    return;
  }
  const rawText = (titleEl.textContent || "").trim();
  const titleText = rawText.toUpperCase();
  if (titleText.length === 0) {
    if (_logCount < 5) dlog("title empty; card.outerHTML snippet=", card.outerHTML?.slice(0, 300));
    _logCount++;
    return;
  }

  const map = buildNameToRow();
  let row = map.get(titleText);
  if (!row) {
    // Try a substring match — sometimes the native L10n composer wraps
    // the name with "[STYLE]"-style tags that we strip in nameToRow.
    for (const [k, v] of map.entries()) {
      if (k.includes(titleText) || titleText.includes(k)) {
        row = v;
        break;
      }
    }
  }
  if (!row) {
    if (_logCount < 10)
      dlog(
        "no row match for title='" + rawText + "' (keys sample:",
        Array.from(map.keys()).slice(0, 5),
        ")"
      );
    _logCount++;
    return;
  }

  // Mark decorated FIRST so a Solid reactivity re-render doesn't double up.
  card._demographicsDecorated = true;

  const { civs, total, winner } = getProgressForRow(row);
  dlog(
    "decorating card title='" +
      rawText +
      "' legacyType=" +
      row.LegacyType +
      " civsWithProgress=" +
      civs.length +
      " total=" +
      total
  );
  if (civs.length === 0) {
    // Couldn't enumerate any major civs — skip rather than render an
    // empty box. (Goal is unknown OR Players API isn't ready.)
    return;
  }

  const box = document.createElement("div");
  box.className = "demographics-triumph-progress";
  box.style.cssText = [
    "width:100%",
    "margin-top:0.6rem",
    "padding:0.4rem 0.55rem 0.3rem",
    "background:rgba(20, 16, 10, 0.45)",
    "border:1px solid rgba(168, 132, 90, 0.30)",
    "border-radius:0.15rem",
    "display:flex",
    "flex-direction:column",
    "gap:0.18rem",
    "pointer-events:none"
  ].join(";");

  const heading = document.createElement("div");
  heading.style.cssText = [
    "font-family:TitleFont, BodyFont, sans-serif",
    "color:#e5d2ac",
    "font-size:0.7rem",
    "font-weight:700",
    "text-transform:uppercase",
    "letter-spacing:0.1em",
    "margin-bottom:0.15rem",
    "text-align:center",
    "opacity:0.85"
  ].join(";");
  heading.textContent = "Civilization Progress";
  box.appendChild(heading);

  if (civs.length === 0) {
    const empty = document.createElement("div");
    empty.style.cssText = "font-size:0.7rem;color:#85878c;font-style:italic;text-align:center;";
    empty.textContent = "No civilization has made progress yet.";
    box.appendChild(empty);
  } else {
    for (const c of civs) {
      const row2 = document.createElement("div");
      row2.style.cssText =
        "display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.4fr) minmax(2.3rem,auto);gap:0.4rem;align-items:center;";

      const nameCell = document.createElement("div");
      nameCell.style.cssText = "display:flex;align-items:center;gap:0.3rem;min-width:0;";
      const dot = document.createElement("span");
      dot.style.cssText =
        "width:0.42rem;height:0.42rem;border-radius:50%;flex-shrink:0;background:" +
        civColor(c.pid) +
        ";";
      nameCell.appendChild(dot);
      const nm = document.createElement("span");
      nm.style.cssText =
        "font-size:0.7rem;color:" +
        (c.pid === winner ? "#f3c34c" : "#e5d2ac") +
        ";font-weight:" +
        (c.pid === winner ? "700" : "500") +
        ";overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;";
      nm.textContent = civDisplayName(c.pid);
      nameCell.appendChild(nm);
      row2.appendChild(nameCell);

      const bar = document.createElement("div");
      bar.style.cssText =
        "position:relative;height:0.28rem;background:rgba(20,16,10,0.7);border:1px solid rgba(168,132,90,0.4);border-radius:0.1rem;overflow:hidden;";
      if (total > 0 && c.current > 0) {
        const fill = document.createElement("div");
        const pct = Math.min(100, (c.current / total) * 100);
        fill.style.cssText =
          "position:absolute;left:0;top:0;bottom:0;width:" +
          pct +
          "%;background:" +
          (c.triggered ? "#f3c34c" : "#49d182") +
          ";opacity:" +
          (c.triggered ? "0.95" : "0.85") +
          ";";
        bar.appendChild(fill);
      }
      row2.appendChild(bar);

      const num = document.createElement("div");
      num.style.cssText =
        "font-family:monospace, ui-monospace;font-size:0.68rem;color:" +
        (c.pid === winner ? "#f3c34c" : "#c2c4cc") +
        ";text-align:right;font-weight:" +
        (c.triggered ? "700" : "500") +
        ";";
      num.textContent = c.current + "/" + total + (c.triggered ? " ✓" : "");
      row2.appendChild(num);

      box.appendChild(row2);
    }
  }

  card.appendChild(box);
}

function sweepRoot(root) {
  if (!root || typeof root.querySelectorAll !== "function") return;
  root.querySelectorAll(".triumph-card").forEach(decorateCard);
}

function bootstrap() {
  dlog("bootstrap");
  sweepRoot(document.body);
  const observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      for (const node of m.addedNodes) {
        if (node.nodeType !== 1) continue;
        if (node.classList?.contains("triumph-card")) {
          decorateCard(node);
        } else if (typeof node.querySelectorAll === "function") {
          sweepRoot(node);
        }
      }
      // Solid may patch text into existing nodes — re-sweep on any
      // attribute change that signals the card finished hydrating.
      if (m.type === "characterData" || m.type === "childList") {
        const t = m.target;
        if (t && t.nodeType === 1 && typeof t.closest === "function") {
          const card = t.closest?.(".triumph-card");
          if (card && !card._demographicsDecorated) decorateCard(card);
        }
      }
    }
  });
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true
  });
  dlog("MutationObserver attached");
}

if (document.readyState === "complete" || document.readyState === "interactive") {
  bootstrap();
} else {
  document.addEventListener("DOMContentLoaded", bootstrap);
}
