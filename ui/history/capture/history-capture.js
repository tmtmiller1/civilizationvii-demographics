// history-capture.js
//
// Game-scope capture loop. Once per local turn (and immediately on a victory, a defeat or the end of
// an age) it reads the world, diffs it against the last state, appends the resulting chronicle
// events and a trend sample to the CampaignDoc, saves it into the save file and refreshes the Hall
// of Fame record. State diffing means changes made during other players' turns are still recorded.

import { dlog, derr, safe } from "/demographics/ui/history/core/history-log.js";
import { readWorld, playerIdentity, everMajors, infoRow, turnDate, legacyBlurb } from "/demographics/ui/history/capture/history-world.js";
import { diffWorld } from "/demographics/ui/history/capture/history-diff.js";
import {
  newCampaign, ensureAge, upsertPlayer, appendEvents, appendSample, applyOutcome, noteTriumphs
} from "/demographics/ui/history/store/history-campaign.js";
import { loadCampaign, saveCampaign } from "/demographics/ui/history/store/history-campaign-store.js";
import { buildRecord, recordTags } from "/demographics/ui/history/store/history-archive.js";
import { t, legacyWhyKey, legacyWhatKey, plainText } from "/demographics/ui/history/core/history-text.js";
import { saveRecord } from "/demographics/ui/history/store/history-archive-store.js";
import { live } from "/demographics/ui/history/capture/history-live.js";
import { newCrisisState, crisisStep } from "/demographics/ui/history/capture/history-crisis.js";
import { captureMap } from "/demographics/ui/history/capture/history-mapgrid.js";
import { flavorCrisisName, getGameSeed } from "/demographics/ui/screen-demographics/charts/crises/crisis-names.js";

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
  teamPlayer: (team) => everMajors().find((p) => safe(() => p.team, -2) === team)?.id ?? -1
};

/**
 * The local player id.
 * @returns {number} Id, or -1.
 */
function localId() {
  return Number(safe(() => GameContext.localPlayerID, -1));
}

/**
 * Whether this is a networked multiplayer game (internet, LAN, wireless, cloud). Hotseat is
 * multiplayer too but every seat is this machine, so it is not "networked" here.
 * @returns {boolean} True in a networked game.
 */
export function isNetworkMultiplayer() {
  return !!safe(() => Configuration.getGame().isNetworkMultiplayer, false);
}

/**
 * Whether the local player hosts the game. Single-player and hotseat count as hosting.
 * @returns {boolean} True when this client is the host.
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
 * @param {{network: boolean, host: boolean}} mp Multiplayer facts.
 * @returns {boolean} True when the campaign may be written.
 */
export function mayStoreCampaign(mp) {
  return !mp.network || mp.host;
}

/**
 * Whether a "turn" sample should be taken: once per game turn, whichever seat's turn starts it
 * (hotseat raises PlayerTurnActivated for every human seat in the same turn). Other reasons
 * (load, victory, defeat, age end) always sample.
 * @param {{lastTurn: number, lastAge: string}} st Capture state (mutated when the sample is taken).
 * @param {number} turn Current turn.
 * @param {string} age Current age type.
 * @param {string} reason Why the sample was requested.
 * @returns {boolean} True when the sample should be taken.
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
 * @param {CampaignDoc} doc The document (mutated).
 * @param {number} local This client's player id.
 * @param {boolean} network Whether this is a networked game.
 * @returns {CampaignDoc} The same document.
 */
export function adoptViewpoint(doc, local, network) {
  if (network && local >= 0 && doc.local !== local) doc.local = local;
  return doc;
}

/**
 * Setup facts for the archive, as LOC name tags.
 * @returns {HnrSetup} Setup.
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
 * @returns {number} Seed, or 0.
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
 * @returns {string} Id.
 */
export function campaignId(seed) {
  const guid = String(safe(() => Configuration.getGame().campaignSetupGUID, "") || "");
  if (guid || seed) return (guid || "game") + "-" + (seed >>> 0).toString(36);
  return "game-" + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);
}

/**
 * Load this game's campaign, or start a new one when there is none or it belongs to another map.
 * @returns {CampaignDoc} The document.
 */
