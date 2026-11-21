// music.js – the song picker and music playback for the dance builder.
// Songs are listed in Music/songs.json (shared with the Dance Studio).

const audioCtx = new AudioContext();
let songs = [];
let currentSong = null;   // { meta, buffer, bpm, firstBeat }
let music = null;         // the song that's playing right now
const cache = {};

export const getCurrentSong = () => currentSong;

// Fills the <select> with songs. onBeforeChange runs before a new song is
// picked (app.js passes stopAll so the old routine stops).
export async function setupSongPicker(select, chip, onBeforeChange = () => {}) {
  if (!select) return;
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
    onBeforeChange();
    if (select.value === "") {
      currentSong = null;
      chip.textContent = "";
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
        cache[meta.id] = { meta, buffer, bpm, firstBeat };
      }
      currentSong = cache[meta.id];
      chip.textContent = `${currentSong.bpm} BPM`;
    } catch (err) {
      console.warn("Could not load song", meta.file, err);
      chip.textContent = "Couldn't load song";
      currentSong = null;
    }
  });
}

// Starts the song. Returns how many milliseconds until its first beat.
export async function startMusic() {
  stopMusic();
  if (!currentSong) return 0;
  await audioCtx.resume();
  const source = audioCtx.createBufferSource();
  const gain = audioCtx.createGain();
  source.buffer = currentSong.buffer;
  source.connect(gain).connect(audioCtx.destination);
  const t0 = audioCtx.currentTime + 0.1;
  source.start(t0);
  music = { source, gain };
  if (window.tanda) window.tanda.audio = { context: audioCtx, node: gain }; // for export.js
  return (t0 + currentSong.firstBeat - audioCtx.currentTime) * 1000;
}

export function stopMusic(fadeSeconds = 0) {
  if (!music) return;
  const { source, gain } = music;
  music = null;
  const now = audioCtx.currentTime;
  gain.gain.setValueAtTime(gain.gain.value, now);
  gain.gain.linearRampToValueAtTime(0, now + fadeSeconds + 0.05);
  try { source.stop(now + fadeSeconds + 0.1); } catch {}
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
