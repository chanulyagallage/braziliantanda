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
const API_URL = (process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com') + '/v1/messages';
const SITE = path.join(__dirname, 'website');

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json',
  '.glb': 'model/gltf-binary', '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.blend': 'application/octet-stream' };

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];
const nearestSpeed = (v) => SPEEDS.reduce((a, b) => (Math.abs(b - v) < Math.abs(a - v) ? b : a), 1);

// ---------------------------------------------------------------- clean up whatever the AI (or the fallback) returns
function sanitize(out, dances) {
  const ids = new Set(dances.map((d) => d.id));
  const steps = (Array.isArray(out.steps) ? out.steps : [])
    .filter((s) => s && ids.has(s.id))
    .slice(0, 24)
    .map((s) => ({ id: s.id, speed: nearestSpeed(Number(s.speed) || 1), repeats: clamp(Math.round(Number(s.repeats) || 1), 1, 8) }));
  return {
    name: String(out.name || 'Your routine').slice(0, 40),
    vibe: String(out.vibe || '').slice(0, 300),
    tips: (Array.isArray(out.tips) ? out.tips : []).slice(0, 4).map((t) => String(t).slice(0, 160)),
    steps,
  };
}

// ---------------------------------------------------------------- Claude
async function askClaude(prompt, dances, current) {
  const list = dances.map((d) => `- id "${d.id}": ${d.name}. ${d.desc || ''}${d.dur ? ` (about ${d.dur.toFixed(1)} s at 1x)` : ''}`).join('\n');
  const system =
    'You are a fun, expert dance choreographer for a web app where people build routines from a fixed library of dance moves. ' +
    'You may ONLY use moves from the library, using their exact ids. A routine is an ordered list of steps; each step is a move, a speed ' +
    '(one of 0.5, 0.75, 1, 1.25, 1.5, 2; higher = faster) and a number of repeats (1-8). The total time of a step is (duration / speed) x repeats. ' +
    'Respect what the user asks for (length, mood, which move starts or ends, energy build-up). If they ask for a remix, change the current routine. ' +
    'Keep routines sensible (usually 3-10 steps). You MUST answer by calling the tool "make_routine".';
  const user = `MOVE LIBRARY:\n${list}\n\nCURRENT ROUTINE (may be empty): ${JSON.stringify(current || [])}\n\nREQUEST: ${prompt}`;
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': API_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: MODEL, max_tokens: 1024, system, messages: [{ role: 'user', content: user }],
      tools: [{
        name: 'make_routine', description: 'Return the finished dance routine.',
        input_schema: {
          type: 'object', required: ['name', 'vibe', 'steps'],
          properties: {
            name: { type: 'string', description: 'A catchy routine name, max 4 words' },
            vibe: { type: 'string', description: 'One or two sentences about how the routine feels and why you ordered it this way' },
            tips: { type: 'array', items: { type: 'string' }, description: 'Up to 3 short performance tips' },
            steps: { type: 'array', items: { type: 'object', required: ['id', 'speed', 'repeats'], properties: {
              id: { type: 'string' }, speed: { type: 'number', enum: SPEEDS }, repeats: { type: 'integer', minimum: 1, maximum: 8 } } } },
          },
        },
      }],
      tool_choice: { type: 'auto' },
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error?.message || `Claude API error ${res.status}`);
  const block = (data.content || []).find((b) => b.type === 'tool_use');
  if (block) return block.input;
  // some models answer in plain text instead - accept JSON written in the text
  const text = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
  const m = text.match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch { /* fall through */ } }
  throw new Error('Claude did not return a routine');
}

