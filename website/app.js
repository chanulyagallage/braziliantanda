import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { createRetargeter } from './retarget.js';
import { loadRecordedMoves } from './recorded-moves.js';
import { getCurrentSong, setupSongPicker, startMusic, stopMusic, tempoFactor, musicTimeUp, keepDancing, getMusicState, restoreMusic } from './music.js';

// ================= YOUR DANCES =================
// Add a line here for every new dance. "id" must match the action name in Blender.
// "desc" isn't shown on the page any more, but the AI choreographer reads it to pick moves.
const DANCES = [
  { id: 'funkydance', name: 'Funky Bop',          file: 'Dances/Magdalene/MKBopping.glb',
    desc: 'Knee bops – arms open when she rises, tuck in when she dips, turning left then right.' },
  { id: 'hiphits',    name: 'Hip Hits',           file: 'Dances/Magdalene/MKSidetoSide.glb',
    desc: 'Hands slap the hips right-left-right while the hips pop out to meet them.' },
  { id: 'shakawalk',  name: 'Shaka Walk',         file: 'Dances/Magdalene/MKShaka.glb',
    desc: 'Shaka hands shaking while she steps forward and back, opposite arm out front.' },
  { id: 'woah',       name: 'Woah',               file: 'Dances/Chanulya/woah.glb',
    desc: 'Brazilian woah move.' },
  { id: 'canirideh',  name: 'Can I Ride (Hands)', file: 'Dances/Pranusha/Can_i_ride_hands.glb',
    desc: 'Can I Ride – hands part.' },
  { id: 'canuridel',  name: 'Can I Ride (Legs)',  file: 'Dances/Pranusha/Can_i_ride_legs.glb',
    desc: 'Can I Ride – legs part.' },
  { id: 'drumjump',   name: 'Drum Jump',          file: 'Dances/Pranusha/drum_jump.glb',
    desc: 'Drum jump move.' },
  { id: 'brazpump',   name: 'Brazilian Pump',     file: 'Dances/Bhoomini/AIBrazillianPump.glb',
    desc: 'One arm sweeps across the body and pumps, foot stomps, hand roll in front of the chest.' },
  { id: 'fratflick',  name: 'Frat Flick',         file: 'Dances/Bhoomini/AIFratFlick.glb',
    desc: 'One arm up over the head, hand flicking forward on the beat.' },
  { id: 'nut',        name: 'Nut',                file: 'Dances/Bhoomini/AINut.glb',
    desc: 'Knee lifts, opens out to the side, then the leg extends back while the hand pushes forward.' },
  { id: 'rah',        name: 'Rah',                file: 'Dances/Bhoomini/AIRah1.glb',
    desc: 'Snaps into a side-on pose: one arm straight out, the other bent up by the ear. Held still.' },
  { id: 'scuba',      name: 'Scuba',              file: 'Dances/Bhoomini/AIScuba.glb',
    desc: 'One hand over the nose, the other arm flapping in front like a fin, knees bouncing.' },
];

const $ = (id) => document.getElementById(id);

// Simple line icons (no emojis anywhere)
const ICON = {
  plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
  music: '<svg viewBox="0 0 24 24"><path d="M9 17.5V6l10-2v11.5"/><circle cx="6.5" cy="17.5" r="2.5"/><circle cx="16.5" cy="15.5" r="2.5"/></svg>',
};

// ================= 3D STAGE =================
const stage = $('stage');
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(35, 1, 0.01, 100);
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
stage.appendChild(renderer.domElement);

scene.add(new THREE.HemisphereLight(0xffffff, 0x443355, 2.2));
const sun = new THREE.DirectionalLight(0xffffff, 2.0);
sun.position.set(2, 4, 3);
scene.add(sun);
const grid = new THREE.GridHelper(10, 20, 0x6b5a8e, 0x3a3150);
scene.add(grid);

// The dancer sits inside this so the Rotation setting can spin her
const pivot = new THREE.Group();
scene.add(pivot);

function resize() {
  const w = stage.clientWidth, h = stage.clientHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  if (scene.background?.isTexture) fitCover(scene.background);
}
window.addEventListener('resize', resize);
resize();