export function openCampaign() {
  const seed = campaignSeed();
  // Parking an unusable stored campaign and restoring a parked one are writes to the shared game
  // configuration; in a networked game only the host may make them (the 2.7.2 rule saveCampaign follows).
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
    const n = recordWorld(doc, local, world);
    safe(() => captureMap(doc, doc.ages.length - 1, world.turn, reason !== "turn"), false);
    persist(doc);
    dlog("sample", reason, "events", n);
  } catch (e) {
    state.errors++;
    derr("sample failed (" + reason + ")", e);
  }
}

/**
 * Fold one world reading into the campaign.
 * @param {CampaignDoc} doc The campaign (mutated).
 * @param {number} local Local player id.
 * @param {HnrWorldState} world The reading.
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
  const crisis = crisisEvent(doc, world, ageIdx);
  if (crisis) events.push(crisis);
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
 * Record every major's identity; a dead player gets no civilization span for the age.
 * @param {CampaignDoc} doc The campaign (mutated).
 * @param {HnrWorldState} world The reading.
 */
function upsertAll(doc, world) {
  for (const p of everMajors()) {
    const alive = !!world.players[String(p.id)]?.alive;
    const id = playerIdentity(p);
    upsertPlayer(doc, p.id, alive ? id : { ...id, civ: "" }, { age: world.age, turn: world.turn });
  }
}

/**
 * A crisis stage onset for this reading, if any. The first reading of a campaign only sets the
 * baseline, so a game joined mid-crisis does not announce a stage that began earlier.
 * @param {CampaignDoc} doc The campaign (mutated: detection state).
 * @param {HnrWorldState} world The reading.
 * @param {number} ageIdx Age index.
 * @returns {HnrEvent|null} The event.
 */
function crisisEvent(doc, world, ageIdx) {
  const c = world.crisis;
  if (!c) return null;
  if (!doc.crisis) {
    doc.crisis = newCrisisState(world.age);
    doc.crisis.last = Math.max(0, c.stage);
    return null;
  }
  const stage = crisisStep(doc.crisis, world.age, c.stage);
  if (!stage) return null;
  const name = String(safe(() => flavorCrisisName({ crisisEventType: c.type, age: world.age }, stage, getGameSeed()), "") || "");
  return { t: world.turn, a: ageIdx, k: "crisis", p: -1, q: stage, x: c.type, n: name, d: world.date };
}

/**
 * The major player whose land a disaster struck: the owner of its epicenter, else of the nearest
 * owned plot around it.
 * @param {{x:number, y:number}} loc Epicenter.
 * @returns {number} Player id, or -1 for unclaimed land.
 */
function disasterOwner(loc) {
  const majors = new Set(everMajors().map((p) => p.id));
  const at = (/** @type {number} */ x, /** @type {number} */ y) => Number(safe(() => GameplayMap.getOwner(x, y), -1));
  const first = at(loc.x, loc.y);
  if (majors.has(first)) return first;
  for (const idx of safe(() => GameplayMap.getPlotIndicesInRadius(loc.x, loc.y, 1), []) || []) {
    const p = safe(() => GameplayMap.getLocationFromIndex(idx), null);
    const owner = p ? at(p.x, p.y) : -1;
    if (majors.has(owner)) return owner;
  }
  return -1;
}

/**
 * The chronicle event for a natural disaster, or null when it struck no major civilization's land.
 * @param {CampaignDoc} doc The campaign.
 * @param {*} data RandomEventOccurred payload (eventType, location).
 * @returns {HnrEvent|null} The event.
 */
export function disasterEvent(doc, data) {
  const info = safe(() => GameInfo.RandomEvents.lookup(data.eventType), null);
  if (!info || !data.location || !doc.ages.length) return null;
  const owner = disasterOwner(data.location);
  if (owner < 0) return null;
  const turn = Number(safe(() => Game.turn, 0)) || 0;
  return { t: turn, a: doc.ages.length - 1, k: "disaster", p: owner, n: String(info.Name || ""), x: String(info.RandomEventType || ""), d: turnDate() };
}

/**
 * Record a natural disaster as it strikes. It is saved with the next sample.
 * @param {*} data RandomEventOccurred payload.
 */
function onDisaster(data) {
  const doc = live.doc;
  const e = doc && data ? disasterEvent(doc, data) : null;
  if (!doc || !e) return;
  appendEvents(doc, [e]);
  dlog("disaster", e.x, "owner", e.p);
}