// ---------------------------------------------------------------- built-in choreographer (used when there is no API key)
function fallback(prompt, dances, current) {
  const p = prompt.toLowerCase();
  const dur = (d) => d.dur || 4;
  const find = (re) => { const m = p.match(re); if (!m) return null; const t = m[1].trim(); return dances.find((d) => t.includes(d.name.toLowerCase()) || t.includes(d.id.toLowerCase())) || null; };
  const first = find(/(?:start|begin|open)[a-z ]*?(?:with|on)\s+(?:the\s+)?([a-z0-9 ]+)/);
  const last = find(/(?:end|finish|close)[a-z ]*?(?:with|on)\s+(?:the\s+)?([a-z0-9 ]+)/);
  const mentioned = dances.filter((d) => p.includes(d.name.toLowerCase()) || p.includes(d.id.toLowerCase()));
  const target = (p.match(/(\d+)\s*(?:s\b|sec|second)/) || [])[1] ? Number(p.match(/(\d+)\s*(?:s\b|sec|second)/)[1]) : (p.match(/(\d+)\s*min/) ? Number(p.match(/(\d+)\s*min/)[1]) * 60 : 20);
  const slow = /chill|slow|calm|easy|gentle|relax|smooth/.test(p), fast = /hype|fast|crazy|energy|energetic|wild|intense|party|fire/.test(p);
  const build = /build|ramp|start .*end|chill.*(hype|crazy|fast)/.test(p) || (slow && fast);
  const others = mentioned.filter((d) => d !== first && d !== last);
  let order = others.length ? others : dances.filter((d) => d !== first && d !== last).sort(() => Math.random() - 0.5);
  if (!order.length) order = [...dances];
  if (first) order = [first, ...order];
  if (last) order = [...order, last];
  const steps = [];
  let total = 0, i = 0;
  while (total < target - 1 && steps.length < 24) {
    const pool = last && order.length > 1 ? order.filter((x) => x !== last) : order;
    const d = pool[i % pool.length];
    const prog = Math.min(1, total / Math.max(1, target));
    const speed = build ? (prog < 0.4 ? 0.75 : prog < 0.75 ? 1 : 1.5) : slow ? 0.75 : fast ? 1.5 : 1;
    const repeats = 1;
    const t = (dur(d) / speed) * repeats;
    if (steps.length && total + t > target + 4) break;
    steps.push({ id: d.id, speed, repeats }); total += t; i++;
  }
  if (last && steps.length && steps[steps.length - 1].id !== last.id) steps.push({ id: last.id, speed: build ? 1.5 : 1, repeats: 1 });
  return {
    name: (slow && !fast ? 'Chill Groove' : fast ? 'Hype Mix' : 'Tanda Mix'),
    vibe: `A ${Math.round(total)} second routine${build ? ' that starts easy and builds up' : ''}${last ? ` finishing with ${last.name}` : ''}. (Quick mode: add an Anthropic API key to .env for the full AI choreographer.)`,
    tips: ['Keep your shoulders loose.', 'Hit the first move on the beat.'],
    steps,
  };
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
      const prompt = String(body.prompt || '').trim().slice(0, 600);
      const dances = (Array.isArray(body.dances) ? body.dances : []).slice(0, 60)
        .filter((d) => d && typeof d.id === 'string')
        .map((d) => ({ id: d.id.slice(0, 60), name: String(d.name || d.id).slice(0, 60), desc: String(d.desc || '').slice(0, 240), dur: Number(d.dur) > 0 ? Number(d.dur) : 0 }));
      if (!prompt) return send(res, 400, { error: 'Type what you want first!' });
      if (!dances.length) return send(res, 400, { error: 'No dances are loaded yet, so there is nothing to choreograph.' });
      let out, via = 'claude';
      if (API_KEY) {
        try { out = await askClaude(prompt, dances, Array.isArray(body.current) ? body.current.slice(0, 40) : []); }
        catch (e) { console.warn('Claude failed, using the built-in choreographer:', e.message); out = fallback(prompt, dances, body.current); via = 'fallback'; }
      } else { out = fallback(prompt, dances, body.current); via = 'fallback'; }
      const clean = sanitize(out, dances);
      if (!clean.steps.length) return send(res, 502, { error: 'The AI did not come up with any moves. Try rewording.' });
      return send(res, 200, { ...clean, via });
    } catch (e) { return send(res, 400, { error: e.message || 'Bad request' }); }
  }
  if (url.pathname.startsWith('/api/')) return send(res, 404, { error: 'Not found' });

  // static files from website/
  let rel = decodeURIComponent(url.pathname); if (rel.endsWith('/')) rel += 'index.html';
  const file = path.join(SITE, rel);
  if (!file.startsWith(SITE + path.sep) && file !== SITE) { res.writeHead(403); return res.end('Forbidden'); }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'cache-control': 'no-cache' });
    res.end(buf);
  });
}).listen(PORT, () => {
  console.log(`\n  TANDA is running ->  http://localhost:${PORT}`);
  console.log(API_KEY ? `  AI choreographer: Claude (${MODEL})\n` : '  AI choreographer: built-in quick mode (add ANTHROPIC_API_KEY to .env for the real AI)\n');
});