// ================= BACKGROUNDS =================
// Add your own picture: put it in website/backgrounds/ and add a line with image: '...'
const BACKGROUNDS = [
  { name: 'Night',          colors: ['#2a1f45', '#0f0b1a'] },
  { name: 'Vice Beach',     image: 'backgrounds/01-vice-beach-sunset.webp',   grid: false },
  { name: 'Autumn Park',    image: 'backgrounds/02-autumn-park.webp',         grid: false },
  { name: 'Copacabana',     image: 'backgrounds/03-rio-copacabana.webp',      grid: false },
  { name: 'Tokyo Neon',     image: 'backgrounds/04-tokyo-neon-night.webp',    grid: false },
  { name: 'Electric Grid',  image: 'backgrounds/05-electric-grid.webp',       grid: false },
  { name: 'Desert',         image: 'backgrounds/06-desert-midday.webp',       grid: false },
  { name: 'Tropical Beach', image: 'backgrounds/07-tropical-beach-day.webp',  grid: false },
  { name: 'Aurora',         image: 'backgrounds/08-aurora-mountains.webp',    grid: false },
  { name: 'Cherry Blossom', image: 'backgrounds/09-cherry-blossom-park.webp', grid: false },
  { name: 'Cozy Bedroom',   image: 'backgrounds/10-cozy-bedroom.webp',        grid: false },
  { name: 'Hype Stage',     image: 'backgrounds/11-hype-stage.webp',          grid: false },
  { name: 'Underwater',     image: 'backgrounds/12-underwater-reef.webp',     grid: false },
  { name: 'Mars',           image: 'backgrounds/13-mars-space.webp',          grid: false },
  { name: 'Graffiti Alley', image: 'backgrounds/14-graffiti-alley.webp',      grid: false },
  { name: 'Rainy Rooftop',  image: 'backgrounds/15-rainy-rooftop.webp',       grid: false },
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

function setSceneBackground(t) {
  const old = scene.background;
  scene.background = t;
  if (old && old.isTexture && old !== t) old.dispose();
}

let bgIndex = -1;
function setBackground(i) {
  const bg = BACKGROUNDS[i];
  bgIndex = i;
  grid.visible = bg.grid !== false;
  document.querySelectorAll('#bgPicker .bg-item').forEach((b, j) => b.classList.toggle('active', j === i));
  if (bg.image) {
    new THREE.TextureLoader().load(bg.image, (t) => {
      if (bgIndex !== i) { t.dispose(); return; }        // another background was picked meanwhile
      t.colorSpace = THREE.SRGBColorSpace;
      fitCover(t);
      setSceneBackground(t);
      applyTint(averageImageColor(t.image));
    }, undefined, () => console.warn('Could not load background', bg.image));
  } else {
    setSceneBackground(gradientTexture(bg.colors));
    applyTint(averageHex(bg.colors));
  }
}

const picker = $('bgPicker');
BACKGROUNDS.forEach((bg, i) => {
  const b = document.createElement('button');
  b.className = 'bg-item';
  const thumb = bg.image
    ? `background-image:url('${bg.image}')`
    : `background-image:linear-gradient(180deg, ${bg.colors.join(', ')})`;
  b.innerHTML = `<span class="bg-thumb" style="${thumb}"></span><span class="bg-name">${escapeHtml(bg.name)}</span>`;
  b.addEventListener('click', () => setBackground(i));
  picker.appendChild(b);
});
setBackground(0);

// ---------- glass tint: panels take on the background's colour ----------
function averageImageColor(img) {
  try {
    const c = document.createElement('canvas');
    c.width = c.height = 24;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(img, 0, 0, 24, 24);
    const d = g.getImageData(0, 0, 24, 24).data;
    let r = 0, gr = 0, b = 0;
    for (let i = 0; i < d.length; i += 4) { r += d[i]; gr += d[i + 1]; b += d[i + 2]; }
    const n = d.length / 4;
    return [r / n, gr / n, b / n];
  } catch { return null; }
}

function averageHex(colors) {
  const sum = [0, 0, 0];
  for (const hex of colors) {
    const v = parseInt(hex.slice(1), 16);
    sum[0] += (v >> 16) & 255; sum[1] += (v >> 8) & 255; sum[2] += v & 255;
  }
  return sum.map((s) => s / colors.length);
}

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l * 100];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [h * 60, s * 100, l * 100];
}

function applyTint(rgb) {
  if (!rgb) return;
  const [h0, s] = rgbToHsl(...rgb);
  const h = Math.round(h0);
  const ps = Math.round(Math.min(s, 55));              // panel saturation (kept calm)
  const as = Math.round(Math.max(55, Math.min(90, s + 30)));  // accent saturation (a bit punchier)
  const root = document.documentElement.style;
  root.setProperty('--panel',        `hsla(${h}, ${ps}%, 9%, 0.55)`);
  root.setProperty('--panel-strong', `hsla(${h}, ${ps}%, 7%, 0.78)`);
  root.setProperty('--raise',        `hsla(${h}, ${ps}%, 80%, 0.10)`);
  root.setProperty('--raise-hover',  `hsla(${h}, ${ps}%, 80%, 0.18)`);
  root.setProperty('--line',         `hsla(${h}, ${ps}%, 85%, 0.16)`);
  root.setProperty('--accent',       `hsl(${h}, ${as}%, 70%)`);
  root.setProperty('--accent-soft',  `hsla(${h}, ${as}%, 70%, 0.24)`);
}

// ================= LOAD DANCER + DANCES =================
const loader = new GLTFLoader();
const draco = new DRACOLoader();
draco.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.7/');
loader.setDRACOLoader(draco);

let mixer = null;
let rig = null;
let modelHeight = 1.7;
let movesLoaded = false;   // true once every dance file has been tried
const clips = {};          // dance id -> AnimationClip
const clock = new THREE.Clock();

// The girl on the website comes from this file - every dance plays on her.
const CHARACTER_FILE = 'Dances/Magdalene/shakastep.glb';

