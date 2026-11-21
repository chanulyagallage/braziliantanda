// music.js – the song picker, timeline and music playback for the dance builder.
// Songs are listed in Music/songs.json (shared with the Dance Studio).
//
// Uses these elements from index.html if they exist:
//   #musicTimelineWrap  – shown once a song is picked
//   #musicTimeline      – <canvas> waveform: click or drag to pick where the routine starts
//   #previewBtn         – plays the song from the start point
//   #musicInfo          – small text: start time and routine length

const audioCtx = new AudioContext();
let songs = [];
let currentSong = null;   // { meta, buffer, bpm, firstBeat, peaks, startBeat }
let music = null;         // { source, gain, t0, offset, preview }
const cache = {};

export const getCurrentSong = () => currentSong;

const $ = (id) => document.getElementById(id);
const spb = () => 60 / currentSong.bpm;
const beatTime = (b) => currentSong.firstBeat + b * spb();
const startTime = () => Math.max(0, beatTime(currentSong.startBeat));

// ==========================================================
// SONG PICKER
// ==========================================================
// onBeforeChange runs before anything new plays (app.js passes stopAll)
let stopOthers = () => { };

export async function setupSongPicker(select, chip, onBeforeChange = () => { }) {
  if (!select) return;
  stopOthers = onBeforeChange;
  setupTimeline();

  try {
    songs = await (await fetch("Music/songs.json")).json();
  } catch {
    console.warn("No Music/songs.json found");
    return;
  }
  select.innerHTML =
    '<option value="">No music</option>' +
    songs.map((s, i) => `<option value="${i}">${escapeHtml(s.title)} · ${escapeHtml(s.artist)}</option>`).join("");

  select.addEventListener("change", async () => {
    stopOthers();
    stopMusic();
    if (select.value === "") {
      currentSong = null;
      chip.textContent = "";
      showTimeline(false);
      return;
    }
    const meta = songs[Number(select.value)];
    chip.textContent = "Loading…";
    try {
      if (!cache[meta.id]) {
        const data = await (await fetch(meta.file)).arrayBuffer();
        const buffer = await audioCtx.decodeAudioData(data);
        let { bpm, firstBeat } = meta;
        if (!bpm || firstBeat === undefined) {
          chip.textContent = "Finding beat…";
          const found = await detectBeatsCached(meta, buffer);
          bpm = bpm || found.bpm;
          firstBeat = firstBeat ?? found.firstBeat;
        }
        cache[meta.id] = { meta, buffer, bpm, firstBeat, peaks: null, startBeat: 0 };
      }
      currentSong = cache[meta.id];
      chip.textContent = `${currentSong.bpm} BPM`;
      showTimeline(true);
    } catch (err) {
      console.warn("Could not load song", meta.file, err);
      chip.textContent = "Couldn't load song";
      currentSong = null;
      showTimeline(false);
    }
  });
}

// ==========================================================
// PLAYBACK
// ==========================================================
function play(offset, preview) {
  const source = audioCtx.createBufferSource();
  const gain = audioCtx.createGain();
  source.buffer = currentSong.buffer;
  source.connect(gain).connect(audioCtx.destination);
  const t0 = audioCtx.currentTime + 0.1;
  source.start(t0, offset);
  music = { source, gain, t0, offset, preview };
  source.onended = () => { if (music && music.source === source) { music = null; updatePreviewButton(); } };
  updatePreviewButton();
  return t0;
}

// Starts the song at the chosen start point (used by Play routine).
// Returns how many milliseconds until the dancing should begin.
export async function startMusic() {
  stopMusic();
  if (!currentSong) return 0;
  await audioCtx.resume();
  const t0 = play(startTime(), false);
  if (window.tanda) window.tanda.audio = { context: audioCtx, node: music.gain }; // for export.js
  return (t0 - audioCtx.currentTime) * 1000;
}

export function stopMusic(fadeSeconds = 0) {
  if (!music) return;
  const { source, gain } = music;
  music = null;
  const now = audioCtx.currentTime;
  gain.gain.setValueAtTime(gain.gain.value, now);
  gain.gain.linearRampToValueAtTime(0, now + fadeSeconds + 0.05);
  try { source.stop(now + fadeSeconds + 0.1); } catch { }
  updatePreviewButton();
}

// Where in the song we are right now (or null if nothing is playing)
function songPosition() {
  if (!music) return null;
  return music.offset + Math.max(0, audioCtx.currentTime - music.t0);
}

// How much to speed a dance up or down to match the song.
// danceBpm = the tempo the dance was made at (unknown → 1, no change).
// If it's more than ~1.5x off, it dances in half or double time instead.
export function tempoFactor(danceBpm) {
  if (!currentSong || !danceBpm) return 1;
  let factor = currentSong.bpm / danceBpm;
  while (factor > 1.5) factor /= 2;
  while (factor < 0.75) factor *= 2;
  return factor;
}

// ==========================================================
// TIMELINE (waveform you can scrub, preview, pick a start point)
// ==========================================================
let canvas = null;
let ctx = null;

