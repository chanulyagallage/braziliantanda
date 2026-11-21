import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

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
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
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

// ================= LOAD DANCER + DANCES =================
const loader = new GLTFLoader();
const draco = new DRACOLoader();
draco.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.7/');
loader.setDRACOLoader(draco);

let mixer = null;
const clips = {};          // dance id -> AnimationClip
const clock = new THREE.Clock();

// The girl on the website comes from this file - every dance plays on her.
const CHARACTER_FILE = 'Dances/Bhoomini/AIBrazillianPump.glb';

async function loadEverything() {
  let model = null;
  try {
    const gltf = await loader.loadAsync(CHARACTER_FILE);
    model = gltf.scene;
    scene.add(model);
    mixer = new THREE.AnimationMixer(model);
    frameModel(model);
  } catch (err) {
    console.warn('Could not load character', CHARACTER_FILE, err);
  }
  for (const dance of DANCES) {
    try {
      const gltf = await loader.loadAsync(dance.file);
      if (!model) {
        model = gltf.scene;
        scene.add(model);
        mixer = new THREE.AnimationMixer(model);
        frameModel(model);
      }
      const clip = gltf.animations.find(a => a.name === dance.id) || gltf.animations[0];
      if (clip) clips[dance.id] = clip;
    } catch (err) {
      console.warn('Could not load', dance.file, err);
    }
  }
  document.getElementById('loading').textContent =
    model ? '' : 'No dances found – export your .glb files into the dances/ folder.';
  renderLibrary();
}

function frameModel(model) {
  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  model.position.x -= center.x;
  model.position.z -= center.z;
  model.position.y -= box.min.y;              // feet on the floor
  const height = size.y;
  camera.position.set(0, height * 0.6, height * 2.4);
  controls.target.set(0, height * 0.5, 0);
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
  for (let i = 0; i < routine.length; i++) {
    if (token !== playToken) return;
    const step = routine[i];
    highlightStep(i);
    setNowPlaying(`Now: <b>${danceName(step.id)}</b> (${i + 1}/${routine.length})`);
    await playClip(step.id, step);
  }
  if (token === playToken) {
    highlightStep(-1);
    setNowPlaying('Routine finished 🎉');
  }
}

function stopAll() {
  playToken++;
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
  for (const d of DANCES) {
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

  const available = DANCES.filter(d => clips[d.id]).map(d => ({ id: d.id, name: d.name, desc: d.desc, dur: clips[d.id].duration }));  btn.disabled = true;
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
function danceName(id) { return DANCES.find(d => d.id === id)?.name || id; }
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
loadEverything();