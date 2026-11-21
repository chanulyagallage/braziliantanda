// =====================================================================
//  api/choreograph.js  –  the AI choreographer on the live (Vercel) site.
//  Vercel turns this file into the web address  /api/choreograph
//
//  Your Anthropic key is NOT in this file. Add it on vercel.com:
//    Project → Settings → Environment Variables → ANTHROPIC_API_KEY
//  (Without a key it still works, using the simple built-in choreographer.)
// =====================================================================
const { choreograph } = require('./_choreo.js');

// Simple protection against someone spamming the AI (per server instance)
const hits = new Map();
const limited = (ip) => {
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter((t) => now - t < 60000);
  recent.push(now);
  hits.set(ip, recent);
  return recent.length > 20;
};

// The music library is a normal file on the site, so fetch it from there
async function loadMusic(req) {
  const proto = req.headers['x-forwarded-proto'] || 'https';
  for (const file of ['Music/music-library.json', 'Music/songs.json']) {
    try {
      const res = await fetch(`${proto}://${req.headers.host}/${file}`);
      if (res.ok) {
        const list = await res.json();
        if (Array.isArray(list) && list.length) return list;
      }
    } catch { /* try the next one */ }
  }
  return [];
}

async function readJson(req) {
  if (req.body && typeof req.body === 'object') return req.body;          // Vercel already read it
  if (typeof req.body === 'string') return JSON.parse(req.body || '{}');
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 100000) throw new Error('Request too big');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

function send(res, status, obj) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify(obj));
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return send(res, 405, { error: 'Use POST' });
  try {
    const ip = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').split(',')[0].trim();
    if (limited(ip)) return send(res, 429, { error: 'Slow down a little – try again in a minute.' });

    const body = await readJson(req);
    const music = await loadMusic(req);
    const result = await choreograph(body, music, {
      apiKey: process.env.ANTHROPIC_API_KEY,
      model: process.env.CLAUDE_MODEL,
      baseUrl: process.env.ANTHROPIC_BASE_URL,
    });
    return send(res, result.status, result.body);
  } catch (e) {
    return send(res, 400, { error: e.message || 'Bad request' });
  }
};
