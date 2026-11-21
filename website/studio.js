// studio.js – Dance Studio
// Record a dance with your webcam and it becomes a dance on the 3D character.

import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
// The body tracker is big (~20 MB), so it's loaded in the background later
// instead of here. A fixed version number lets the browser cache it.
const MEDIAPIPE = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.2.3";
import { createRetargeter, samplePoints, mirrorPoints, smoothMove } from "./retarget.js";
import { saveMove, listMoves, deleteMove } from "./moves-db.js";

const COUNT_IN_BEATS = 4;

if (new URLSearchParams(location.search).has("admin")) document.body.classList.add("is-admin");

// ---------- Page elements ----------
const $ = (id) => document.getElementById(id);
const songSelect = $("songSelect");
const playSongButton = $("playSongButton");
const bpmChip = $("bpmChip");
const halfTempo = $("halfTempo");
const doubleTempo = $("doubleTempo");
const timeline = $("timeline");
const timelineCtx = timeline.getContext("2d");
const beatsControl = $("beatsControl");
const clicksToggle = $("clicksToggle");
const practiseButton = $("practiseButton");
const skinPicker = $("skinPicker");
const video = $("webcam");
const overlay = $("overlay");
const overlayCtx = overlay.getContext("2d");
const charStage = $("charStage");
const charLabel = $("charLabel");
const bigText = $("bigText");
const recBadge = $("recBadge");
const mainButton = $("mainButton");
const moveList = $("moveList");
const statusText = $("status");

const say = (t) => (statusText.textContent = t);
const round = (n) => Math.round(n * 10000) / 10000;
let overlayDraw = null;      // set once the tracker has loaded
let mp = null;               // the MediaPipe library, once loaded

// ---------- State ----------
const audioCtx = new AudioContext(); // master clock for all timing

let songs = [];
let song = null;             // { meta, buffer, bpm, firstBeat, peaks }
const songCache = {};
let startBeat = COUNT_IN_BEATS;
let beats = 8;
let clicksOn = false;

let poseLandmarker = null;
let cameraReady = false;
let lastVideoTime = -1;

// type: "song" | "practise" | "record" | "replay"
let session = null;
let frames = [];
let missedFrames = 0;

let moves = [];              // saved moves (newest first)

// ==========================================================
// 3D CHARACTER
// ==========================================================
const scene = new THREE.Scene();
const camera3d = new THREE.PerspectiveCamera(30, 3 / 4, 0.01, 100);
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.outputColorSpace = THREE.SRGBColorSpace;
charStage.prepend(renderer.domElement);

const controls = new OrbitControls(camera3d, renderer.domElement);
controls.enableDamping = true;
controls.enablePan = false;

scene.add(new THREE.HemisphereLight(0xffffff, 0x333344, 2));
const sun = new THREE.DirectionalLight(0xffffff, 2);
sun.position.set(2, 4, 3);
scene.add(sun);
const grid = new THREE.GridHelper(6, 12, 0x444450, 0x2a2a30);
scene.add(grid);

function resize3d() {
  const w = charStage.clientWidth;
  const h = charStage.clientHeight;
  renderer.setSize(w, h);
  camera3d.aspect = w / h;
  camera3d.updateProjectionMatrix();
}
new ResizeObserver(resize3d).observe(charStage);

const draco = new DRACOLoader();
draco.setDecoderPath("https://www.gstatic.com/draco/versioned/decoders/1.5.7/");
const gltfLoader = new GLTFLoader();
gltfLoader.setDRACOLoader(draco);

let skins = [];
const skinCache = {};        // id → { model, rig }
let character = null;
let rig = null;

async function loadSkinList() {
  try {
    skins = await (await fetch("characters/skins.json")).json();
  } catch {
    say("Couldn't load characters/skins.json");
    return;
  }
  skinPicker.innerHTML = skins
    .map((s, i) => `<button data-index="${i}">${s.name}</button>`)
    .join("");
  skinPicker.addEventListener("click", (e) => {
    const btn = e.target.closest("button");
    if (btn) selectSkin(Number(btn.dataset.index));
  });
  // Hide the picker when there's only one character
  $("skinSection").style.display = skins.length > 1 ? "block" : "none";

  let saved = 0;
  try { saved = Number(localStorage.getItem("skin") || 0); } catch {}
  await selectSkin(saved < skins.length ? saved : 0);
}

