import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createRetargeter } from './retarget.js';
import { loadRecordedMoves } from './recorded-moves.js';
import { setupSongPicker, startMusic, stopMusic, tempoFactor, musicTimeUp, keepDancing } from './music.js';

// ================= YOUR DANCES =================
// Add a line here for every new dance. "id" must match the action name in Blender.
const DANCES = [
  { id: 'funkydance',  name: 'Funky Bop',    emoji: '🕺', file: 'Dances/Magdalene/MKBopping.glb',
    desc: 'Knee bops – arms open when she rises, tuck in when she dips, turning left then right.' },
  { id: 'hiphits',     name: 'Hip Hits',     emoji: '💃', file: 'Dances/Magdalene/MKSidetoSide.glb',
    desc: 'Hands slap the hips right-left-right while the hips pop out to meet them.' },
  { id: 'shakawalk',   name: 'Shaka Walk',   emoji: '🤙', file: 'Dances/Magdalene/MKShaka.glb',
    desc: 'Shaka hands shaking while she steps forward and back, opposite arm out front.' },
  { id: 'kneebending', name: 'Knee Bending', emoji: '🦵', file: 'Dances/Chanulya/kneebending.glb',
    desc: 'Chanulya’s Brazilian knee bending groove.' },
  { id: 'woah',        name: 'Woah',         emoji: '😮', file: 'Dances/Chanulya/woah.glb',
    desc: 'Chanulya’s Brazilian woah move.' },
  { id: 'canirideh',   name: 'Can I Ride (Hands)', emoji: '🙌', file: 'Dances/Pranusha/Can_i_ride_hands.glb',
    desc: 'Pranusha’s Can I Ride – hands part.' },
  { id: 'canuridel',   name: 'Can I Ride (Legs)',  emoji: '🦿', file: 'Dances/Pranusha/Can_i_ride_legs.glb',
    desc: 'Pranusha’s Can I Ride – legs part.' },
  { id: 'drumjump',    name: 'Drum Jump',    emoji: '🥁', file: 'Dances/Pranusha/drum_jump.glb',
    desc: 'Pranusha’s drum jump move.' },
  { id: 'brazpump',    name: 'Brazilian Pump', emoji: '🔥', file: 'Dances/Bhoomini/AIBrazillianPump.glb',
    desc: 'Bhoomini’s Brazilian pump.' },
  { id: 'fratflick',   name: 'Frat Flick',   emoji: '😎', file: 'Dances/Bhoomini/AIFratFlick.glb',
    desc: 'Bhoomini’s frat flick move.' },
  { id: 'nut',         name: 'Nut',          emoji: '🥜', file: 'Dances/Bhoomini/AINut.glb',
    desc: 'Bhoomini’s nut move.' },
  { id: 'rah',         name: 'Rah',          emoji: '📣', file: 'Dances/Bhoomini/AIRah1.glb',
    desc: 'Bhoomini’s rah move.' },
  { id: 'scuba',       name: 'Scuba',        emoji: '🤿', file: 'Dances/Bhoomini/AIScuba.glb',
    desc: 'Bhoomini’s scuba move.' },
];

// ================= 3D STAGE =================
const stage = document.getElementById('stage');
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(35, 1, 0.01, 100);
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.outputColorSpace = THREE.SRGBColorSpace;
stage.appendChild(renderer.domElement);

scene.add(new THREE.HemisphereLight(0xffffff, 0x443355, 2.2));
const sun = new THREE.DirectionalLight(0xffffff, 2.0);
sun.position.set(2, 4, 3);
scene.add(sun);
const grid = new THREE.GridHelper(10, 20, 0x6b5a8e, 0x3a3150);
scene.add(grid);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;