function setupTimeline() {
  canvas = $("musicTimeline");
  if (!canvas) return;
  ctx = canvas.getContext("2d");

  // Click or drag to move the start point (snaps to the beat).
  // If the preview is playing, it jumps to where you let go.
  let dragging = false;
  const pick = (e) => {
    const rect = canvas.getBoundingClientRect();
    const t = ((e.clientX - rect.left) / rect.width) * currentSong.buffer.duration;
    const last = Math.floor((currentSong.buffer.duration - currentSong.firstBeat) / spb()) - 1;
    currentSong.startBeat = Math.max(0, Math.min(last, Math.round((t - currentSong.firstBeat) / spb())));
  };
  canvas.addEventListener("pointerdown", (e) => {
    if (!currentSong) return;
    dragging = true;
    canvas.setPointerCapture(e.pointerId);
    pick(e);
  });
  canvas.addEventListener("pointermove", (e) => dragging && pick(e));
  canvas.addEventListener("pointerup", () => {
    if (!dragging) return;
    dragging = false;
    if (music) {                     // scrub: keep listening from the new spot
      const wasPreview = music.preview;
      stopOthers();
      stopMusic();
      if (wasPreview) play(startTime(), true);
    }
  });

  const btn = $("previewBtn");
  if (btn) {
    btn.addEventListener("click", async () => {
      if (!currentSong) return;
      if (music && music.preview) return stopMusic();
      stopOthers();
      stopMusic();
      await audioCtx.resume();
      play(startTime(), true);
    });
  }

  window.addEventListener("resize", () => currentSong && buildPeaks());
  requestAnimationFrame(drawLoop);
}

function showTimeline(on) {
  const wrap = $("musicTimelineWrap");
  if (wrap) wrap.hidden = !on;
  if (on && canvas) requestAnimationFrame(buildPeaks);
}

function updatePreviewButton() {
  const btn = $("previewBtn");
  if (btn) btn.textContent = music && music.preview ? "■ Stop" : "▶ Preview";
}

function buildPeaks() {
  if (!canvas || !currentSong) return;
  const w = Math.max(1, Math.round(canvas.clientWidth * devicePixelRatio));
  canvas.width = w;
  canvas.height = Math.round(canvas.clientHeight * devicePixelRatio);
  const data = currentSong.buffer.getChannelData(0);
  const per = Math.max(1, Math.floor(data.length / w));
  const peaks = new Float32Array(w);
  for (let x = 0; x < w; x++) {
    let max = 0;
    for (let i = x * per; i < (x + 1) * per; i += 16) max = Math.max(max, Math.abs(data[i] || 0));
    peaks[x] = max;
  }
  currentSong.peaks = peaks;
}

function drawLoop() {
  requestAnimationFrame(drawLoop);
  if (!canvas || !currentSong || !currentSong.peaks || canvas.width !== currentSong.peaks.length) return;

  const w = canvas.width;
  const h = canvas.height;
  const dpr = devicePixelRatio;
  const duration = currentSong.buffer.duration;
  const toX = (t) => (t / duration) * w;

  // How much of the song the routine will use
  let routineSeconds = 0;
  try { routineSeconds = window.tanda ? window.tanda.seconds() : 0; } catch { }
  const start = startTime();
  const end = Math.min(duration, start + routineSeconds);
  const x0 = toX(start);
  const x1 = toX(end);

  ctx.clearRect(0, 0, w, h);

  if (routineSeconds > 0) {
    ctx.fillStyle = "rgba(255, 79, 163, 0.22)";
    ctx.fillRect(x0, 0, x1 - x0, h);
  }

  // Bar lines every 4 beats
  ctx.fillStyle = "rgba(255,255,255,0.06)";
  for (let b = 0; beatTime(b) < duration; b += 4) ctx.fillRect(toX(beatTime(b)), 0, 1, h);

  // Waveform
  const mid = h / 2;
  for (let x = 0; x < w; x++) {
    ctx.fillStyle = routineSeconds > 0 && x >= x0 && x < x1 ? "#ff7ab8" : "#5a4f73";
    const bar = Math.max(1, currentSong.peaks[x] * h * 0.42);
    ctx.fillRect(x, mid - bar, 1, bar * 2);
  }

  // Start marker
  ctx.fillStyle = "#ff4fa3";
  ctx.fillRect(x0 - dpr, 0, 2 * dpr, h);

  // Playhead
  const pos = songPosition();
  if (pos !== null) {
    ctx.fillStyle = "#fff";
    ctx.fillRect(toX(pos), 0, 2 * dpr, h);
  }

  const info = $("musicInfo");
  if (info) {
    const text = routineSeconds > 0
      ? `Starts at ${fmt(start)} · routine ends at ${fmt(end)}`
      : `Starts at ${fmt(start)} · add moves to see how much of the song you'll use`;
    if (info.textContent !== text) info.textContent = text;
  }
}

function fmt(t) {
  return `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;
}

// ==========================================================
// HELPERS
// ==========================================================
// Same tempo finder as the studio: runs in the background, remembered per song
async function detectBeatsCached(meta, buffer) {
  const key = `beats:${meta.id}:${meta.file}`;
  try {
    const saved = JSON.parse(localStorage.getItem(key));
    if (saved) return saved;
  } catch { }
  const mono = new Float32Array(buffer.length);
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const d = buffer.getChannelData(c);
    for (let i = 0; i < d.length; i++) mono[i] += d[i] / buffer.numberOfChannels;
  }
  const result = await new Promise((resolve, reject) => {
    const worker = new Worker("beat-worker.js", { type: "module" });
    worker.onmessage = (e) => { resolve(e.data); worker.terminate(); };
    worker.onerror = (e) => { reject(e); worker.terminate(); };
    worker.postMessage({ samples: mono, sampleRate: buffer.sampleRate }, [mono.buffer]);
  });
  try { localStorage.setItem(key, JSON.stringify(result)); } catch { }
  return result;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