async function selectSkin(index) {
  const meta = skins[index];
  for (const b of skinPicker.children) b.classList.toggle("active", Number(b.dataset.index) === index);
  try { localStorage.setItem("skin", index); } catch {}

  if (!skinCache[meta.id]) {
    charLabel.textContent = "Loading…";
    const gltf = await gltfLoader.loadAsync(meta.file, (e) => {
      if (e.lengthComputable) charLabel.textContent = `Loading ${Math.round((e.loaded / e.total) * 100)}%`;
    });
    const model = gltf.scene;
    model.traverse((o) => o.isMesh && (o.frustumCulled = false));
    skinCache[meta.id] = { model, rig: createRetargeter(model) };
    if (skinCache[meta.id].rig.missing.length) {
      console.warn(meta.name + ": bones not found:", skinCache[meta.id].rig.missing);
    }
  }

  if (character) scene.remove(character);
  ({ model: character, rig } = skinCache[meta.id]);
  rig.resetPose();
  scene.add(character);
  frameCharacter();
  charLabel.textContent = meta.name;
}

// Point the camera at the character, whatever its size or units
function frameCharacter() {
  const box = new THREE.Box3().setFromObject(character);
  if (box.isEmpty()) character.traverse((o) => o.isBone && box.expandByPoint(o.getWorldPosition(new THREE.Vector3())));
  const size = box.getSize(new THREE.Vector3());
  const centre = box.getCenter(new THREE.Vector3());
  const height = Math.max(size.x, size.y, size.z, 0.001);

  camera3d.near = height / 100;
  camera3d.far = height * 100;
  camera3d.updateProjectionMatrix();

  const dist = (height / (2 * Math.tan((camera3d.fov * Math.PI) / 360))) * 1.5;
  // Aim slightly below the middle so the character sits above the Record button
  controls.target.copy(centre).add(new THREE.Vector3(0, -height * 0.08, 0));
  camera3d.position.set(centre.x, centre.y + height * 0.05, centre.z + dist);
  controls.update();

  grid.scale.setScalar(height / 1.8);
  grid.position.set(centre.x, box.min.y, centre.z);
}

// ==========================================================
// SONGS
// ==========================================================
const secondsPerBeat = () => 60 / song.bpm;
const beatTime = (b) => song.firstBeat + b * secondsPerBeat();

async function loadSongList() {
  try {
    songs = await (await fetch("Music/songs.json")).json();
  } catch {
    songSelect.innerHTML = "<option>No songs found</option>";
    return;
  }
  songSelect.innerHTML = songs.map((s, i) => `<option value="${i}">${s.title} · ${s.artist}</option>`).join("");
  await selectSong(0);
}

async function getSong(meta, withBeats = true) {
  if (!songCache[meta.id]) {
    const data = await (await fetch(meta.file)).arrayBuffer();
    songCache[meta.id] = { meta, buffer: await audioCtx.decodeAudioData(data), bpm: meta.bpm, firstBeat: meta.firstBeat, peaks: null };
  }
  const s = songCache[meta.id];
  if (withBeats && (!s.bpm || s.firstBeat === undefined)) {
    const detected = await detectBeatsCached(meta, s.buffer);
    s.bpm = s.bpm || detected.bpm;
    s.firstBeat = s.firstBeat ?? detected.firstBeat;
  }
  return s;
}

