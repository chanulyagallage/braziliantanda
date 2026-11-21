// =====================================================================
//  ai-music.js  –  plays the song the AI choreographer picked, together with the routine.
//  The song list lives in  website/Music/music-library.json  (add a song there + drop the .mp3 in website/Music/).
// =====================================================================
const SILENT = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=';
let audio = null, song = null, muted = false, unlocked = false, fadeTimer = null;

const el = () => audio || (audio = Object.assign(new Audio(), { loop: true, preload: 'auto' }));

/** Call this inside the button click, BEFORE waiting for the AI. Browsers only allow sound after a click. */
export function unlockMusic() {
  if (unlocked) return;
  const a = el();
  a.src = SILENT;
  a.play().then(() => { a.pause(); unlocked = true; }).catch(() => {});
}

export function setSong(m) { song = m && m.file ? m : null; }
export function clearSong() { stopMusic(); song = null; }

export function startMusic() {
  if (!song) return;
  const a = el();
  clearInterval(fadeTimer);
  a.pause();
  a.src = encodeURI(song.file);
  a.currentTime = 0;
  a.volume = 0.9;
  a.muted = muted;
  a.play().catch((e) => console.warn('Music could not start:', e.message));
}

export function stopMusic(fade = false) {
  if (!audio || !audio.src || audio.paused) return;
  clearInterval(fadeTimer);
  if (!fade) { audio.pause(); return; }
  fadeTimer = setInterval(() => {                 // gentle fade-out at the end of the routine
    audio.volume = Math.max(0, audio.volume - 0.1);
    if (audio.volume <= 0.01) { clearInterval(fadeTimer); audio.pause(); audio.volume = 0.9; }
  }, 100);
}

/** shows "Music: Gasolina – Daddy Yankee" with a mute button inside the AI box */
export function renderSong(container) {
  if (!song) return;
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const box = document.createElement('div');
  box.className = 'ai-music';
  box.style.cssText = 'margin-top:12px;padding:10px 12px;border-radius:10px;background:rgba(25,240,214,.12);border:1px solid #19f0d6';
  box.innerHTML = `<div style="font-weight:700">🎵 ${esc(song.title)}${song.artist ? ' – ' + esc(song.artist) : ''}</div>` +
    (song.reason ? `<div style="font-size:.9rem;opacity:.85;margin-top:4px">${esc(song.reason)}</div>` : '') +
    `<button type="button" class="small" style="margin-top:8px">${muted ? '🔇 Music off' : '🔊 Music on'}</button>`;
  const btn = box.querySelector('button');
  btn.onclick = () => {
    muted = !muted;
    if (audio) audio.muted = muted;
    btn.textContent = muted ? '🔇 Music off' : '🔊 Music on';
  };
  container.appendChild(box);
}