/**
 * Remember the victory class of a decided game (it names the victory's icon at the main menu).
 * @param {CampaignDoc} doc The campaign (mutated).
 */
function noteVictoryClass(doc) {
  if (doc.outcome.victory && !doc.outcome.cls) {
    doc.outcome.cls = String(infoRow("Victories", doc.outcome.victory)?.VictoryClassType || "");
  }
}

/**
 * First reading of a campaign: note where recording began and mark civilizations that were
 * already gone.
 * @param {CampaignDoc} doc The campaign (mutated).
 * @param {HnrWorldState} world The first reading.
 */
function markBaseline(doc, world) {
  const cfg = safe(() => Configuration.getGame(), null);
  const startTurn = Number(safe(() => cfg.startTurn, 1)) || 1;
  const startAge = String(safe(() => infoRow("Ages", cfg.startAgeType)?.AgeType, "") || "");
  const partial = !(world.age === startAge && world.turn <= startTurn + 1);
  doc.since = { t: world.turn, d: world.date, partial };
  for (const [pid, st] of Object.entries(world.players)) {
    const p = doc.players[pid];
    if (p && !st.alive && !p.elim) p.elim = -1;
  }
}

/**
 * Save the campaign and refresh its archive record.
 * @param {CampaignDoc} doc The document.
 */
function persist(doc) {
  if (mayStoreCampaign({ network: isNetworkMultiplayer(), host: isHost() })) saveCampaign(doc);
  const rec = buildRecord(doc);
  if (!rec) return;
  rec.texts = { ...savedTextsFor(rec), ...(doc.texts || {}) };
  saveRecord(rec);
}

/**
 * The record's tags as they read in game now, so the main menu can show them.
 * @param {ArchiveRecord} rec The record.
 * @returns {Record<string, string>} Tag -> text (tags that do not resolve are left out).
 */
export function savedTextsFor(rec) {
  /** @type {Record<string, string>} */
  const out = {};
  for (const tag of recordTags(rec)) {
    const s = t(tag);
    if (s && s !== tag && !s.startsWith("LOC_")) out[tag] = s;
  }
  return out;
}

/**
 * Remember what each new Triumph asked for and what it gave, in the game's words. This has to happen
 * as the Triumph is earned: the engine loads only the current age's Legacies, so an Antiquity
 * Triumph can no longer be looked up once the game reaches Exploration.
 * @param {CampaignDoc} doc Campaign (mutated).
 * @param {HnrEvent[]} events Events just appended.
 */
export function rememberTriumphWords(doc, events) {
  for (const e of events) {
    if (e.k === "triumph" && e.x) rememberOneTriumph(doc, String(e.x), doc.ages[e.a]?.age || "");
  }
}

/**
 * Store one Triumph's words, if they are not stored already and the game can still read them.
 * @param {CampaignDoc} doc Campaign (mutated).
 * @param {string} type LegacyType.
 * @param {string} age Age the Triumph was earned in.
 */
function rememberOneTriumph(doc, type, age) {
  const texts = doc.texts || (doc.texts = {});
  if (texts[legacyWhyKey(type)] || texts[legacyWhatKey(type)]) return;
  const { why, what } = legacyBlurb(type, age);
  const readable = (/** @type {string} */ tag) => {
    const s = t(tag);
    return s && !s.startsWith("LOC_") ? plainText(s) : "";
  };
  const w1 = readable(why);
  const w2 = readable(what);
  if (w1) texts[legacyWhyKey(type)] = w1;
  if (w2) texts[legacyWhatKey(type)] = w2;
}

/**
 * Register an engine listener and remember it for teardown.
 * @param {string} name Event name.
 * @param {Handler} fn Handler.
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
  if (typeof Loading !== "undefined" && typeof Loading.runWhenLoaded === "function") Loading.runWhenLoaded(kick);
  else setTimeout(kick, 250);
}

/**
 * Stop capturing: unregister every listener startCapture registered (engine.off may be absent,
 * in which case they are only forgotten) and let startCapture run again. Nothing in the mod
 * calls this yet; bootstrap has no unload hook, so it is exported for one to use.
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