async function loadEverything() {
  let model = null;
  const hasBody = (g) => { let n = 0; g.scene.traverse(o => { if (o.isMesh) n++; }); return n > 0; };
  const useAsGirl = (g, file) => {
    model = g.scene;
    pivot.add(model);
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
  // Show the dancer straight away, then load the moves
  const loading = $('loading');
  if (model) loading.hidden = true;

  // Load all the dances at the same time, adding each to the grid as it arrives
  let done = 0;
  setNowPlaying(`Loading moves ${done}/${DANCES.length}`);
  renderLibrary();
  await Promise.all(DANCES.map(async (dance) => {
    try {
      const gltf = await loader.loadAsync(dance.file);
      if (!model && hasBody(gltf)) useAsGirl(gltf, dance.file);   // no body yet? borrow it from this file
      const clip = gltf.animations.find(a => a.name === dance.id) || gltf.animations[0];
      if (clip) clips[dance.id] = clip;
    } catch (err) {
      console.warn('Could not load', dance.file, err);
    }
    done++;
    setNowPlaying(`Loading moves ${done}/${DANCES.length}`);
    renderLibrary();
  }));
  movesLoaded = true;

  if (!model) console.warn('None of the .glb files have her body - export character.glb in Object Mode');
  loading.hidden = !!model;
  if (!model) loading.textContent = 'No body found – export character.glb in Object Mode.';
  await refreshRecorded();
  renderLibrary();
  await restoreState();          // put back the routine and song from last time
  renderRoutine();
  renderSettings();
  if (cursor > 0) { showPoseAt(cursor); setNowPlaying(`Paused at ${fmtTime(cursor)}`); }
  else setNowPlaying('Ready');
}

function frameModel(model) {
  let box = new THREE.Box3().setFromObject(model);
  let size = box.getSize(new THREE.Vector3());
  // if she comes in way too small or way too big, scale her to normal human height
  if (isFinite(size.y) && size.y > 0 && (size.y < 0.5 || size.y > 5)) {
    model.scale.multiplyScalar(1.7 / size.y);
    model.updateMatrixWorld(true);
    box = new THREE.Box3().setFromObject(model);
    size = box.getSize(new THREE.Vector3());
  }
  if (!isFinite(size.y) || size.y <= 0) {
    console.warn('No body found in CHARACTER_FILE - export it in Object Mode with her body selected');
    return;
  }
  const center = box.getCenter(new THREE.Vector3());
  model.position.x -= center.x;
  model.position.z -= center.z;
  model.position.y -= box.min.y;              // feet on the floor
  modelHeight = size.y;
}

// ================= CAMERA =================
// The dancer is always centred in the empty space between the panels:
// close the left panel and she glides over to the middle.
const sidePanel = $('sidePanel');
const dock = $('dock');
const trackCard = $('trackCard');
const topbar = document.querySelector('.topbar');

// Phones: the panel opens over the dancer instead of beside her
const phoneQuery = window.matchMedia('(max-width: 700px), (max-height: 520px) and (orientation: landscape)');
const isPhone = () => phoneQuery.matches;

let zoom = 1;
let exporting = false;          // while exporting, frame her in the middle of the whole video
const view = { x: 0, y: 0, dist: 0 };

function freeArea(W, H) {
  if (exporting) return { left: 0, right: W, top: 0, bottom: H };
  const p = sidePanel.getBoundingClientRect();
  const t = trackCard.getBoundingClientRect();
  const d = dock.getBoundingClientRect();
  const top = topbar.getBoundingClientRect().bottom + 8;
  let left = p.right, right = t.left;
  if (isPhone()) {                                          // only the icon strip sits beside her
    left = sidePanel.querySelector('.rail').getBoundingClientRect().right;
    right = W;
  }
  if (right - left < 160) { left = 0; right = W; }          // very small screens: just use the middle
  const bottom = Math.max(top + 150, d.top);
  return { left, right, top, bottom };
}

function updateCamera(dt) {
  const W = stage.clientWidth, H = stage.clientHeight;
  if (!W || !H) return;
  const a = freeArea(W, H);
  const fw = Math.max(1, a.right - a.left), fh = Math.max(1, a.bottom - a.top);
  const tanHalf = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  // far enough back that she fits the free space (height and width)
  const byHeight = (modelHeight * 1.18) / (2 * tanHalf * (fh / H));
  const byWidth = (modelHeight * 0.7) / (2 * tanHalf * camera.aspect * (fw / W));
  const target = {
    x: W / 2 - (a.left + a.right) / 2,
    y: H / 2 - (a.top + a.bottom) / 2,
    dist: Math.max(byHeight, byWidth) / zoom,
  };
  const k = exporting || !view.dist ? 1 : 1 - Math.exp(-dt * 8);
  view.x += (target.x - view.x) * k;
  view.y += (target.y - view.y) * k;
  view.dist += (target.dist - view.dist) * k;

  camera.setViewOffset(W, H, view.x, view.y, W, H);
  const cy = modelHeight * 0.5;
  camera.position.set(0, cy + modelHeight * 0.04, view.dist);
  camera.lookAt(0, cy, 0);
}

// Panels change size (dock grows, panel opens) -> keep the left panel above the dock
new ResizeObserver(() => {
  document.documentElement.style.setProperty('--dock-h', dock.offsetHeight + 'px');
}).observe(dock);

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.1);
  if (mixer) mixer.update(dt);
  updateCamera(dt);
  updatePin();
  renderer.render(scene, camera);
}

// ================= RECORDED MOVES + MUSIC =================
let recorded = [];   // moves recorded with camera tracking (studio.html)

async function refreshRecorded() {
  if (!rig) return;
  // Recorded moves are converted with the dancer facing forward, so undo the
  // Rotation setting just while that happens.
  const prepare = () => {
    const rot = pivot.rotation.y;
    pivot.rotation.y = 0;
    pivot.updateMatrixWorld(true);
    return () => { pivot.rotation.y = rot; pivot.updateMatrixWorld(true); };
  };
  recorded = await loadRecordedMoves(rig, clips, prepare);
  routine = routine.filter((s) => clips[s.id]);   // drop moves that were deleted
  if (selected && !routine.includes(selected)) selected = null;
}

// Coming back from camera tracking? Pick up any new moves.
window.addEventListener('focus', async () => {
  if (!movesLoaded) return;   // still loading – loadEverything will do it
  await refreshRecorded();
  renderLibrary(); renderRoutine(); renderSettings();
});

const allDances = () => [...DANCES, ...recorded];

// A step's speed after matching the dance to the song's tempo
function effectiveSpeed(step) {
  const dance = allDances().find((d) => d.id === step.id);
  return clamp(step.speed * tempoFactor(dance?.bpm), 0.25, 4);
}

// How long one step lasts, in seconds
function stepSeconds(step) {
  const clip = clips[step.id];
  return clip ? (clip.duration / effectiveSpeed(step)) * step.repeats : 0;
}

// ================= SHARE WITH export.js =================
window.tanda = {
  get routine() { return routine; },     // always the latest routine, even after the AI replaces it
  play: () => { stopAll(); return playRoutine(0); },
  seconds: () => routine.reduce((t, s) => t + stepSeconds(s), 0),
  // export.js calls this with true when recording starts and false when it ends
  setExportBackground: (on) => { exporting = !!on; },
};

