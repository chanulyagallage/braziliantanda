// music.js – the song picker, timeline and music playback for the dance builder.
// Songs are listed in Music/songs.json (shared with the Dance Studio).
//
// Uses these elements from index.html if they exist:
//   #musicTimelineWrap  – shown once a song is picked
//   #musicTimeline      – <canvas> waveform: click or drag to pick where the routine starts
//   #previewBtn         – plays the chosen part of the song
//   #lengthControl      – buttons with data-length="fit" / "15" / "30" / "60"
//   #musicInfo          – small text: the chosen time period

const audioCtx = new AudioContext();
let songs = [];
let currentSong = null;   // { meta, buffer, bpm, firstBeat, peaks, startBeat, lengthBeats }
let music = null;         // { source, gain, t0, offset, end, preview }
const cache = {};

export const getCurrentSong = () => currentSong;

const $ = (id) => document.getElementById(id);
const spb = () => 60 / currentSong.bpm;
const beatTime = (b) => currentSong.firstBeat + b * spb();
const startTime = () => Math.max(0, beatTime(currentSong.startBeat));

// The chosen time period. lengthBeats = null means "fit the routine".
function routineSeconds() {
  try { return window.tanda ? window.tanda.seconds() : 0; } catch { return 0; }
}
function endTime() {
  const s = currentSong;
  const seconds = s.lengthBeats === null ? routineSeconds() : s.lengthBeats * spb();
  return Math.min(s.buffer.duration, startTime() + seconds);
}

// ==========================================================
// SONG PICKER
// ==========================================================
// onBeforeChange runs before anything new plays (app.js passes stopAll)
let stopOthers = () => {};

export async function setupSongPicker(select, chip, onBeforeChange = () => {}) {
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
        cache[meta.id] = { meta, buffer, bpm, firstBeat, peaks: null, startBeat: 0, lengthBeats: null };
      }
      currentSong = cache[meta.id];
      chip.textContent = `${currentSong.bpm} BPM`;
      showTimeline(true);
      updateLengthButtons();
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
// Plays from `offset` to `end` (song seconds), fading out over the last second
function play(offset, end, preview) {
  const source = audioCtx.createBufferSource();
  const gain = audioCtx.createGain();
  source.buffer = currentSong.buffer;
  source.connect(gain).connect(audioCtx.destination);
  const t0 = audioCtx.currentTime + 0.1;
  source.start(t0, offset);
  if (end > offset) {
    const stopAt = t0 + (end - offset);
    gain.gain.setValueAtTime(1, Math.max(t0, stopAt - 1));
    gain.gain.linearRampToValueAtTime(0, stopAt);
    source.stop(stopAt + 0.05);
  }
  music = { source, gain, t0, offset, end, preview };
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
  const t0 = play(startTime(), endTime(), false);
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
  try { source.stop(now + fadeSeconds + 0.1); } catch {}
  updatePreviewButton();
}

// Where in the song we are right now (or null if nothing is playing)
function songPosition() {
  if (!music) return null;
  return music.offset + Math.max(0, audioCtx.currentTime - music.t0);
}

// For app.js: has the chosen time period run out?
export function musicTimeUp() {
  if (!music || music.preview) return false;
  return music.offset + (audioCtx.currentTime - music.t0) >= music.end - 0.05;
}

// For app.js: should the routine go round again to fill the chosen period?
// (Only when a fixed length is picked and there's time left.)
export function keepDancing() {
  if (!music || music.preview || !currentSong || currentSong.lengthBeats === null) return false;
  return music.end - (music.offset + (audioCtx.currentTime - music.t0)) > 0.5;
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

  // Click or drag to move the chosen part (snaps to the beat).
  // Drag its right edge to change how long the music plays.
  // If the preview is playing, it jumps to where you let go.
  let dragging = null; // "move" | "end"
  const timeAt = (e) => {
    const rect = canvas.getBoundingClientRect();
    return ((e.clientX - rect.left) / rect.width) * currentSong.buffer.duration;
  };
  const nearEndEdge = (e) => {
    const rect = canvas.getBoundingClientRect();
    const xEnd = rect.left + (endTime() / currentSong.buffer.duration) * rect.width;
    return endTime() > startTime() && Math.abs(e.clientX - xEnd) < 10;
  };
  const lastBeat = () => Math.floor((currentSong.buffer.duration - currentSong.firstBeat) / spb()) - 1;
  const pick = (e) => {
    const beat = Math.round((timeAt(e) - currentSong.firstBeat) / spb());
    if (dragging === "end") {
      currentSong.lengthBeats = Math.max(1, Math.min(lastBeat() - currentSong.startBeat, beat - currentSong.startBeat));
      updateLengthButtons();
    } else {
      currentSong.startBeat = Math.max(0, Math.min(lastBeat(), beat));
    }
  };
  canvas.addEventListener("pointerdown", (e) => {
    if (!currentSong) return;
    dragging = nearEndEdge(e) ? "end" : "move";
    canvas.setPointerCapture(e.pointerId);
    pick(e);
  });
  canvas.addEventListener("pointermove", (e) => {
    if (!currentSong) return;
    if (dragging) pick(e);
    else canvas.style.cursor = nearEndEdge(e) ? "ew-resize" : "pointer";
  });
  canvas.addEventListener("pointerup", () => {
    if (!dragging) return;
    dragging = null;
    if (music) {                     // scrub: keep listening from the new spot
      const wasPreview = music.preview;
      stopOthers();
      stopMusic();
      if (wasPreview) playPreview();
    }
  });

  // Length buttons: Fit routine / 15s / 30s / 60s
  const lengths = $("lengthControl");
  if (lengths) {
    lengths.addEventListener("click", (e) => {
      const btn = e.target.closest("button");
      if (!btn || !currentSong) return;
      const value = btn.dataset.length;
      currentSong.lengthBeats = value === "fit" ? null : Math.max(1, Math.round(Number(value) / spb()));
      updateLengthButtons();
    });
  }

  const btn = $("previewBtn");
  if (btn) {
    btn.addEventListener("click", async () => {
      if (!currentSong) return;
      if (music && music.preview) return stopMusic();
      stopOthers();
      stopMusic();
      await audioCtx.resume();
      playPreview();
    });
  }

  window.addEventListener("resize", () => currentSong && buildPeaks());
  requestAnimationFrame(drawLoop);
}

