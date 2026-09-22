// history-crisis.js
//
// Pure: turn per-turn crisis stage readings into stage-onset events, with the same rules as the
// Demographics Crises page (crisis-stage-data.js): a reading above 0 is an active, 1-based stage;
// only a new high is an onset; and across an age change detection waits until the new age reports
// a pre-crisis reading (0 or below), because the previous age's stage can linger into the next.

/**
 * A fresh detection state.
 * @param {string} age Age type.
 * @returns {HnrCrisisState} State (the first age starts armed: nothing can linger into it).
 */
export function newCrisisState(age) {
  return { age, last: 0, armed: true };
}

/**
 * Fold one reading into the state and return the onset it marks, if any.
 * @param {HnrCrisisState} st State (mutated).
 * @param {string} age Current age type.
 * @param {number|undefined} stage Current stage reading.
 * @returns {number} The new stage when this reading is an onset, else 0.
 */
export function crisisStep(st, age, stage) {
  if (st.age !== age) {
    st.age = age;
    st.last = 0;
    st.armed = false;
  }
  if (typeof stage !== "number" || !isFinite(stage)) return 0;
  if (stage <= 0) st.armed = true;
  const onset = st.armed && stage > 0 && stage > st.last ? stage : 0;
  if (stage >= 0) st.last = stage;
  return onset;
}
