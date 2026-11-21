// =====================================================================
//  export.js  –  "Export video" for TANDA (no music)
//
//  Records the 3D canvas while the routine plays and downloads it as a video.
//  The recording only takes the PICTURE from the canvas, so no music or sound
//  ever ends up in the file, even if music is playing on the page.
//
//  Put this file in website/ and add to index.html (after your main script):
//      <button id="exportBtn">Export video</button>
//      <script src="export.js"></script>
//  Then hook it up at the bottom of this file (see "HOOK IT UP").
// =====================================================================

// Pick a video format the browser can record. MP4 first (easy to upload to TikTok / Instagram),
// WebM as a backup (older Chrome / Firefox).
function pickVideoType() {
  const types = [
    'video/mp4;codecs=avc1',
    'video/mp4',
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
    'video/webm',
  ];
  return types.find((t) => window.MediaRecorder && MediaRecorder.isTypeSupported(t)) || '';
}

/**
 * Record the canvas while the routine plays.
 *   canvas       – the <canvas> your 3D dancer is drawn on
 *   play         – function that starts the routine FROM THE BEGINNING.
 *                  Best if it returns a Promise that finishes when the routine ends.
 *   seconds      – (only needed if `play` doesn't return a Promise) how long to record
 *   fps          – frames per second of the video
 *   filename     – name of the downloaded file (without extension)
 */
async function exportVideo({ canvas, play, seconds, fps = 30, filename = 'tanda-routine' }) {
  const type = pickVideoType();
  if (!type) throw new Error('This browser can’t record video. Try Chrome, Edge or Safari.');

  const stream = canvas.captureStream(fps);          // video only – no audio track at all
  const recorder = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 8_000_000 });
  const chunks = [];
  recorder.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
  const stopped = new Promise((resolve) => { recorder.onstop = resolve; });

  recorder.start(250);                                // save a chunk every 0.25 s
  const result = play();                              // start the dance
  if (result && typeof result.then === 'function') {
    await result;                                     // wait for the routine to finish
  } else {
    await new Promise((r) => setTimeout(r, (seconds || 10) * 1000));
  }
  await new Promise((r) => setTimeout(r, 300));       // tiny tail so the last pose isn't cut off
  recorder.stop();
  await stopped;
  stream.getTracks().forEach((t) => t.stop());

  const ext = type.startsWith('video/mp4') ? 'mp4' : 'webm';
  const blob = new Blob(chunks, { type: type.split(';')[0] });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${filename}.${ext}`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return ext;
}

// How long a routine lasts: (duration / speed) x repeats, added up for every step.
// `dances` = your move list (with id + dur), `steps` = the routine (id, speed, repeats).
function routineSeconds(steps, dances) {
  return steps.reduce((total, s) => {
    const d = dances.find((x) => x.id === s.id);
    return total + ((d && d.dur) || 4) / (s.speed || 1) * (s.repeats || 1);
  }, 0);
}

// =====================================================================
//  HOOK IT UP  –  change the 3 names marked  <-- YOUR NAME  to match your code
// =====================================================================
document.getElementById('exportBtn')?.addEventListener('click', async (e) => {
  const btn = e.currentTarget;
  const canvas = document.querySelector('canvas');                  // <-- YOUR NAME (if you have more than one canvas)
  const steps = window.routine || [];                               // <-- YOUR NAME (the current routine steps)
  if (!steps.length) return alert('Build a routine first!');

  btn.disabled = true;
  const label = btn.textContent;
  btn.textContent = 'Recording… (plays in real time)';
  try {
    const ext = await exportVideo({
      canvas,
      play: () => window.playRoutine(steps),                        // <-- YOUR NAME (starts the routine from the top)
      seconds: routineSeconds(steps, window.dances || []),          // used if playRoutine doesn't return a Promise
      filename: 'tanda-routine',
    });
    btn.textContent = `Saved .${ext} ✓`;
  } catch (err) {
    alert(err.message || 'Export failed');
    btn.textContent = label;
  } finally {
    setTimeout(() => { btn.disabled = false; btn.textContent = label; }, 2000);
  }
});
