// history-capture.js
//
// Game-scope capture loop. Once per local turn (and immediately on a victory, a defeat or the end of
// an age) it reads the world, diffs it against the last state, appends the resulting chronicle
// events and a trend sample to the CampaignDoc, saves it into the save file and refreshes the Hall
// of Fame record. State diffing means changes made during other players' turns are still recorded.

import { log, safe } from "/demographics/ui/history/core/history-log.js";
import {
  everMajors,
  infoRow,
  legacyBlurb,
  playerIdentity,
  readWorld,
  turnDate
} from "/demographics/ui/history/capture/history-world.js";
import { diffWorld } from "/demographics/ui/history/capture/history-diff.js";
import {
  appendEvents,
  appendSample,
  applyOutcome,
  ensureAge,
  newCampaign,
  noteTriumphs,
  upsertPlayer
} from "/demographics/ui/history/store/history-campaign.js";
import { loadCampaign, saveCampaign } from "/demographics/ui/history/store/history-campaign-store.js";
import { buildRecord, recordTags } from "/demographics/ui/history/store/history-archive.js";
import { t, legacyWhyKey, legacyWhatKey, plainText } from "/demographics/ui/history/core/history-text.js";
import { saveRecord } from "/demographics/ui/history/store/history-archive-store.js";
import { live } from "/demographics/ui/history/capture/history-live.js";
import { newCrisisState, crisisStep } from "/demographics/ui/history/capture/history-crisis.js";
import { captureMap } from "/demographics/ui/history/capture/history-mapgrid.js";
import { risingEvents } from "/demographics/ui/history/capture/history-risings.js";
import { flavorCrisisName } from "/demographics/ui/screen-demographics/charts/crises/crisis-names.js";
import { getGameSeed } from "/demographics/ui/screen-demographics/screen/guarded-reads.js";

/** @typedef {(...args: any[]) => void} Handler */
/**
 * @type {{started: boolean, listeners: Array<[string, Handler]>, errors: number, lastTurn: number,
 *   lastAge: string}}
 */
const state = { started: false, listeners: [], errors: 0, lastTurn: -1, lastAge: "" };
const MAX_ERRORS = 25;

/** @type {import("./history-diff.js").Namer} */
const NAMER = {
  wonder: (type) => infoRow("Constructibles", type)?.Name || "",
  triumph: (type) => infoRow("Legacies", type)?.Name || "",
  civ: (type) => infoRow("Civilizations", type)?.Name || "",
  age: (type) => infoRow("Ages", type)?.Name || "",
  victory: (type) => infoRow("Victories", type)?.Name || "",
  teamPlayer: (team) => everMajors().find((player) => safe(() => player.team, -2) === team)?.id ?? -1
};

/**
 * @returns {number} The local player id, or -1.
 */
function localId() {
  return Number(safe(() => GameContext.localPlayerID, -1));
}

/**
 * Whether this is a networked multiplayer game (internet, LAN, wireless, cloud). Hotseat is
 * multiplayer too but every seat is this machine, so it is not "networked" here.
 * @returns {boolean}
 */
export function isNetworkMultiplayer() {
  return !!safe(() => Configuration.getGame().isNetworkMultiplayer, false);
}

/**
 * Whether the local player hosts the game. Single-player and hotseat count as hosting.
 * @returns {boolean}
 */
export function isHost() {
  if (!isNetworkMultiplayer()) return true;
  const byApi = safe(() => (typeof Network.isHost === "function" ? Network.isHost() : undefined), undefined);
  if (typeof byApi === "boolean") return byApi;
  const hostId = Number(safe(() => Network.getHostPlayerId(), -1));
  return hostId >= 0 && hostId === localId();
}

/**
 * Whether this client may store the campaign in the shared game configuration. In a networked
 * game the host owns that object and is the only client that writes it; guests keep the campaign
 * in memory (History and the Hall of Fame keep working live) and read the host's copy on load.
 * @param {{network: boolean, host: boolean}} session Whether the game is networked and this client hosts it.
 * @returns {boolean}
 */
export function mayStoreCampaign(session) {
  return !session.network || session.host;
}

/**
 * Whether a "turn" sample should be taken: once per game turn, whichever seat's turn starts it
 * (hotseat raises PlayerTurnActivated for every human seat in the same turn). Other reasons
 * (load, victory, defeat, age end) always sample.
 * @param {{lastTurn: number, lastAge: string}} st Capture state (mutated when the sample is taken).
 * @param {number} turn
 * @param {string} age
 * @param {string} reason
 * @returns {boolean}
 */
