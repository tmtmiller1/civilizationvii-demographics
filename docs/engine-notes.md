# Demographics — engine research notes (developer reference)

Dev-only. **Not shipped** (excluded from the release zip). This preserves the
hard-won engine-channel research that previously lived in the user-facing "About"
view, which was removed to keep player-facing UI free of engineering autopsy notes.

## Cross-age persistence: why it's impossible today

A single graph spanning Antiquity → Exploration → Modern is not possible in Civ VII
today. The mod can only plot the age it is currently in: when a new age boots, the
mod restarts with an empty history and re-samples from turn one of that age. The
blocker is **storage, not display** — every channel a mod can reach to persist data
is either wiped at the age transition or absent from the engine binary.

### Channels tested

| Channel | Result |
|---|---|
| `GameTutorial.setProperty` | wiped at age transition |
| `Players[pid].Tutorial.setProperty` | wiped at age transition (but survives *within* an age — this is what the mod uses) |
| JS module heap / `globalThis` | module reloaded at age transition |
| `localStorage.setItem` | does not survive process restart |
| LiveEvent flags | session-scoped, inverted, 1-bit |
| `Modding.setModProperty` | `typeof undefined` (binding absent; getter exists) |
| `HallofFame.setDataPoint` / `adjustDataPoint` / `getOrCreateDataPoint` | `typeof undefined` |
| `HallofFame.setDataSetValue` / `adjustDataSetValue` / `getOrCreateDataSet` | `typeof undefined` |
| `HallofFame.createObject` / `addRulesetType` | `typeof undefined` |
| `HallofFame.getGraphs(currentGameId)` | in-progress game returns `[]`; the HoF DB only commits completed games |
| `Network.saveGame` variants | deadlocks the game |
| `Database.execute` | no such method (`query` is read-only) |
| `engine.call` / PlayerOperations | fixed op enum, no generic K/V |
| `GameStateStorage.*` | save-file query API, not a K/V store |
| `UI.getClipboardText` | no such symbol in the binary |
| Local file I/O / `fetch` / `coui://` | no JS file-write surface present |

### What would unblock cross-age history (engine-side asks)

- **Activate `Modding.setModProperty`** — the getter `Modding.getModProperty(key)` exists;
  the setter is undefined. A small binding around a SQLite K/V table mods can write to.
- **Don't wipe `Players[pid].Tutorial.setProperty`** — it works perfectly within an age;
  the wipe could skip mod-namespaced keys (e.g. anything prefixed `MOD_`).
- **Expose `HallofFame.getGraphs()` for in-progress games** — schema + per-turn writes
  already exist; only the JS binding for in-progress reads is missing.
- **A documented per-mod save-file section** — one TEXT blob per mod-id, round-tripped
  through the standard save/load path.

Consequence in the UI: the cross-age time-range filters (All Time, 1st/2nd/3rd Age) are
disabled; only within-age windows (year ranges, Current Age) are meaningful.

## CSV export: why clipboard, not a file

Civ VII's UI runs inside the Coherent GameFace sandbox, which strips the browser APIs
that would drive a download — `URL.createObjectURL`, the `download` attribute, the File
System Access API, and direct disk writes are all absent, and there's no scripting hook
for a Save-As dialog. The clipboard (`UI.setClipboardText`) is the one reliable hand-off,
with a full copy also written to the log as a fallback when the payload is small enough.

Size thresholds the export uses:

| Size | Behavior |
|---|---|
| < 2 MB | full clipboard + full log dump |
| 2–8 MB | clipboard only; log summary (avoids stalling the log writer) |
| > 8 MB | refused; lower the History sample cap in Options and retry |

Typical sizes: standard speed / 10 civs / ~500 turns ≈ 1.5 MB; marathon / 10 civs ≈ 4 MB;
power-user *Unlimited samples* + marathon + 14 civs can exceed 8 MB.