// Preview plays the chosen part, or to the end of the song if nothing's chosen yet
function playPreview() {
  const end = endTime() > startTime() ? endTime() : currentSong.buffer.duration;
  play(startTime(), end, true);
}

function updateLengthButtons() {
  const lengths = $("lengthControl");
  if (!lengths || !currentSong) return;
  const L = currentSong.lengthBeats;
  for (const b of lengths.children) {
    const v = b.dataset.length;
    const active = v === "fit" ? L === null : L !== null && Math.round(Number(v) / spb()) === L;
    b.classList.toggle("active", active);
  }
}

function showTimeline(on) {
  const wrap = $("musicTimelineWrap");
  if (wrap) wrap.hidden = !on;
  if (on && canvas) requestAnimationFrame(buildPeaks);
}

function updatePreviewButton() {
  const btn = $("previewBtn");
  if (btn) btn.textContent = music && music.preview ? "Stop preview" : "Preview";
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

  // The chosen part of the song
  const start = startTime();
  const end = endTime();
  const hasRange = end > start;
  const x0 = toX(start);
  const x1 = toX(end);

  // Colours follow the page's accent, which changes with the background
  const css = getComputedStyle(document.documentElement);
  const accent = css.getPropertyValue("--accent").trim() || "#ff7ab8";
  const accentSoft = css.getPropertyValue("--accent-soft").trim() || "rgba(255, 122, 184, 0.24)";

  ctx.clearRect(0, 0, w, h);

  if (hasRange) {
    ctx.fillStyle = accentSoft;
    ctx.fillRect(x0, 0, x1 - x0, h);
  }

  // Bar lines every 4 beats
  ctx.fillStyle = "rgba(255,255,255,0.06)";
  for (let b = 0; beatTime(b) < duration; b += 4) ctx.fillRect(toX(beatTime(b)), 0, 1, h);

  // Waveform
  const mid = h / 2;
  for (let x = 0; x < w; x++) {
    ctx.fillStyle = hasRange && x >= x0 && x < x1 ? accent : "rgba(255, 255, 255, 0.28)";
    const bar = Math.max(1, currentSong.peaks[x] * h * 0.42);
    ctx.fillRect(x, mid - bar, 1, bar * 2);
  }

  // Start marker, and a grab handle on the end edge
  ctx.fillStyle = accent;
  ctx.fillRect(x0 - dpr, 0, 2 * dpr, h);
  if (hasRange) {
    ctx.fillRect(x1 - dpr, 0, 2 * dpr, h);
    ctx.fillRect(x1 - 3 * dpr, h / 2 - 10 * dpr, 6 * dpr, 20 * dpr);
  }

  // Playhead
  const pos = songPosition();
  if (pos !== null) {
    ctx.fillStyle = "#fff";
    ctx.fillRect(toX(pos), 0, 2 * dpr, h);
  }

  const info = $("musicInfo");
  if (info) {
    const fit = currentSong.lengthBeats === null;
    const text = !hasRange
      ? `Starts at ${fmt(start)} · add moves or pick a length`
      : `${fmt(start)} → ${fmt(end)} · ${Math.round(end - start)}s` +
        (fit ? " (fits your routine)" : routineSeconds() > 0 && routineSeconds() < end - start - 0.5 ? " (routine repeats to fill it)" : "");
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
  } catch {}
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
  try { localStorage.setItem(key, JSON.stringify(result)); } catch {}
  return result;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