export function shouldSampleTurn(st, turn, age, reason) {
  if (reason === "turn" && st.lastTurn === turn && st.lastAge === age) return false;
  st.lastTurn = turn;
  st.lastAge = age;
  return true;
}

/**
 * Give a stored campaign this client's viewpoint. A guest in a networked game loads the host's
 * copy, whose "local" player is the host; the guest's own civilization is what "mine" should mean.
 * @param {CampaignDoc} doc Mutated.
 * @param {number} local This client's player id.
 * @param {boolean} network
 * @returns {CampaignDoc} The same document.
 */
export function adoptViewpoint(doc, local, network) {
  if (network && local >= 0 && doc.local !== local) doc.local = local;
  return doc;
}

/**
 * Setup facts for the archive, as LOC name tags.
 * @returns {HistorySetup}
 */
export function readSetup() {
  const cfg = safe(() => Configuration.getGame(), null);
  const map = safe(() => Configuration.getMap(), null);
  return {
    speed: String(safe(() => cfg.gameSpeedName, "") || ""),
    difficulty: String(safe(() => cfg.difficultyName, "") || ""),
    mapSize: String(safe(() => infoRow("Maps", map.mapSize)?.Name, "") || ""),
    mapScript: String(safe(() => map.script, "") || ""),
    startAge: String(safe(() => infoRow("Ages", cfg.startAgeType)?.AgeType, "") || "")
  };
}

/**
 * A seed that identifies this campaign's map across ages and reloads.
 */
function campaignSeed() {
  const mapSeed = Number(safe(() => Configuration.getMap().mapSeed, 0));
  return mapSeed || Number(safe(() => Configuration.getGame().gameSeed, 0)) || 0;
}

/**
 * The campaign's id: the game's setup GUID and map seed, so starting the record again for the same
 * game lands on the same Hall of Fame entry instead of a duplicate. Random only when the game
 * offers neither.
 * @param {number} seed Map seed.
 * @returns {string}
 */
export function campaignId(seed) {
  const guid = String(safe(() => Configuration.getGame().campaignSetupGUID, "") || "");
  if (guid || seed) return (guid || "game") + "-" + (seed >>> 0).toString(36);
  return "game-" + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);
}

/**
 * Load this game's campaign, or start a new one when there is none or it belongs to another map.
 * @returns {CampaignDoc}
 */
export function openCampaign() {
  const seed = campaignSeed();
  // Parking an unusable stored campaign and restoring a parked one are writes to the shared game
  // configuration; in a networked game only the host may make them (the same rule saveCampaign follows).
  const stored = loadCampaign({
    mayWrite: () => mayStoreCampaign({ network: isNetworkMultiplayer(), host: isHost() })
  });
  if (stored && (!seed || !stored.seed || stored.seed === seed)) {
    return adoptViewpoint(stored, localId(), isNetworkMultiplayer());
  }
  return newCampaign({ id: campaignId(seed), seed, now: Date.now(), setup: readSetup(), local: localId() });
}

/**
 * Take one sample: read, diff, append, save.
 * @param {string} reason Why the sample was taken (for the debug log).
 */
export function sampleNow(reason) {
  if (state.errors >= MAX_ERRORS) return;
  try {
    const local = localId();
    if (local < 0) return;
    const doc = (live.doc = live.doc || openCampaign());
    const world = readWorld(local);
    if (!shouldSampleTurn(state, world.turn, world.age, reason)) return;
    const eventCount = recordWorld(doc, local, world);
    safe(() => captureMap(doc, doc.ages.length - 1, world.turn, reason !== "turn"), false);
    persist(doc);
    log.debug("sample", reason, "events", eventCount);
  } catch (e) {
    state.errors++;
    log.error("sample failed (" + reason + ")", e);
  }
}

/**
 * Fold one world reading into the campaign.
 * @param {CampaignDoc} doc Mutated.
 * @param {number} local
 * @param {HistoryWorldState} world
 * @returns {number} Number of new events.
 */
export function recordWorld(doc, local, world) {
  doc.local = local;
  const ageIdx = ensureAge(doc, world.age, world.turn);
  upsertAll(doc, world);
  const events = diffWorld(doc.last, world, { ageIdx, local, names: NAMER });
  if (!doc.last) {
    events.push({ t: world.turn, a: ageIdx, k: "age", p: -1, x: world.age, n: NAMER.age(world.age), d: world.date });
    markBaseline(doc, world);
  }
  events.push(...worldEvents(doc, world, ageIdx));
  appendEvents(doc, events);
  rememberTriumphWords(doc, events);
  noteTriumphs(doc, ageIdx, world);
  applyOutcome(doc, events, (pid) => Number(safe(() => Players.get(pid)?.team, -1)));
  noteVictoryClass(doc);
  appendSample(doc, world);
  doc.last = world;
  doc.updated = Date.now();
  return events.length;
}