// ================= PLAYING =================
// The timeline works like a video editor: a pin marks where you are in the routine.
// Play starts from the pin, dragging the pin scrubs through the dance.
let current = null;     // currently playing AnimationAction
let playToken = 0;      // bumps every time we start/stop, so old routines stop cleanly
let playState = null;   // { step, segStart, offset, start, dur } – the step playing right now
let routinePlaying = false;
let cursor = 0;         // where the pin is, in seconds from the start of the routine

// offset = where to start inside the clip, in clip seconds (used when playing from the pin)
function playClip(id, { speed = 1, repeats = 1, offset = 0 } = {}) {
  return new Promise((resolve) => {
    const clip = clips[id];
    if (!clip || !mixer) return resolve();
    const action = mixer.clipAction(clip);
    const doneReps = Math.floor(offset / clip.duration);
    action.reset();
    action.setLoop(THREE.LoopRepeat, Math.max(1, repeats - doneReps));
    action.time = Math.max(0, offset - doneReps * clip.duration);
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

// Start and length of every step, in seconds
function segments() {
  let t = 0;
  return routine.map((step) => {
    const dur = stepSeconds(step);
    const seg = { step, start: t, dur };
    t += dur;
    return seg;
  });
}
const totalSeconds = () => routine.reduce((t, s) => t + stepSeconds(s), 0);

async function playRoutine(from = 0) {
  if (!routine.length) return setNowPlaying('Add some moves first');
  const token = ++playToken;
  if (from >= totalSeconds() - 0.05) from = 0;          // pin at the end? start over
  cursor = from;
  routinePlaying = true;
  updatePlayButton();
  setNowPlaying('Starting');
  const msToFirstBeat = await startMusic(from);           // start the song (at the pin)...
  await new Promise((r) => setTimeout(r, msToFirstBeat)); // ...and wait for the beat
  let first = true;
  do {                                                    // repeat to fill the chosen music length
    const loopStart = performance.now();
    for (let i = 0; i < routine.length; i++) {
      if (token !== playToken) return;
      if (musicTimeUp()) break;                           // music's chosen time is over
      const seg = segments()[i];
      let offset = 0;                                     // seconds into this step
      if (first) {
        if (seg.start + seg.dur <= from) continue;        // before the pin: skip
        offset = Math.max(0, from - seg.start);
        first = false;
      }
      const speed = effectiveSpeed(seg.step);
      playState = { step: seg.step, segStart: seg.start, offset, start: performance.now(), dur: seg.dur };
      highlightPlaying();
      setNowPlaying(`<b>${escapeHtml(danceName(seg.step.id))}</b> &nbsp;${i + 1} of ${routine.length}`);
      await playClip(seg.step.id, { speed, repeats: seg.step.repeats, offset: offset * speed });
    }
    first = false;
    if (performance.now() - loopStart < 50) break;        // safety: nothing actually played
  } while (token === playToken && keepDancing());
  if (token === playToken) {
    playState = null;
    routinePlaying = false;
    cursor = totalSeconds();                              // pin rests at the end, like a video
    highlightPlaying();
    updatePlayButton();
    setNowPlaying('Routine finished');
    stopMusic(1.5);
  }
}

function stopAll() {
  playToken++;
  stopMusic();
  if (mixer) mixer.stopAllAction();
  current = null;
  playState = null;
  routinePlaying = false;
  highlightPlaying();
  updatePlayButton();
  setNowPlaying('Stopped');
}

// Pause = stop, but keep her frozen where the pin is
function pauseRoutine() {
  stopAll();
  showPoseAt(cursor);
  setNowPlaying(`Paused at ${fmtTime(cursor)}`);
}

// Freeze the dancer at time t of the routine (used while scrubbing)
function showPoseAt(t) {
  if (!mixer) return;
  const segs = segments();
  const seg = segs.find((s) => t < s.start + s.dur) || segs[segs.length - 1];
  if (!seg || !clips[seg.step.id]) return;
  const clip = clips[seg.step.id];
  const local = clamp(t - seg.start, 0, Math.max(0, seg.dur - 0.001)) * effectiveSpeed(seg.step);
  mixer.stopAllAction();
  const action = mixer.clipAction(clip);
  action.reset();
  action.play();
  action.paused = true;
  action.time = local % clip.duration;
  current = action;
  mixer.update(0);
}

const PLAY_ICON = '<svg viewBox="0 0 24 24" class="solid"><path d="M8 5.5v13l10.5-6.5z"/></svg>';
const PAUSE_ICON = '<svg viewBox="0 0 24 24" class="solid"><rect x="6.5" y="5.5" width="4" height="13" rx="1"/><rect x="13.5" y="5.5" width="4" height="13" rx="1"/></svg>';
function updatePlayButton() {
  const b = $('playBtn');
  b.innerHTML = routinePlaying ? PAUSE_ICON : PLAY_ICON;
  b.title = routinePlaying ? 'Pause' : 'Play from the pin';
  b.setAttribute('aria-label', b.title);
}

// ================= ROUTINE + TIMELINE =================
let routine = [];      // [{ id, speed, repeats }]
let selected = null;   // the step shown in Settings
const blockEls = new Map();   // step -> its block on the timeline
const track = $('track'), trackInner = $('trackInner'), blocksRow = $('blocks');

function addStep(id, at = routine.length) {
  const step = { id, speed: 1, repeats: 1 };
  routine.splice(at, 0, step);
  selected = step;
  renderRoutine();
  renderSettings();
  return step;
}

function selectStep(step) {
  selected = step;
  renderRoutine();
  renderSettings();
  openTab('settings');
}

function renderRoutine() {
  blocksRow.querySelectorAll('.block').forEach((b) => b.remove());
  blockEls.clear();
  routine.forEach((step, i) => {
    const dur = stepSeconds(step);
    const b = document.createElement('div');
    b.className = 'block btnlike' + (step === selected ? ' selected' : '');
    b.setAttribute('role', 'button');
    b.tabIndex = 0;
    b.style.flexGrow = Math.max(dur, 0.5);
    b.innerHTML = `
      <span class="b-name">${escapeHtml(danceName(step.id))}</span>
      <span class="b-meta">${step.repeats}x &middot; ${step.speed.toFixed(2)} speed &middot; ${dur.toFixed(1)} s</span>`;
    b.addEventListener('click', () => { if (performance.now() > suppressClickUntil) selectStep(step); });
    b.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectStep(step); } });
    b.addEventListener('pointerdown', (e) => armDrag(e, { kind: 'move', step, label: danceName(step.id), src: b }));
    blocksRow.appendChild(b);
    blockEls.set(step, b);
  });
  // make room for every block; scroll sideways if they don't fit
  trackInner.style.width = `max(100%, ${routine.length * 92 + 8}px)`;
  $('trackEmpty').hidden = routine.length > 0;
  cursor = clamp(cursor, 0, totalSeconds());
  highlightPlaying();
  updatePin();
  saveState();
}