// Work out the tempo in a background worker (so the page doesn't freeze),
// and remember the answer so each song is only analysed once per browser
async function detectBeatsCached(meta, buffer) {
  const key = `beats:${meta.id}:${meta.file}`;
  try {
    const saved = JSON.parse(localStorage.getItem(key));
    if (saved) return saved;
  } catch {}

  // Mix to mono and hand a copy to the worker
  const mono = new Float32Array(buffer.length);
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const data = buffer.getChannelData(c);
    for (let i = 0; i < data.length; i++) mono[i] += data[i] / buffer.numberOfChannels;
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

async function selectSong(index) {
  stopSession();
  setSongControlsEnabled(false);
  bpmChip.textContent = "Loading…";
  await new Promise((r) => setTimeout(r, 30));
  song = await getSong(songs[index]);
  startBeat = COUNT_IN_BEATS;
  clampStartBeat();
  buildPeaks();
  bpmChip.textContent = `${song.bpm} BPM`;
  setSongControlsEnabled(true);
}

function setSongControlsEnabled(on) {
  for (const b of [playSongButton, practiseButton, halfTempo, doubleTempo]) b.disabled = !on;
}

function clampStartBeat() {
  const last = Math.floor((song.buffer.duration - song.firstBeat) / secondsPerBeat()) - beats;
  startBeat = Math.max(0, Math.min(startBeat, last));
}

function changeTempo(factor) {
  stopSession();
  const startSeconds = beatTime(startBeat);
  song.bpm = Math.round(song.bpm * factor * 100) / 100;
  startBeat = Math.round((startSeconds - song.firstBeat) / secondsPerBeat());
  clampStartBeat();
  bpmChip.textContent = `${song.bpm} BPM`;
}

halfTempo.addEventListener("click", () => changeTempo(0.5));
doubleTempo.addEventListener("click", () => changeTempo(2));
songSelect.addEventListener("change", () => selectSong(Number(songSelect.value)));

beatsControl.addEventListener("click", (e) => {
  const btn = e.target.closest("button");
  if (!btn || btn.disabled) return;
  beats = Number(btn.dataset.beats);
  for (const b of beatsControl.children) b.classList.toggle("active", b === btn);
  if (song) clampStartBeat();
});

clicksToggle.addEventListener("click", () => {
  clicksOn = !clicksOn;
  clicksToggle.classList.toggle("on", clicksOn);
});

$("nudgeEarlier").addEventListener("click", () => (song.firstBeat = round(song.firstBeat - 0.01)));
$("nudgeLater").addEventListener("click", () => (song.firstBeat = round(song.firstBeat + 0.01)));
$("copySettings").addEventListener("click", async () => {
  const text = `"bpm": ${song.bpm}, "firstBeat": ${song.firstBeat}`;
  await navigator.clipboard.writeText(text);
  say("Copied: " + text);
});

// ==========================================================
// TIMELINE
// ==========================================================
function buildPeaks() {
  const width = Math.round(timeline.clientWidth * devicePixelRatio);
  timeline.width = width;
  timeline.height = Math.round(timeline.clientHeight * devicePixelRatio);
  const data = song.buffer.getChannelData(0);
  const per = Math.floor(data.length / width);
  const peaks = new Float32Array(width);
  for (let x = 0; x < width; x++) {
    let max = 0;
    for (let i = x * per; i < (x + 1) * per; i += 16) max = Math.max(max, Math.abs(data[i]));
    peaks[x] = max;
  }
  song.peaks = peaks;
}

window.addEventListener("resize", () => song && buildPeaks());

function drawTimeline(playhead) {
  const w = timeline.width;
  const h = timeline.height;
  const dpr = devicePixelRatio;
  const duration = song.buffer.duration;
  const toX = (t) => (t / duration) * w;
  const countIn = toX(beatTime(startBeat - COUNT_IN_BEATS));
  const moveStart = toX(beatTime(startBeat));
  const moveEnd = toX(beatTime(startBeat + beats));

  timelineCtx.clearRect(0, 0, w, h);
  timelineCtx.fillStyle = "rgba(255, 204, 0, 0.16)";
  timelineCtx.fillRect(countIn, 0, moveStart - countIn, h);
  timelineCtx.fillStyle = "rgba(255, 45, 85, 0.22)";
  timelineCtx.fillRect(moveStart, 0, moveEnd - moveStart, h);

  timelineCtx.fillStyle = "rgba(255,255,255,0.06)";
  for (let b = 0; beatTime(b) < duration; b += 4) timelineCtx.fillRect(toX(beatTime(b)), 0, 1, h);

  const mid = h / 2;
  for (let x = 0; x < song.peaks.length; x++) {
    timelineCtx.fillStyle = x >= moveStart && x < moveEnd ? "#ff5c7c" : "#4a4a52";
    const bar = Math.max(1, song.peaks[x] * h * 0.4);
    timelineCtx.fillRect(x, mid - bar, 1, bar * 2);
  }

  timelineCtx.font = `600 ${10 * dpr}px system-ui, sans-serif`;
  timelineCtx.textBaseline = "top";
  const fits = (text, width) => timelineCtx.measureText(text).width + 10 * dpr < width;
  if (fits("4-3-2-1", moveStart - countIn)) {
    timelineCtx.fillStyle = "#ffcc00";
    timelineCtx.fillText("4-3-2-1", countIn + 5 * dpr, 6 * dpr);
  }
  if (fits("DANCE", moveEnd - moveStart)) {
    timelineCtx.fillStyle = "#ff2d55";
    timelineCtx.fillText("DANCE", moveStart + 5 * dpr, 6 * dpr);
  }

  timelineCtx.fillStyle = "#ff2d55";
  timelineCtx.fillRect(moveStart - dpr, 0, 2 * dpr, h);
  if (playhead !== null) {
    timelineCtx.fillStyle = "#fff";
    timelineCtx.fillRect(toX(playhead), 0, 2 * dpr, h);
  }
}

timeline.addEventListener("click", (e) => {
  if (!song || (session && session.type === "record")) return;
  const rect = timeline.getBoundingClientRect();
  const t = ((e.clientX - rect.left) / rect.width) * song.buffer.duration;
  startBeat = Math.round((t - song.firstBeat) / secondsPerBeat());
  clampStartBeat();
  if (session && session.type === "song") playSong(t);
});

// ==========================================================
// AUDIO
// ==========================================================
function scheduleClick(time, accent) {
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.frequency.value = accent ? 1500 : 1000;
  gain.gain.setValueAtTime(0.35, time);
  gain.gain.exponentialRampToValueAtTime(0.001, time + 0.05);
  osc.connect(gain).connect(audioCtx.destination);
  osc.start(time);
  osc.stop(time + 0.06);
  return osc;
}

function startSong(buffer, when, offset, stopAt) {
  const source = audioCtx.createBufferSource();
  const gain = audioCtx.createGain();
  source.buffer = buffer;
  source.connect(gain).connect(audioCtx.destination);
  source.start(when + Math.max(0, -offset), Math.max(0, offset));
  if (stopAt) {
    gain.gain.setValueAtTime(1, stopAt);
    gain.gain.linearRampToValueAtTime(0, stopAt + 0.25);
    source.stop(stopAt + 0.3);
  }
  return source;
}

function stopSession() {
  if (!session) return;
  for (const node of session.nodes) {
    try { node.stop(); } catch {}
  }
  const type = session.type;
  session = null;
  bigText.textContent = "";
  recBadge.style.display = "none";
  if (type === "record") say("Cancelled");
  if (rig && !cameraReady) rig.resetPose();
  resetButtons();
}

function resetButtons() {
  playSongButton.textContent = "▶";
  practiseButton.textContent = "Practise";
  if (cameraReady) mainButton.textContent = "● Record";
  setLocked(false);
  renderMoveList();
}

function setLocked(locked) {
  for (const el of [songSelect, playSongButton, practiseButton, halfTempo, doubleTempo, ...beatsControl.children, ...skinPicker.children]) {
    el.disabled = locked;
  }
}

async function playSong(from = 0) {
  await audioCtx.resume();
  stopSession();
  const t0 = audioCtx.currentTime + 0.05;
  const nodes = [startSong(song.buffer, t0, from)];
  if (clicksOn) {
    const spb = secondsPerBeat();
    for (let b = Math.max(0, Math.ceil((from - song.firstBeat) / spb)); beatTime(b) < song.buffer.duration; b++) {
      nodes.push(scheduleClick(t0 + beatTime(b) - from, b % 4 === 0));
    }
  }
  session = { type: "song", nodes, songTimeAt: (now) => from + (now - t0), endsAt: t0 + song.buffer.duration - from };
  playSongButton.textContent = "■";
}

playSongButton.addEventListener("click", () => (session && session.type === "song" ? stopSession() : playSong(0)));

// Practise / record: count-in with the music, then the move
async function startSection(type) {
  await audioCtx.resume();
  stopSession();

  const spb = secondsPerBeat();
  const countInSongTime = beatTime(startBeat - COUNT_IN_BEATS);
  const t0 = audioCtx.currentTime + 0.2;
  const moveStart = t0 + COUNT_IN_BEATS * spb;
  const moveEnd = moveStart + beats * spb;

  const nodes = [startSong(song.buffer, t0, countInSongTime, moveEnd)];
  for (let i = 0; i < COUNT_IN_BEATS; i++) nodes.push(scheduleClick(t0 + i * spb, i === 0));
  if (clicksOn) for (let i = 0; i < beats; i++) nodes.push(scheduleClick(moveStart + i * spb, i % 4 === 0));

  session = {
    type, nodes, t0, moveStart, moveEnd, spb, beats,
    moveSongTime: beatTime(startBeat),
    songTimeAt: (now) => countInSongTime + (now - t0),
    endsAt: moveEnd
  };

  if (type === "record") {
    frames = [];
    missedFrames = 0;
    mainButton.textContent = "■ Cancel";
  } else {
    practiseButton.textContent = "■ Stop";
  }
  say("");
  setLocked(type === "record");
}

practiseButton.addEventListener("click", () =>
  session && session.type === "practise" ? stopSession() : startSection("practise")
);

// Play a saved move on the character, with its music
async function playMove(move) {
  await audioCtx.resume();
  stopSession();
  const meta = songs.find((s) => s.id === move.songId);
  const t0 = audioCtx.currentTime + 0.1;
  const end = t0 + move.duration;
  const nodes = [];
  if (meta) {
    const s = await getSong(meta, false);
    nodes.push(startSong(s.buffer, t0, move.songStart, end));
  }
  session = { type: "replay", move, nodes, t0, endsAt: end, songTimeAt: () => null };
  renderMoveList();
}

// ==========================================================
// CAMERA
// ==========================================================
let trackerPromise = null;
function loadTracker() {
  trackerPromise ||= (async () => {
    mp = await import(`${MEDIAPIPE}/vision_bundle.mjs`);
    const vision = await mp.FilesetResolver.forVisionTasks(`${MEDIAPIPE}/wasm`);
    poseLandmarker = await mp.PoseLandmarker.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath:
        "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task",
      delegate: "GPU"
    },
    runningMode: "VIDEO",
    numPoses: 1
  });
    overlayDraw = new mp.DrawingUtils(overlayCtx);
  })();
  return trackerPromise;
}