/**
 * Events read from the world rather than diffed: a crisis stage onset, and Partisans risings when
 * that mod is loaded (history-risings.js).
 * @param {CampaignDoc} doc Mutated (detection state).
 * @param {HistoryWorldState} world
 * @param {number} ageIdx
 * @returns {HistoryEvent[]}
 */
function worldEvents(doc, world, ageIdx) {
  const crisis = crisisEvent(doc, world, ageIdx);
  const risings = safe(() => risingEvents(doc, world, ageIdx), []);
  return crisis ? [crisis, ...risings] : risings;
}

/**
 * Record every major's identity; a dead player gets no civilization span for the age.
 * @param {CampaignDoc} doc Mutated.
 * @param {HistoryWorldState} world
 */
function upsertAll(doc, world) {
  for (const player of everMajors()) {
    const alive = !!world.players[String(player.id)]?.alive;
    const identity = playerIdentity(player);
    upsertPlayer(doc, player.id, alive ? identity : { ...identity, civ: "" }, { age: world.age, turn: world.turn });
  }
}

/**
 * A crisis stage onset for this reading, if any. The first reading of a campaign only sets the
 * baseline, so a game joined mid-crisis does not announce a stage that began earlier.
 * @param {CampaignDoc} doc Mutated (detection state).
 * @param {HistoryWorldState} world
 * @param {number} ageIdx
 * @returns {HistoryEvent|null}
 */
function crisisEvent(doc, world, ageIdx) {
  const crisis = world.crisis;
  if (!crisis) return null;
  if (!doc.crisis) {
    doc.crisis = newCrisisState(world.age);
    doc.crisis.last = Math.max(0, crisis.stage);
    return null;
  }
  const stage = crisisStep(doc.crisis, world.age, crisis.stage);
  if (!stage) return null;
  const flavor = () => flavorCrisisName({ crisisEventType: crisis.type, age: world.age }, stage, getGameSeed());
  const name = String(safe(flavor, "") || "");
  return { t: world.turn, a: ageIdx, k: "crisis", p: -1, q: stage, x: crisis.type, n: name, d: world.date };
}

/** @param {{x:number, y:number}} loc Epicenter. */
function disasterOwner(loc) {
  const majors = new Set(everMajors().map((player) => player.id));
  const at = (/** @type {number} */ x, /** @type {number} */ y) => Number(safe(() => GameplayMap.getOwner(x, y), -1));
  const first = at(loc.x, loc.y);
  if (majors.has(first)) return first;
  for (const idx of safe(() => GameplayMap.getPlotIndicesInRadius(loc.x, loc.y, 1), []) || []) {
    const plot = safe(() => GameplayMap.getLocationFromIndex(idx), null);
    const owner = plot ? at(plot.x, plot.y) : -1;
    if (majors.has(owner)) return owner;
  }
  return -1;
}

/**
 * The chronicle event for a natural disaster, or null when it struck no major civilization's land.
 * @param {CampaignDoc} doc
 * @param {*} data RandomEventOccurred payload (eventType, location).
 * @returns {HistoryEvent|null}
 */
export function disasterEvent(doc, data) {
  const info = safe(() => GameInfo.RandomEvents.lookup(data.eventType), null);
  if (!info || !data.location || !doc.ages.length) return null;
  const owner = disasterOwner(data.location);
  if (owner < 0) return null;
  const turn = Number(safe(() => Game.turn, 0)) || 0;
  return {
    t: turn,
    a: doc.ages.length - 1,
    k: "disaster",
    p: owner,
    n: String(info.Name || ""),
    x: String(info.RandomEventType || ""),
    d: turnDate()
  };
}

/**
 * Record a natural disaster as it strikes. It is saved with the next sample.
 * @param {*} data RandomEventOccurred payload.
 */
function onDisaster(data) {
  const doc = live.doc;
  const event = doc && data ? disasterEvent(doc, data) : null;
  if (!doc || !event) return;
  appendEvents(doc, [event]);
  log.debug("disaster", event.x, "owner", event.p);
}

/**
 * Remember the victory class of a decided game (it names the victory's icon at the main menu).
 * @param {CampaignDoc} doc Mutated.
 */
function noteVictoryClass(doc) {
  if (doc.outcome.victory && !doc.outcome.cls) {
    doc.outcome.cls = String(infoRow("Victories", doc.outcome.victory)?.VictoryClassType || "");
  }
}