function highlightPlaying() {
  for (const [step, el] of blockEls) el.classList.toggle('playing', !!playState && playState.step === step);
}

// ---------- time <-> position on the timeline ----------
function timeToX(t) {
  const segs = segments();
  for (const seg of segs) {
    const el = blockEls.get(seg.step);
    if (el && t < seg.start + seg.dur) return el.offsetLeft + ((t - seg.start) / (seg.dur || 1)) * el.offsetWidth;
  }
  const last = segs.length && blockEls.get(segs[segs.length - 1].step);
  return last ? last.offsetLeft + last.offsetWidth : 4;
}
function xToTime(x) {
  for (const seg of segments()) {
    const el = blockEls.get(seg.step);
    if (!el) continue;
    if (x < el.offsetLeft) return seg.start;
    if (x <= el.offsetLeft + el.offsetWidth) return seg.start + ((x - el.offsetLeft) / el.offsetWidth) * seg.dur;
  }
  return totalSeconds();
}
function fmtTime(t) {
  const m = Math.floor(t / 60), s = t - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, '0')}`;
}

// Runs every frame: move the pin (and follow it while playing)
function updatePin() {
  const pin = $('playhead');
  if (!routine.length) { pin.hidden = true; $('routineTime').textContent = '0:00.0'; return; }
  if (playState) cursor = Math.min(playState.segStart + playState.dur,
    playState.segStart + playState.offset + (performance.now() - playState.start) / 1000);
  const x = timeToX(cursor);
  pin.hidden = false;
  pin.style.transform = `translateX(${x}px)`;
  $('routineTime').textContent = `${fmtTime(cursor)} / ${fmtTime(totalSeconds())}`;
  if (routinePlaying && (x < track.scrollLeft || x > track.scrollLeft + track.clientWidth - 30)) {
    track.scrollLeft = Math.max(0, x - 40);
  }
}

// ---------- scrubbing: drag the pin or the ruler ----------
let scrubbing = false;
function scrubTo(e) {
  const x = e.clientX - trackInner.getBoundingClientRect().left;
  if (routinePlaying) stopAll();
  cursor = clamp(xToTime(x), 0, totalSeconds());
  showPoseAt(cursor);
  setNowPlaying(`Paused at ${fmtTime(cursor)}`);
  updatePin();
}
trackInner.addEventListener('pointerdown', (e) => {
  if (!routine.length || !e.target.closest('.ruler, .playhead')) return;
  scrubbing = true;
  trackInner.setPointerCapture(e.pointerId);
  scrubTo(e);
});
trackInner.addEventListener('pointermove', (e) => { if (scrubbing) scrubTo(e); });
trackInner.addEventListener('pointerup', () => { scrubbing = false; });
trackInner.addEventListener('pointercancel', () => { scrubbing = false; });

// ---------- drag and drop: moves from the grid, or blocks to reorder ----------
// Works with a mouse (press and move) and on phones (press and hold, then drag –
// a quick swipe still scrolls like normal).
const dropMarker = $('dropMarker');
let drag = null;              // the drag in progress
let suppressClickUntil = 0;   // a finished drag shouldn't also count as a click

// x = pointer position on screen -> which gap between blocks it's nearest
function dropIndex(clientX) {
  const x = clientX - trackInner.getBoundingClientRect().left;
  let i = 0;
  for (const step of routine) {
    const el = blockEls.get(step);
    if (el && x < el.offsetLeft + el.offsetWidth / 2) break;
    i++;
  }
  return i;
}
function markerX(i) {
  if (!routine.length) return 4;
  if (i < routine.length) return blockEls.get(routine[i]).offsetLeft - 3;
  const last = blockEls.get(routine[routine.length - 1]);
  return last.offsetLeft + last.offsetWidth + 1;
}

function armDrag(e, info) {
  if (e.button > 0) return;
  cancelDrag();
  drag = { ...info, pid: e.pointerId, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY,
           touch: e.pointerType !== 'mouse', active: false, timer: 0 };
  if (drag.touch) drag.timer = setTimeout(() => { if (drag && !drag.active) startDrag(); }, 280);
}

function startDrag() {
  drag.active = true;
  const g = document.createElement('div');
  g.className = 'drag-ghost';
  g.textContent = drag.label;
  document.body.appendChild(g);
  drag.ghost = g;
  if (drag.src) drag.src.classList.add('drag-src');
  document.body.classList.add('dragging');
  if (drag.touch && navigator.vibrate) navigator.vibrate(10);
  moveDrag();
}

function overTimeline() {
  const r = $('tlMain').getBoundingClientRect();
  return drag.x >= r.left - 10 && drag.x <= r.right + 10 && drag.y >= r.top - 40 && drag.y <= r.bottom + 30;
}

function moveDrag() {
  drag.ghost.style.transform = `translate(${drag.x}px, ${drag.y}px)`;
  const over = overTimeline();
  track.classList.toggle('drag-over', over);
  dropMarker.hidden = !over;
  if (!over) return;
  dropMarker.style.transform = `translateX(${markerX(dropIndex(drag.x))}px)`;
  const r = track.getBoundingClientRect();              // near an edge? scroll the timeline
  if (drag.x < r.left + 40) track.scrollLeft -= 14;
  else if (drag.x > r.right - 40) track.scrollLeft += 14;
}

function finishDrag() {
  const d = drag;
  const dropped = d.active && overTimeline();
  const at = dropped ? dropIndex(d.x) : 0;
  if (d.active) suppressClickUntil = performance.now() + 400;
  cancelDrag();
  if (!dropped) return;
  if (d.kind === 'add') {
    const step = addStep(d.id, at);
    if (!isPhone()) openTab('settings');
    stopAll();
    setNowPlaying(`Preview: <b>${escapeHtml(danceName(d.id))}</b>`);
    playClip(d.id, { speed: effectiveSpeed(step), repeats: 1 });
  } else {
    const from = routine.indexOf(d.step);
    if (from < 0) return;
    let to = at;
    routine.splice(from, 1);
    if (from < to) to--;
    routine.splice(to, 0, d.step);
    selected = d.step;
    renderRoutine();
    renderSettings();
  }
}

function cancelDrag() {
  if (!drag) return;
  clearTimeout(drag.timer);
  if (drag.ghost) drag.ghost.remove();
  if (drag.src) drag.src.classList.remove('drag-src');
  document.body.classList.remove('dragging');
  track.classList.remove('drag-over');
  dropMarker.hidden = true;
  drag = null;
}

window.addEventListener('pointermove', (e) => {
  if (!drag || e.pointerId !== drag.pid) return;
  drag.x = e.clientX; drag.y = e.clientY;
  if (!drag.active) {
    const moved = Math.hypot(drag.x - drag.x0, drag.y - drag.y0);
    if (drag.touch) { if (moved > 8) cancelDrag(); return; }   // finger moved before the hold: it's a scroll
    if (moved < 6) return;
    startDrag();
  }
  moveDrag();
});
window.addEventListener('pointerup', (e) => { if (drag && e.pointerId === drag.pid) finishDrag(); });
window.addEventListener('pointercancel', (e) => { if (drag && e.pointerId === drag.pid) cancelDrag(); });
window.addEventListener('touchmove', (e) => { if (drag && drag.active) e.preventDefault(); }, { passive: false });
window.addEventListener('contextmenu', (e) => { if (drag) e.preventDefault(); });
window.addEventListener('keydown', (e) => { if (e.key === 'Escape') cancelDrag(); });

// ================= MOVE BUTTONS =================
function renderLibrary() {
  const lib = $('library');
  lib.innerHTML = '';
  for (const d of allDances()) {
    const ok = !!clips[d.id];
    const b = document.createElement('div');
    b.className = 'tile btnlike' + (ok ? '' : ' disabled');
    b.setAttribute('role', 'button');
    b.setAttribute('aria-disabled', String(!ok));
    b.title = ok ? `Tap to add, or drag onto the timeline` : !movesLoaded ? 'Loading' : `Not exported yet (${d.file || d.id})`;
    const meta = ok ? `${clips[d.id].duration.toFixed(1)} s${d.recorded ? ' &middot; recorded' : ''}` : !movesLoaded ? 'Loading' : 'Not available';
    b.innerHTML = `
      <span class="tile-name">${escapeHtml(d.name)}</span>
      <span class="tile-meta">${meta}</span>
      <span class="tile-add">${ICON.plus}</span>`;
    if (ok) {
      b.tabIndex = 0;
      b.addEventListener('pointerdown', (e) => armDrag(e, { kind: 'add', id: d.id, label: d.name }));
      const add = () => {
        if (performance.now() < suppressClickUntil) return;   // that was a drag, not a tap
        const step = addStep(d.id);
        if (!isPhone()) openTab('settings');
        stopAll();
        setNowPlaying(`Preview: <b>${escapeHtml(d.name)}</b>`);
        playClip(d.id, { speed: effectiveSpeed(step), repeats: 1 });
      };
      b.addEventListener('click', add);
      b.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); add(); } });
    }
    lib.appendChild(b);
  }
}

// ================= SETTINGS =================
const zoomRange = $('zoomRange'), rotRange = $('rotRange');
function applyView() {
  zoom = parseFloat(zoomRange.value);
  pivot.rotation.y = THREE.MathUtils.degToRad(parseFloat(rotRange.value));
  $('zoomOut').textContent = `${Math.round(zoom * 100)}%`;
  $('rotOut').textContent = `${rotRange.value}°`;
}
zoomRange.addEventListener('input', applyView);
rotRange.addEventListener('input', applyView);
$('resetView').addEventListener('click', () => { zoomRange.value = 1; rotRange.value = 0; applyView(); });

function renderSettings() {
  const box = $('stepSettings');
  if (!selected || !routine.includes(selected)) {
    selected = null;
    box.innerHTML = '<p class="hint">Click a move on the timeline, or add one from the moves below, to change its speed and repetitions.</p>';
    return;
  }
  const step = selected;
  const i = routine.indexOf(step);
  box.innerHTML = `
    <div class="step-head">
      <span class="step-title">${escapeHtml(danceName(step.id))}</span>
      <span class="step-pos">Step ${i + 1} of ${routine.length}</span>
    </div>
    <label class="field">
      <span class="field-row"><span>Speed</span><output id="speedOut">${step.speed.toFixed(2)}x</output></span>
      <input type="range" id="speedRange" min="0.25" max="2.5" step="0.05" value="${step.speed}" />
    </label>
    <div class="field">
      <span class="field-row"><span>Repetitions</span></span>
      <div class="stepper">
        <button type="button" data-rep="-1" aria-label="Fewer repetitions">&minus;</button>
        <output id="repOut">${step.repeats}</output>
        <button type="button" data-rep="1" aria-label="More repetitions">+</button>
      </div>
    </div>
    <div class="field-row readout"><span>Duration</span><span id="durOut">${stepSeconds(step).toFixed(1)} sec</span></div>
    <div class="btn-row">
      <button type="button" id="stepPreview">Preview</button>
      <button type="button" id="stepRemove" class="danger">Remove</button>
      <button type="button" id="stepEarlier" ${i === 0 ? 'disabled' : ''}>Move earlier</button>
      <button type="button" id="stepLater" ${i === routine.length - 1 ? 'disabled' : ''}>Move later</button>
    </div>`;

  const refresh = () => {
    $('speedOut').textContent = `${step.speed.toFixed(2)}x`;
    $('repOut').textContent = step.repeats;
    $('durOut').textContent = `${stepSeconds(step).toFixed(1)} sec`;
    renderRoutine();
  };
  $('speedRange').addEventListener('input', (e) => { step.speed = parseFloat(e.target.value); refresh(); });
  box.querySelectorAll('[data-rep]').forEach((b) => b.addEventListener('click', () => {
    step.repeats = clamp(step.repeats + Number(b.dataset.rep), 1, 8);
    refresh();
  }));
  $('stepPreview').addEventListener('click', () => {
    stopAll();
    setNowPlaying(`Preview: <b>${escapeHtml(danceName(step.id))}</b>`);
    playClip(step.id, { speed: effectiveSpeed(step), repeats: step.repeats });
  });
  $('stepRemove').addEventListener('click', () => {
    const at = routine.indexOf(step);
    routine.splice(at, 1);
    selected = routine[at] || routine[at - 1] || null;
    renderRoutine(); renderSettings();
  });
  const swap = (dir) => {
    const at = routine.indexOf(step), to = at + dir;
    if (to < 0 || to >= routine.length) return;
    [routine[at], routine[to]] = [routine[to], routine[at]];
    renderRoutine(); renderSettings();
  };
  $('stepEarlier').addEventListener('click', () => swap(-1));
  $('stepLater').addEventListener('click', () => swap(1));
}

// ================= LEFT PANEL TABS =================
let currentTab = 'backgrounds';
function openTab(name) {
  currentTab = name;
  sidePanel.classList.remove('collapsed');
  updateTabs();
}
function updateTabs() {
  const open = !sidePanel.classList.contains('collapsed');
  document.querySelectorAll('.rail-btn[data-tab]').forEach((b) => b.classList.toggle('active', open && b.dataset.tab === currentTab));
  document.querySelectorAll('.pane').forEach((p) => { p.hidden = p.dataset.pane !== currentTab; });
  const close = $('closeBtn');
  close.title = open ? 'Hide panel' : 'Show panel';
  close.setAttribute('aria-label', close.title);
}
document.querySelectorAll('.rail-btn[data-tab]').forEach((b) => b.addEventListener('click', () => {
  const open = !sidePanel.classList.contains('collapsed');
  if (open && currentTab === b.dataset.tab) {
    sidePanel.classList.add('collapsed');          // click the open tab again to hide the panel
  } else {
    currentTab = b.dataset.tab;
    sidePanel.classList.remove('collapsed');
  }
  updateTabs();
}));
$('closeBtn').addEventListener('click', () => { sidePanel.classList.toggle('collapsed'); updateTabs(); });
if (isPhone()) sidePanel.classList.add('collapsed');
updateTabs();

// ================= AI CHOREOGRAPHER (chat) =================
// The AI lives in server.js (port 3000). If this page was opened some other way (e.g. Go Live), talk to that server directly.
// (Only on your own computer. On a deployed website the page and the server share one address, so no prefix is needed.)
const ON_MY_COMPUTER = ['localhost', '127.0.0.1'].includes(location.hostname);
const API_BASE = ON_MY_COMPUTER && location.port !== '3000' ? 'http://localhost:3000' : '';
const chatLog = $('chatLog');

// The AI picked a song: choose it in the song picker (music.js) and wait for it to load.
async function pickAiSong(m) {
  const sel = $('songSelect');
  if (!sel || !m || !m.title) return;
  const norm = (t) => String(t).toLowerCase().replace(/[^a-z0-9]/g, '');
  const want = norm(m.title);
  const opt = [...sel.options].find(o => o.value !== '' && norm(o.textContent).includes(want));
  if (!opt) return;
  if (sel.value !== opt.value) { sel.value = opt.value; sel.dispatchEvent(new Event('change')); }
  for (let i = 0; i < 80; i++) {            // wait up to ~8 s for the song to decode
    const cur = getCurrentSong();
    if (cur && norm(cur.meta.title || '').includes(want)) return;
    await new Promise(r => setTimeout(r, 100));
  }
}

function addMessage(kind, html) {
  const m = document.createElement('div');
  m.className = 'msg ' + kind;
  m.innerHTML = html;
  chatLog.appendChild(m);
  chatLog.scrollTop = chatLog.scrollHeight;
  return m;
}
addMessage('ai', '<p>Tell me the vibe and how long you want it, and I\'ll build the routine. I can also remix the one you have.</p>');

async function askAI() {
  const input = $('prompt');
  const btn = $('aiBtn');
  const prompt = input.value.trim();
  if (!prompt || btn.disabled) return;
  input.value = '';
  addMessage('user', `<p>${escapeHtml(prompt)}</p>`);
  const reply = addMessage('ai pending', '<p>Choreographing</p>');
  btn.disabled = true;

  const available = allDances().filter(d => clips[d.id]).map(d => ({ id: d.id, name: d.name, desc: d.desc, dur: clips[d.id].duration }));
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
      .map(s => ({ id: s.id, speed: clamp(+s.speed || 1, 0.25, 2.5), repeats: clamp(Math.round(+s.repeats || 1), 1, 8) }));
    selected = null;
    renderRoutine();
    renderSettings();
    $('routineName').textContent = data.name || '';
    reply.className = 'msg ai';
    reply.innerHTML = `
      <strong>${escapeHtml(data.name || 'Your routine')}</strong>
      <p>${escapeHtml(data.vibe || '')}</p>
      ${data.tips?.length ? `<ul>${data.tips.map(t => `<li>${escapeHtml(t)}</li>`).join('')}</ul>` : ''}`;
    if (data.music) {
      reply.innerHTML += `
        <div class="msg-song">
          ${ICON.music}
          <span><b>${escapeHtml(data.music.title || '')}</b>${data.music.artist ? ' &middot; ' + escapeHtml(data.music.artist) : ''}
          ${data.music.reason ? `<small>${escapeHtml(data.music.reason)}</small>` : ''}</span>
        </div>`;
      chatLog.scrollTop = chatLog.scrollHeight;
      await pickAiSong(data.music);   // selects the song in the song picker
    }
    stopAll();
    playRoutine(0);
  } catch (err) {
    const down = err instanceof TypeError || /pattern|Failed to fetch|Load failed|JSON/i.test(err.message);
    reply.className = 'msg ai error';
    reply.innerHTML = `<p>${down ? 'Can\'t reach the AI. In the VS Code terminal run: node server.js, then try again.' : escapeHtml(err.message)}</p>`;
  } finally {
    btn.disabled = false;
    chatLog.scrollTop = chatLog.scrollHeight;
  }
}
$('chatForm').addEventListener('submit', (e) => { e.preventDefault(); askAI(); });
$('prompt').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); askAI(); }   // Enter sends, Shift+Enter = new line
});

// ================= REMEMBER EVERYTHING BETWEEN PAGES =================
// Going to the camera-tracking page leaves this page, so the routine, song,
// pin, background and view are saved in the browser and put back on return.
const STATE_KEY = 'jinga:state';
let restored = false;    // don't save until the old state has been put back

function saveState() {
  if (!restored) return;
  const state = {
    routine: routine.map(({ id, speed, repeats }) => ({ id, speed, repeats })),
    routineName: $('routineName').textContent,
    cursor,
    bg: bgIndex,
    zoom: zoomRange.value,
    rot: rotRange.value,
    music: getMusicState(),
  };
  try { localStorage.setItem(STATE_KEY, JSON.stringify(state)); } catch {}
}

function loadSavedState() {
  try { return JSON.parse(localStorage.getItem(STATE_KEY)) || null; } catch { return null; }
}

// Background and view can go back straight away (no loading needed)
function restoreLook() {
  const s = loadSavedState();
  if (!s) return;
  if (Number.isInteger(s.bg) && BACKGROUNDS[s.bg] && s.bg !== bgIndex) setBackground(s.bg);
  if (s.zoom) zoomRange.value = s.zoom;
  if (s.rot !== undefined) rotRange.value = s.rot;
  applyView();
}

// The routine and song go back once the moves have loaded
async function restoreState() {
  const s = loadSavedState();
  if (s) {
    if (Array.isArray(s.routine)) {
      routine = s.routine
        .filter((x) => x && clips[x.id])
        .map((x) => ({ id: x.id, speed: clamp(+x.speed || 1, 0.25, 2.5), repeats: clamp(Math.round(+x.repeats || 1), 1, 8) }));
    }
    $('routineName').textContent = s.routineName || '';
    try { await restoreMusic(s.music); } catch (err) { console.warn('Could not restore song', err); }
    cursor = clamp(+s.cursor || 0, 0, totalSeconds());
  }
  restored = true;
  saveState();
}

window.addEventListener('pagehide', saveState);
document.addEventListener('visibilitychange', () => { if (document.hidden) saveState(); });

// Record your own move: open the studio on the same song, lined up with the pin
trackCard.addEventListener('click', (e) => {
  e.preventDefault();
  if (routinePlaying) pauseRoutine();
  saveState();
  const m = getMusicState();
  let url = 'studio.html';
  if (m) {
    const at = m.position ?? (m.start + cursor);     // song playing? use exactly where it is
    url += `?song=${encodeURIComponent(m.songId)}&at=${at.toFixed(2)}`;
  }
  location.href = url;
});

// ================= HELPERS + BUTTONS =================
function danceName(id) { return allDances().find(d => d.id === id)?.name || id; }
function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }
function setNowPlaying(html) { $('nowPlaying').innerHTML = html; }
function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

// Play / pause from the pin. Stop sends the pin back to the start.
$('playBtn').addEventListener('click', () => {
  if (routinePlaying) return pauseRoutine();
  const from = cursor;
  stopAll();
  playRoutine(from);
});
$('stopBtn').addEventListener('click', () => { stopAll(); cursor = 0; updatePin(); });
$('clearBtn').addEventListener('click', () => {
  stopAll();
  cursor = 0;
  routine = [];
  selected = null;
  renderRoutine();
  renderSettings();
  $('routineName').textContent = '';
});

renderRoutine();
renderSettings();
updatePlayButton();
applyView();
restoreLook();
setupSongPicker($('songSelect'), $('bpmChip'), stopAll);
animate();
loadEverything();
