// Dev-only typings for the mod's OWN data shapes. Ships to no one (release.sh excludes types/).
export {};

declare global {
  /** Event kinds recorded in a campaign chronicle. */
  type HnrEventKind =
    | "found"
    | "capture"
    | "razed"
    | "wonder"
    | "war"
    | "peace"
    | "religion"
    | "triumph"
    | "elim"
    | "age"
    | "civ"
    | "met"
    | "victory"
    | "crisis"
    | "disaster";

  /** One chronicle entry. Short keys keep the saved blob small. */
  interface HnrEvent {
    /** Game turn the change was observed on. */
    t: number;
    /** Index into CampaignDoc.ages. */
    a: number;
    k: HnrEventKind;
    /** Acting player (founder, new owner, winner, first party). -1 when none. */
    p: number;
    /** Other party (old owner, war target, met player). */
    q?: number;
    /** Display name: a LOC tag or literal text (city, wonder, religion, triumph). */
    n?: string;
    /** Engine type string (wonder, legacy, victory, age, civilization). */
    x?: string;
    /** Turn date label captured at the time ("2725 BCE"). */
    d?: string;
  }

  /** One civilization a player led in one age. */
  interface HnrCivSpan {
    age: string;
    civ: string;
    /** LOC tag of the civilization name. */
    name: string;
    from: number;
  }

  /** Everything the mod knows about one participant, frozen for the archive. */
  interface HnrPlayer {
    leader: string;
    /** LOC tag of the leader name. */
    leaderName: string;
    civs: HnrCivSpan[];
    human: boolean;
    /** Primary color as a CSS string. */
    color: string;
    /** Secondary banner color (used when the primary is a colorless dark). */
    color2?: string;
    /** Turn eliminated, 0 while alive, -1 when already gone before recording began. */
    elim: number;
  }

  /** One age's span inside the campaign. */
  interface HnrAge {
    age: string;
    start: number;
    end: number;
  }

  /** Per-player sampled standings. Arrays are aligned with HnrSeries.turns. */
  interface HnrPlayerSeries {
    set: number[];
    pop: number[];
    tri: number[];
    /** Scaled population (people); absent in documents recorded before it existed. */
    pops?: number[];
    /** Local player only, with the Emigration mod: cumulative people arrived from other civilizations. */
    mi?: number[];
    /** Local player only, with the Emigration mod: cumulative people who left for other civilizations. */
    mo?: number[];
  }

  interface HnrSeries {
    turns: number[];
    by: Record<string, HnrPlayerSeries>;
  }

  /** Per-player state kept between samples so the next sample can be diffed against it. */
  interface HnrPlayerState {
    alive: boolean;
    civ: string;
    met: boolean;
    /** Settlements keyed by "x,y" -> display name. */
    cities: Record<string, string>;
    wonders: string[];
    triumphs: string[];
    religion: string;
    /** Engine type of that religion (for its icon); absent in states recorded before it existed. */
    religionType?: string;
    wars: number[];
    population: number;
    /** Population in Demographics' real-world scale (people). */
    popScaled?: number;
    /** Emigration mod tallies (local player only): cumulative people in from and out to other civilizations. */
    mig?: { i: number; o: number };
  }

  interface HnrWorldState {
    turn: number;
    age: string;
    date: string;
    players: Record<string, HnrPlayerState>;
    /** Victories already claimed, as "team:VICTORY_TYPE". */
    victories: string[];
    /** The age crisis: its event type and current stage (above 0 = active stage, 1-based). */
    crisis?: { type: string; stage: number };
  }

  /** One territory-map frame: game turn, age index, run-length owners, [cell, owner] settlements. */
  interface HnrMapFrame {
    t: number;
    a: number;
    o: string;
    c: number[][];
  }

  /** The territory map of a campaign (model/history-map.js). */
  interface HnrMapGrid {
    w: number;
    h: number;
    /** Run-length terrain: 0 water, 1 land, 2 mountain. */
    terrain: string;
    frames: HnrMapFrame[];
  }

  /** Crisis onset detection state kept between readings (mirrors Demographics' Crises page). */
  interface HnrCrisisState {
    age: string;
    last: number;
    armed: boolean;
  }

  type HnrStatus = "in_progress" | "victory" | "defeat" | "ended";

  interface HnrOutcome {
    status: HnrStatus;
    /** Victory type the game was won with (by anyone), when known. */
    victory: string;
    /** LOC tag of that victory's name. */
    name: string;
    /** Victory class (VICTORY_CLASS_SCIENCE ...), which names its icon. */
    cls?: string;
    /** Winning player id, or -1. */
    winner: number;
    turn: number;
  }

  interface HnrSetup {
    speed: string;
    difficulty: string;
    mapSize: string;
    mapScript: string;
    startAge: string;
  }

  /** The per-save campaign document (GameConfiguration). */
  interface CampaignDoc {
    /** Words saved as they were read in game (Triumph requirements and effects). */
    texts?: Record<string, string>;
    v: number;
    id: string;
    seed: number;
    created: number;
    updated: number;
    setup: HnrSetup;
    local: number;
    players: Record<string, HnrPlayer>;
    ages: HnrAge[];
    events: HnrEvent[];
    series: HnrSeries;
    last: HnrWorldState | null;
    outcome: HnrOutcome;
    /** Triumphs held per age index, per player, as last read (earned before recording included). */
    tri?: Record<string, Record<string, number>>;
    /** Where recording began, when the mod joined an existing game. */
    since?: { t: number; d: string; partial: boolean };
    /** Crisis onset detection state. */
    crisis?: HnrCrisisState;
    /** Territory map frames. */
    map?: HnrMapGrid;
  }

  /**
   * A rival as frozen into an archive record:
   * [pid, leader, leaderName, civ, civName, color, elimTurn, triumphs, color2].
   */
  type HnrRival = [number, string, string, string, string, string, number, number, string?];

  /** The compact cross-game summary of one campaign. */
  interface ArchiveRecord {
    v: number;
    id: string;
    created: number;
    updated: number;
    /** Local player id in that game (event ids refer to it). */
    local: number;
    leader: string;
    leaderName: string;
    color: string;
    color2?: string;
    civs: HnrCivSpan[];
    setup: HnrSetup;
    turns: number;
    ages: string[];
    outcome: HnrOutcome;
    stats: {
      settlements: number;
      peakSettlements: number;
      population: number;
      /** Population in Demographics' real-world scale (people). */
      populationScaled?: number;
      wonders: number;
      triumphs: number;
      captured: number;
      wars: number;
      religion: string;
    };
    rivals: HnrRival[];
    highlights: HnrEvent[];
    spark: { tri: number[]; set: number[] };
    /** Text of this record's tags as shown in game, for tags the main menu cannot resolve. */
    texts?: Record<string, string>;
    /** The game's timeline, packed (see history-timeline.js packTimeline). */
    tl?: any;
    /** The game's territory map, packed (see history-map.js packMap). */
    map?: any;
  }

  /** The mod's slice inside the shared localStorage `modSettings` object. */
  interface ArchiveSlice {
    __schema: number;
    games: Record<string, ArchiveRecord>;
    hidden: Record<string, number>;
    /** Names as they read in game, kept once for the whole archive (tag -> text). */
    texts?: Record<string, string>;
  }
}