function resize() {
  const w = stage.clientWidth, h = stage.clientHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

// ================= BACKGROUNDS =================
// Add your own picture: put it in website/backgrounds/ and add a line with image: '...'
const BACKGROUNDS = [
  { name: '🌙 Night',          colors: ['#2a1f45', '#0f0b1a'] },
  { name: '🌴 Vice Beach',     image: 'backgrounds/01-vice-beach-sunset.webp',   grid: false },
  { name: '🍂 Autumn Park',    image: 'backgrounds/02-autumn-park.webp',         grid: false },
  { name: '🇧🇷 Copacabana',     image: 'backgrounds/03-rio-copacabana.webp',      grid: false },
  { name: '🏮 Tokyo Neon',     image: 'backgrounds/04-tokyo-neon-night.webp',    grid: false },
  { name: '⚡ Electric Grid',  image: 'backgrounds/05-electric-grid.webp',       grid: false },
  { name: '🏜️ Desert',         image: 'backgrounds/06-desert-midday.webp',       grid: false },
  { name: '🏝️ Tropical Beach', image: 'backgrounds/07-tropical-beach-day.webp',  grid: false },
  { name: '🌌 Aurora',         image: 'backgrounds/08-aurora-mountains.webp',    grid: false },
  { name: '🌸 Cherry Blossom', image: 'backgrounds/09-cherry-blossom-park.webp', grid: false },
  { name: '🛋️ Cozy Bedroom',   image: 'backgrounds/10-cozy-bedroom.webp',        grid: false },
  { name: '🎤 Hype Stage',     image: 'backgrounds/11-hype-stage.webp',          grid: false },
  { name: '🐠 Underwater',     image: 'backgrounds/12-underwater-reef.webp',     grid: false },
  { name: '🚀 Mars',           image: 'backgrounds/13-mars-space.webp',          grid: false },
  { name: '🎨 Graffiti Alley', image: 'backgrounds/14-graffiti-alley.webp',      grid: false },
  { name: '🌧️ Rainy Rooftop',  image: 'backgrounds/15-rainy-rooftop.webp',       grid: false },
];

function gradientTexture(colors) {
  const c = document.createElement('canvas');
  c.width = 2; c.height = 512;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, 512);
  colors.forEach((col, i) => grad.addColorStop(i / (colors.length - 1), col));
  g.fillStyle = grad; g.fillRect(0, 0, 2, 512);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// photos fill the frame without being stretched (like CSS "cover")
function fitCover(t) {
  const img = t.image;
  if (!img || img.width <= 2) return;
  const view = renderer.domElement.width / renderer.domElement.height;
  const pic = img.width / img.height;
  t.repeat.set(1, 1); t.offset.set(0, 0);
  if (pic > view) { t.repeat.x = view / pic; t.offset.x = (1 - t.repeat.x) / 2; }
  else            { t.repeat.y = pic / view; t.offset.y = (1 - t.repeat.y) / 2; }
}
window.addEventListener('resize', () => { if (scene.background?.isTexture) fitCover(scene.background); });

function setBackground(i) {
  const bg = BACKGROUNDS[i];
  grid.visible = bg.grid !== false;
  if (bg.image) {
    new THREE.TextureLoader().load(bg.image, (t) => {
      t.colorSpace = THREE.SRGBColorSpace; fitCover(t); scene.background = t;
    });
  } else {
    scene.background = gradientTexture(bg.colors);
  }
  document.querySelectorAll('#bgPicker button').forEach((b, j) => b.classList.toggle('active', j === i));
}

const picker = document.getElementById('bgPicker');   // needs <div id="bgPicker"> in index.html
if (picker) BACKGROUNDS.forEach((bg, i) => {
  const b = document.createElement('button');
  b.className = 'small'; b.textContent = bg.name;
  b.addEventListener('click', () => setBackground(i));
  picker.appendChild(b);
});
setBackground(0);

// ================= LOAD DANCER + DANCES =================
const loader = new GLTFLoader();
const draco = new DRACOLoader();
draco.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.7/');
loader.setDRACOLoader(draco);

let mixer = null;
let rig = null;
const clips = {};          // dance id -> AnimationClip
const clock = new THREE.Clock();

// The girl on the website comes from this file - every dance plays on her.
const CHARACTER_FILE = 'Dances/Magdalene/shakastep.glb';

async function loadEverything() {
  let model = null;
  const hasBody = (g) => { let n = 0; g.scene.traverse(o => { if (o.isMesh) n++; }); return n > 0; };
  const useAsGirl = (g, file) => {
    model = g.scene;
    scene.add(model);
    mixer = new THREE.AnimationMixer(model);
    frameModel(model);
    rig = createRetargeter(model);
    console.log('The girl comes from:', file);
  };
  try {
    const gltf = await loader.loadAsync(CHARACTER_FILE);
    if (hasBody(gltf)) useAsGirl(gltf, CHARACTER_FILE);
  } catch (err) {
    console.warn('Could not load character', CHARACTER_FILE, err);
  }
  for (const dance of DANCES) {
    try {
      const gltf = await loader.loadAsync(dance.file);
      if (!model && hasBody(gltf)) useAsGirl(gltf, dance.file);   // no body yet? borrow it from this file
      const clip = gltf.animations.find(a => a.name === dance.id) || gltf.animations[0];
      if (clip) clips[dance.id] = clip;
    } catch (err) {
      console.warn('Could not load', dance.file, err);
    }
  }
  if (!model) console.warn('None of the .glb files have her body - export character.glb in Object Mode');
  document.getElementById('loading').textContent =
    model ? '' : 'No body found – export character.glb in Object Mode.';
  await refreshRecorded();
  renderLibrary();
}

// ================= RECORDED MOVES + MUSIC =================
let recorded = [];   // moves recorded in studio.html

async function refreshRecorded() {
  if (!rig) return;
  recorded = await loadRecordedMoves(rig, clips);
  routine = routine.filter((s) => clips[s.id]);   // drop moves that were deleted
}

// Coming back from the studio? Pick up any new moves.
window.addEventListener('focus', async () => { await refreshRecorded(); renderLibrary(); renderRoutine(); });

const allDances = () => [...DANCES, ...recorded];

// A step's speed after matching the dance to the song's tempo
function effectiveSpeed(step) {
  const dance = allDances().find((d) => d.id === step.id);
  return clamp(step.speed * tempoFactor(dance?.bpm), 0.25, 4);
}

// ================= SHARE WITH export.js =================
window.tanda = {
  get routine() { return routine; },     // always the latest routine, even after the AI replaces it
  play: () => { stopAll(); return playRoutine(); },
  seconds: () => routine.reduce((t, s) => t + ((clips[s.id]?.duration || 4) / effectiveSpeed(s)) * s.repeats, 0),
  setExportBackground: () => {},          // the chosen background is already part of the video
};

function frameModel(model) {
  let box = new THREE.Box3().setFromObject(model);
  let size = box.getSize(new THREE.Vector3());
  let meshes = 0;
  model.traverse(o => { if (o.isMesh) meshes++; });
  console.log('Character: meshes =', meshes, '| size =', size.x, size.y, size.z);
  // if she comes in way too small or way too big, scale her to normal human height
  if (isFinite(size.y) && size.y > 0 && (size.y < 0.5 || size.y > 5)) {
    model.scale.multiplyScalar(1.7 / size.y);
    model.updateMatrixWorld(true);
    box = new THREE.Box3().setFromObject(model);
    size = box.getSize(new THREE.Vector3());
  }
  if (!isFinite(size.y) || size.y <= 0) {
    console.warn('No body found in CHARACTER_FILE - export it in Object Mode with her body selected');
    camera.position.set(0, 1, 4);
    controls.target.set(0, 1, 0);
    controls.update();
    return;
  }
  const center = box.getCenter(new THREE.Vector3());
  model.position.x -= center.x;
  model.position.z -= center.z;
  model.position.y -= box.min.y;              // feet on the floor
  const h = size.y;
  camera.position.set(0, h * 0.6, h * 2.4);
  controls.target.set(0, h * 0.5, 0);
  controls.update();
}

function animate() {
  requestAnimationFrame(animate);
  const dt = clock.getDelta();
  if (mixer) mixer.update(dt);
  controls.update();
  renderer.render(scene, camera);
}
animate();

// ================= PLAYING =================
let current = null;     // currently playing AnimationAction
let playToken = 0;      // bumps every time we start/stop, so old routines stop cleanly

function playClip(id, { speed = 1, repeats = 1 } = {}) {
  return new Promise((resolve) => {
    const clip = clips[id];
    if (!clip || !mixer) return resolve();
    const action = mixer.clipAction(clip);
    action.reset();
    action.setLoop(THREE.LoopRepeat, repeats);
    action.clampWhenFinished = true;
    action.timeScale = speed;
    if (current && current !== action) {
      action.play();
      current.crossFadeTo(action, 0.3, false);
    } else {
      action.play();
    }
    current = action;
    const onFinish = (e) => {
      if (e.action !== action) return;
      mixer.removeEventListener('finished', onFinish);
      resolve();
    };
    mixer.addEventListener('finished', onFinish);
  });
}

async function playRoutine() {
  if (!routine.length) return setNowPlaying('Add some moves first!');
  const token = ++playToken;
  const msToFirstBeat = await startMusic();               // start the song...
  await new Promise((r) => setTimeout(r, msToFirstBeat)); // ...and wait for its first beat
  do {                                                    // repeat to fill the chosen music length
    for (let i = 0; i < routine.length; i++) {
      if (token !== playToken) return;
      if (musicTimeUp()) break;                           // music's chosen time is over
      const step = routine[i];
      highlightStep(i);
      setNowPlaying(`Now: <b>${danceName(step.id)}</b> (${i + 1}/${routine.length})`);
      await playClip(step.id, { speed: effectiveSpeed(step), repeats: step.repeats });
    }
  } while (token === playToken && keepDancing());
  if (token === playToken) {
    highlightStep(-1);
    setNowPlaying('Routine finished 🎉');
    stopMusic(1.5);
  }
}

function stopAll() {
  playToken++;
  stopMusic();
  if (mixer) mixer.stopAllAction();
  current = null;
  highlightStep(-1);
  setNowPlaying('Stopped');
}

// ================= ROUTINE =================
let routine = [];   // [{ id, speed, repeats }]

function addStep(id, speed = 1, repeats = 1) {
  routine.push({ id, speed, repeats });
  renderRoutine();
}

function renderLibrary() {
  const lib = document.getElementById('library');
  lib.innerHTML = '';
  for (const d of allDances()) {
    const ok = !!clips[d.id];
    const el = document.createElement('div');
    el.className = 'move' + (ok ? '' : ' missing');
    el.innerHTML = `
      <div class="emoji">${d.emoji}</div>
      <div class="info">
        <div class="name">${d.name}</div>
        <div class="desc">${ok ? d.desc : 'Not exported yet (' + d.file + ')'}</div>
      </div>
      <button class="small" ${ok ? '' : 'disabled'}>+ Add</button>`;
    if (ok) {
      el.addEventListener('click', () => { stopAll(); setNowPlaying(`Preview: <b>${d.name}</b>`); playClip(d.id); });
      el.querySelector('button').addEventListener('click', (e) => { e.stopPropagation(); addStep(d.id); });
    }
    lib.appendChild(el);
  }
}

function renderRoutine() {
  const list = document.getElementById('routine');
  list.innerHTML = '';
  routine.forEach((step, i) => {
    const li = document.createElement('li');
    li.innerHTML = `
      <span class="step-name">${i + 1}. ${danceName(step.id)}</span>
      <select title="speed">
        ${[0.5, 0.75, 1, 1.25, 1.5, 2].map(s => `<option value="${s}" ${s == step.speed ? 'selected' : ''}>${s}x</option>`).join('')}
      </select>
      <input type="number" min="1" max="8" value="${step.repeats}" title="repeats" />
      <button class="small" data-act="up">↑</button>
      <button class="small" data-act="down">↓</button>
      <button class="small" data-act="del">✕</button>`;
    li.querySelector('select').addEventListener('change', (e) => { step.speed = parseFloat(e.target.value); });
    li.querySelector('input').addEventListener('change', (e) => { step.repeats = clamp(parseInt(e.target.value) || 1, 1, 8); });
    li.querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
      const act = b.dataset.act;
      if (act === 'up' && i > 0) [routine[i - 1], routine[i]] = [routine[i], routine[i - 1]];
      if (act === 'down' && i < routine.length - 1) [routine[i + 1], routine[i]] = [routine[i], routine[i + 1]];
      if (act === 'del') routine.splice(i, 1);
      renderRoutine();
    }));
    list.appendChild(li);
  });
  document.getElementById('emptyRoutine').style.display = routine.length ? 'none' : 'block';
}