async function startCamera() {
  mainButton.disabled = true;
  mainButton.textContent = "Starting…";
  try {
    // Ask for the camera while the tracker finishes loading
    const cameraPromise = navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 }, audio: false });
    video.srcObject = await cameraPromise;
    await new Promise((r) => (video.readyState >= 2 ? r() : video.addEventListener("loadeddata", r, { once: true })));
    overlay.width = video.videoWidth;
    overlay.height = video.videoHeight;

    if (!poseLandmarker) say("Getting the tracker ready (only slow the first time)…");
    await loadTracker();

    cameraReady = true;
    $("camHint").style.display = "none";
    mainButton.textContent = "● Record";
    say("Step back so your whole body is in view");
  } catch (err) {
    mainButton.textContent = "Start camera";
    say(err && err.name === "NotAllowedError"
      ? "Camera blocked. Allow access in the address bar."
      : "Couldn't start. Check your internet and try again.");
    trackerPromise = null;
  } finally {
    mainButton.disabled = false;
  }
}

mainButton.addEventListener("click", () => {
  if (!cameraReady) return startCamera();
  if (session && session.type === "record") return stopSession();
  if (song && rig) startSection("record");
});

// ==========================================================
// SWAP VIEWS (click the small corner view to make it big)
// ==========================================================
const camView = $("camView");
controls.enabled = false; // the character starts in the corner

