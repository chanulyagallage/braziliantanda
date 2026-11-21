// recorded-moves.js – brings moves recorded in the Dance Studio into the dance builder.
// Each saved move is turned into an AnimationClip for the character, so it
// plays, crossfades and repeats exactly like the Blender dances.

import { bakeMoveToClip } from "./retarget.js";
import { listMoves } from "./moves-db.js";

// Adds a clip to `clips` for every recorded move (ids start with "rec:"),
// removes clips for moves that were deleted, and returns the list of moves
// in the same shape as the DANCES list in app.js.
export async function loadRecordedMoves(rig, clips) {
  let saved = [];
  try {
    saved = await listMoves();
  } catch (err) {
    console.warn("Could not read recorded moves", err);
  }

  const ids = new Set();
  const list = saved.map((m) => {
    const id = "rec:" + m.id;
    ids.add(id);
    if (!clips[id]) {
      try {
        clips[id] = bakeMoveToClip(rig, m, id);
      } catch (err) {
        console.warn("Could not convert", m.name, err);
      }
    }
    return { id, name: m.name, emoji: "🎥", desc: `Recorded by you · ${m.beats} beats`, bpm: m.bpm, recorded: true };
  });

  for (const id of Object.keys(clips)) {
    if (id.startsWith("rec:") && !ids.has(id)) delete clips[id];
  }
  return list;
}