/**
 * First reading of a campaign: note where recording began and mark civilizations that were
 * already gone.
 * @param {CampaignDoc} doc Mutated.
 * @param {HistoryWorldState} world The first reading.
 */
function markBaseline(doc, world) {
  const cfg = safe(() => Configuration.getGame(), null);
  const startTurn = Number(safe(() => cfg.startTurn, 1)) || 1;
  const startAge = String(safe(() => infoRow("Ages", cfg.startAgeType)?.AgeType, "") || "");
  const partial = !(world.age === startAge && world.turn <= startTurn + 1);
  doc.since = { t: world.turn, d: world.date, partial };
  for (const [pid, reading] of Object.entries(world.players)) {
    const player = doc.players[pid];
    if (player && !reading.alive && !player.elim) player.elim = -1;
  }
}

/** @param {CampaignDoc} doc */
function persist(doc) {
  if (mayStoreCampaign({ network: isNetworkMultiplayer(), host: isHost() })) saveCampaign(doc);
  const rec = buildRecord(doc);
  if (!rec) return;
  rec.texts = { ...savedTextsFor(rec), ...(doc.texts || {}) };
  saveRecord(rec);
}

/**
 * The record's tags as they read in game now, so the main menu can show them.
 * @param {ArchiveRecord} rec
 * @returns {Record<string, string>} Tag -> text (tags that do not resolve are left out).
 */
export function savedTextsFor(rec) {
  /** @type {Record<string, string>} */
  const out = {};
  for (const tag of recordTags(rec)) {
    const text = t(tag);
    if (text && text !== tag && !text.startsWith("LOC_")) out[tag] = text;
  }
  return out;
}

/**
 * Remember what each new Triumph asked for and what it gave, in the game's words. This has to happen
 * as the Triumph is earned: the engine loads only the current age's Legacies, so an Antiquity
 * Triumph can no longer be looked up once the game reaches Exploration.
 * @param {CampaignDoc} doc Campaign (mutated).
 * @param {HistoryEvent[]} events Events just appended.
 */
export function rememberTriumphWords(doc, events) {
  for (const event of events) {
    if (event.k === "triumph" && event.x) rememberOneTriumph(doc, String(event.x), doc.ages[event.a]?.age || "");
  }
}

/**
 * @param {CampaignDoc} doc Campaign (mutated).
 * @param {string} type
 * @param {string} age Age the Triumph was earned in.
 */
function rememberOneTriumph(doc, type, age) {
  const texts = doc.texts || (doc.texts = {});
  if (texts[legacyWhyKey(type)] || texts[legacyWhatKey(type)]) return;
  const { why, what } = legacyBlurb(type, age);
  const readable = (/** @type {string} */ tag) => {
    const text = t(tag);
    return text && !text.startsWith("LOC_") ? plainText(text) : "";
  };
  const whyText = readable(why);
  const whatText = readable(what);
  if (whyText) texts[legacyWhyKey(type)] = whyText;
  if (whatText) texts[legacyWhatKey(type)] = whatText;
}

/**
 * @param {string} name
 * @param {Handler} fn
 */
function listen(name, fn) {
  safe(() => engine.on(name, fn), undefined);
  state.listeners.push([name, fn]);
}

/**
 * Start capturing. Idempotent.
 */
export function startCapture() {
  if (state.started) return;
  state.started = true;
  listen("PlayerTurnActivated", (/** @type {any} */ data) => {
    if (data && data.player === localId()) sampleNow("turn");
  });
  listen("TeamVictory", () => sampleNow("victory"));
  listen("PlayerDefeat", () => sampleNow("defeat"));
  listen("GameAgeEnded", () => sampleNow("age-ended"));
  listen("RandomEventOccurred", (/** @type {any} */ data) => safe(() => onDisaster(data), undefined));
  const kick = () => sampleNow("load");
  if (typeof Loading !== "undefined" && typeof Loading.runWhenLoaded === "function") {
    Loading.runWhenLoaded(kick);
  } else setTimeout(kick, 250);
}

/**
 * Stop capturing: unregister every listener startCapture registered (engine.off may be absent,
 * in which case they are only forgotten) and let startCapture run again. Bootstrap calls it
 * from its BeforeUnload hook.
 */
export function stopCapture() {
  const off = safe(() => (typeof engine.off === "function" ? engine.off.bind(engine) : null), null);
  for (const [name, fn] of state.listeners) {
    if (off) safe(() => off(name, fn), undefined);
  }
  state.listeners = [];
  state.started = false;
}

/**
 * Test hook: forget session state.
 */
export function _resetForTests() {
  live.doc = null;
  state.started = false;
  state.listeners = [];
  state.errors = 0;
}
