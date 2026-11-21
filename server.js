// =====================================================================
//  server.js  –  runs the website AND the AI choreographer.
//  Start it with:   node server.js        then open  http://localhost:3000
//
//  The website's "Choreograph it" button sends the prompt to /api/choreograph.
//  This file asks Claude (Anthropic API) to pick the moves.  Your secret key stays here on
//  the server and is NEVER sent to the browser.
//  No key yet?  It still works: a simple built-in choreographer is used instead.
//  Needs Node 18 or newer. No npm install needed.
// =====================================================================
const http = require('http');
const fs = require('fs');
const path = require('path');

// ---- read .env (a file called .env next to this one, containing ANTHROPIC_API_KEY=...)
try {
  for (const line of fs.readFileSync(path.join(__dirname, '.env'), 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
} catch { /* no .env file - fine */ }

const PORT = Number(process.env.PORT) || 3000;
const API_KEY = process.env.ANTHROPIC_API_KEY || '';
const MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-5-5';
const SITE = path.join(__dirname, 'website');

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json',
  '.glb': 'model/gltf-binary', '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.blend': 'application/octet-stream' };

// The AI choreographer lives in website/api/_choreo.js, shared with the live Vercel site
const { choreograph } = require('./website/api/_choreo.js');

// ---------------------------------------------------------------- music library (website/Music/music-library.json)
// Add a song: put the .mp3 in website/Music/ and add a block to music-library.json. No restart needed.
function loadMusic() {
  try {
    const list = JSON.parse(fs.readFileSync(path.join(SITE, 'Music', 'music-library.json'), 'utf8'));
    return (Array.isArray(list) ? list : []).filter((m) => m && m.id && m.file && fs.existsSync(path.join(SITE, 'Music', path.basename(m.file))));
  } catch { return []; }
}
// ---------------------------------------------------------------- http server
const hits = new Map();
const limited = (ip) => { const now = Date.now(), a = (hits.get(ip) || []).filter((t) => now - t < 60000); a.push(now); hits.set(ip, a); return a.length > 20; };

function readBody(req, limit = 100000) {
  return new Promise((resolve, reject) => {
    let n = 0; const chunks = [];
    req.on('data', (c) => { n += c.length; if (n > limit) { reject(new Error('Request too big')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}
const send = (res, code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  // let the Go Live page (127.0.0.1:5500 / localhost:5500) call this server
  const origin = req.headers.origin || '';
  if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'content-type');
    res.setHeader('Vary', 'Origin');
  }
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
  if (url.pathname === '/api/choreograph' && req.method === 'POST') {
    try {
      if (limited(req.socket.remoteAddress)) return send(res, 429, { error: 'Slow down a little – try again in a minute.' });
      const body = JSON.parse(await readBody(req) || '{}');
      const result = await choreograph(body, loadMusic(), { apiKey: API_KEY, model: MODEL, baseUrl: process.env.ANTHROPIC_BASE_URL });
      return send(res, result.status, result.body);
    } catch (e) { return send(res, 400, { error: e.message || 'Bad request' }); }
  }
  if (url.pathname.startsWith('/api/')) return send(res, 404, { error: 'Not found' });

  // static files from website/
  let rel = decodeURIComponent(url.pathname); if (rel.endsWith('/')) rel += 'index.html';
  const file = path.join(SITE, rel);
  if (!file.startsWith(SITE + path.sep) && file !== SITE) { res.writeHead(403); return res.end('Forbidden'); }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404); return res.end('Not found'); }
    const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
    const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
    if (range && (range[1] || range[2])) {            // audio seeking (Safari needs this)
      const start = range[1] ? Number(range[1]) : Math.max(0, st.size - Number(range[2]));
      const end = Math.min(range[1] && range[2] ? Number(range[2]) : st.size - 1, st.size - 1);
      if (start > end || start >= st.size) { res.writeHead(416, { 'content-range': `bytes */${st.size}` }); return res.end(); }
      res.writeHead(206, { 'content-type': type, 'accept-ranges': 'bytes', 'content-range': `bytes ${start}-${end}/${st.size}`, 'content-length': end - start + 1, 'cache-control': 'no-cache' });
      return fs.createReadStream(file, { start, end }).pipe(res);
    }
    res.writeHead(200, { 'content-type': type, 'accept-ranges': 'bytes', 'content-length': st.size, 'cache-control': 'no-cache' });
    fs.createReadStream(file).pipe(res);
  });
}).listen(PORT, () => {
  console.log(`\n  TANDA is running ->  http://localhost:${PORT}`);
  console.log(API_KEY ? `  AI choreographer: Claude (${MODEL})\n` : '  AI choreographer: built-in quick mode (add ANTHROPIC_API_KEY to .env for the real AI)\n');
});
