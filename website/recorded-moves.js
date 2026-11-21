// recorded-moves.js – brings moves recorded with camera tracking (studio.html) into the dance builder.
// Each saved move is turned into an AnimationClip for the character, so it
// plays, crossfades and repeats exactly like the Blender dances.

import { bakeMoveToClip } from "./retarget.js";
import { listMoves } from "./moves-db.js";

// Adds a clip to `clips` for every recorded move (ids start with "rec:"),
// removes clips for moves that were deleted, and returns the list of moves
// in the same shape as the DANCES list in app.js.
// `prepare` (optional) runs just before any new move is converted and returns
// a function that undoes it afterwards (app.js uses it to face the dancer forward).
export async function loadRecordedMoves(rig, clips, prepare) {
  let saved = [];
  try {
    saved = await listMoves();
  } catch (err) {
    console.warn("Could not read recorded moves", err);
  }

  const todo = saved.filter((m) => !clips["rec:" + m.id]);
  if (todo.length) {
    const restore = prepare ? prepare() : null;
    try {
      for (const m of todo) {
        try {
          clips["rec:" + m.id] = bakeMoveToClip(rig, m, "rec:" + m.id);
        } catch (err) {
          console.warn("Could not convert", m.name, err);
        }
      }
    } finally {
      if (restore) restore();
    }
  }

  const ids = new Set(saved.map((m) => "rec:" + m.id));
  for (const id of Object.keys(clips)) {
    if (id.startsWith("rec:") && !ids.has(id)) delete clips[id];
  }

  return saved.map((m) => ({
    id: "rec:" + m.id,
    name: m.name,
    desc: `Recorded with camera tracking, ${m.beats} beats`,
    bpm: m.bpm,
    recorded: true
  }));
}