document.querySelector(".stage").addEventListener("click", (e) => {
  const pip = e.target.closest(".view.pip");
  if (!pip) return;
  const big = pip === camView ? charStage : camView;
  pip.classList.replace("pip", "main");
  big.classList.replace("main", "pip");
  // You can only spin the character around when it's the big view
  controls.enabled = charStage.classList.contains("main");
});

// ==========================================================
// MAIN LOOP
// ==========================================================
function mainLoop() {
  requestAnimationFrame(mainLoop);
  const now = audioCtx.currentTime;

  try {
    // --- Track the body ---
    if (cameraReady && video.currentTime !== lastVideoTime) {
      lastVideoTime = video.currentTime;
      const result = poseLandmarker.detectForVideo(video, performance.now());
      const found = result.landmarks.length > 0;
      const isRecording = session && session.type === "record" && now >= session.moveStart && now < session.moveEnd;

      overlayCtx.clearRect(0, 0, overlay.width, overlay.height);
      if (found) {
        overlayDraw.drawConnectors(result.landmarks[0], mp.PoseLandmarker.POSE_CONNECTIONS, {
          color: isRecording ? "#ff2d55" : "#00e5ff",
          lineWidth: 4
        });
        overlayDraw.drawLandmarks(result.landmarks[0], { color: "#fff", radius: 3 });

        // The character copies you live (like a mirror) unless a saved move is playing
        const points = result.worldLandmarks[0].map((p) => [p.x, p.y, p.z]);
        if (rig && !(session && session.type === "replay")) rig.applyPose(mirrorPoints(points));
      }

      if (isRecording) {
        if (found) {
          const t = now - session.moveStart;
          frames.push({
            t: round(t),
            beat: round(t / session.spb),
            points: result.worldLandmarks[0].map((p) => [round(p.x), round(p.y), round(p.z), round(p.visibility ?? 1)])
          });
        } else {
          missedFrames++;
        }
      }
    }

    // --- Count-in and beat counter ---
    if (session && (session.type === "record" || session.type === "practise")) {
      if (now >= session.t0 && now < session.moveStart) {
        bigText.textContent = COUNT_IN_BEATS - Math.floor((now - session.t0) / session.spb);
      } else if (now >= session.moveStart && now < session.moveEnd) {
        bigText.textContent = "";
        const beatNow = Math.min(Math.floor((now - session.moveStart) / session.spb) + 1, session.beats);
        recBadge.style.display = "block";
        recBadge.textContent = (session.type === "record" ? "● REC " : "Practice ") + `${beatNow}/${session.beats}`;
      }
    }

    // --- A saved move playing on the character ---
    if (session && session.type === "replay" && rig) {
      rig.applyPose(samplePoints(session.move, Math.max(0, now - session.t0)));
    }

    // --- Finished? ---
    if (session && now >= session.endsAt) {
      const done = session;
      session = null;
      bigText.textContent = "";
      recBadge.style.display = "none";
      if (rig && !cameraReady) rig.resetPose();
      if (done.type === "record") finishRecording(done);
      resetButtons();
    }

    if (song && song.peaks) drawTimeline(session ? session.songTimeAt(now) : null);
  } catch (err) {
    console.error(err);
  }

  controls.update();
  renderer.render(scene, camera3d);
}