function highlightStep(i) {
  document.querySelectorAll('#routine li').forEach((li, j) => li.classList.toggle('active', j === i));
}

// ================= AI CHOREOGRAPHER =================
// The AI lives in server.js (port 3000). If this page was opened some other way (e.g. Go Live), talk to that server directly.
// (Only on your own computer. On a deployed website the page and the server share one address, so no prefix is needed.)
const ON_MY_COMPUTER = ['localhost', '127.0.0.1'].includes(location.hostname);
const API_BASE = ON_MY_COMPUTER && location.port !== '3000' ? 'http://localhost:3000' : '';
async function askAI() {
  const prompt = document.getElementById('prompt').value.trim();
  const out = document.getElementById('aiOut');
  const btn = document.getElementById('aiBtn');
  if (!prompt) { out.innerHTML = '<p class="error">Type what you want first!</p>'; return; }

  const available = allDances().filter(d => clips[d.id]).map(d => ({ id: d.id, name: d.name, desc: d.desc, dur: clips[d.id].duration }));  btn.disabled = true;
  out.innerHTML = '<p>💭 Choreographing…</p>';
  try {
    const res = await fetch(API_BASE + '/api/choreograph', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, dances: available, current: routine }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'AI request failed');

    routine = data.steps
      .filter(s => clips[s.id])
      .map(s => ({ id: s.id, speed: clamp(+s.speed || 1, 0.5, 2), repeats: clamp(Math.round(+s.repeats || 1), 1, 8) }));
    renderRoutine();
    document.getElementById('routineName').textContent = data.name ? `– ${data.name}` : '';
    out.innerHTML = `
      <h3>${escapeHtml(data.name || 'Your routine')}</h3>
      <p>${escapeHtml(data.vibe || '')}</p>
      ${data.tips?.length ? `<ul>${data.tips.map(t => `<li>${escapeHtml(t)}</li>`).join('')}</ul>` : ''}`;
    stopAll();
    playRoutine();
  } catch (err) {
    const down = err instanceof TypeError || /pattern|Failed to fetch|Load failed|JSON/i.test(err.message);
    out.innerHTML = `<p class="error">${down ? 'Cannot reach the AI. In the VS Code terminal run: node server.js  (then try again)' : escapeHtml(err.message)}</p>`;
  } finally {
    btn.disabled = false;
  }
}

// ================= HELPERS + BUTTONS =================
function danceName(id) { return allDances().find(d => d.id === id)?.name || id; }
function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }
function setNowPlaying(html) { document.getElementById('nowPlaying').innerHTML = html; }
function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

document.getElementById('playBtn').addEventListener('click', () => { stopAll(); playRoutine(); });
document.getElementById('stopBtn').addEventListener('click', stopAll);
document.getElementById('clearBtn').addEventListener('click', () => {
  stopAll(); routine = []; renderRoutine();
  document.getElementById('routineName').textContent = '';
  document.getElementById('aiOut').innerHTML = '';
});
document.getElementById('aiBtn').addEventListener('click', askAI);

renderRoutine();
setupSongPicker(document.getElementById('songSelect'), document.getElementById('bpmChip'), stopAll);
loadEverything();