// ==========================================================
// SAVING
// ==========================================================
async function finishRecording(s) {
  if (frames.length < 10) {
    say("Couldn't see you. Step back and try again.");
    return;
  }

  const raw = {
    songId: song.meta.id,
    songStart: round(s.moveSongTime),
    bpm: song.bpm,
    beats: s.beats,
    duration: round(s.beats * s.spb),
    landmarkCount: 33,
    frames
  };

  const move = {
    ...smoothMove(raw, 0.05),
    id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
    name: `Move ${moves.length + 1}`,
    songTitle: song.meta.title,
    createdAt: Date.now()
  };

  await saveMove(move);
  moves = await listMoves();

  const missedPct = Math.round((missedFrames / (frames.length + missedFrames)) * 100);
  say(missedPct > 20 ? "Saved, but you were out of view at times" : "Saved to My moves ✓");

  // Show it straight away on the character
  playMove(move);
}

// ==========================================================
// MY MOVES LIST
// ==========================================================
function renderMoveList() {
  if (!moves.length) {
    moveList.innerHTML = `<div class="empty">Your recorded moves will appear here</div>`;
    return;
  }
  const playingId = session && session.type === "replay" ? session.move.id : null;
  moveList.innerHTML = moves
    .map((m) => `
      <div class="move ${m.id === playingId ? "playing" : ""}" data-id="${m.id}">
        <button class="icon-btn play" title="Play on character">${m.id === playingId ? "■" : "▶"}</button>
        <div class="info">
          <input value="${escapeHtml(m.name)}" title="Rename" />
          <div class="meta">${m.beats} beats · ${escapeHtml(m.songTitle || m.songId)}</div>
        </div>
        <button class="tiny delete" title="Delete">✕</button>
      </div>`)
    .join("");
}

moveList.addEventListener("click", async (e) => {
  const row = e.target.closest(".move");
  if (!row) return;
  const move = moves.find((m) => m.id === row.dataset.id);
  if (e.target.closest(".play")) {
    if (session && session.type === "replay" && session.move.id === move.id) stopSession();
    else playMove(move);
  }
  if (e.target.closest(".delete")) {
    if (session && session.type === "replay" && session.move.id === move.id) stopSession();
    await deleteMove(move.id);
    moves = await listMoves();
    renderMoveList();
  }
});

// Rename: saves when you click away or press Enter
moveList.addEventListener("change", async (e) => {
  const row = e.target.closest(".move");
  if (!row || e.target.tagName !== "INPUT") return;
  const move = moves.find((m) => m.id === row.dataset.id);
  move.name = e.target.value.trim() || move.name;
  await saveMove(move);
});
moveList.addEventListener("keydown", (e) => e.key === "Enter" && e.target.blur());

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// ---------- Go ----------
mainLoop();
mainButton.disabled = false;
mainButton.textContent = "Start camera";
listMoves().then((m) => { moves = m; renderMoveList(); });

// Load the song and character first. Once they're on screen, quietly start
// downloading the tracker so it's usually ready by the time you hit Start camera.
Promise.allSettled([
  loadSongList(),
  loadSkinList().catch((err) => say("Couldn't load the character: " + err.message))
]).then(() => loadTracker().catch(() => (trackerPromise = null)));
