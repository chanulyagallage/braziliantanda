// =====================================================================
//  api/_choreo.js  –  the AI choreographer itself.
//  Shared by:
//    • api/choreograph.js  (runs on Vercel when the site is live)
//    • server.js           (runs on your computer with `node server.js`)
//  The "_" at the start of the name stops Vercel turning this file into its own web address.
// =====================================================================

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];
const nearestSpeed = (v) => SPEEDS.reduce((a, b) => (Math.abs(b - v) < Math.abs(a - v) ? b : a), 1);
const baseName = (f) => String(f).split(/[\\/]/).pop();

const musicLine = (m) => `- id "${m.id}": ${m.title}${m.artist ? ' by ' + m.artist : ''}. ${m.bpm ? m.bpm + ' BPM. ' : ''}Energy: ${m.energy || '?'}. ${m.vibe || ''}`;

/** simple song picker used when Claude is not available */
function pickSongFallback(prompt, steps, music) {
  if (!music.length) return null;
  const p = prompt.toLowerCase();
  const byBpm = [...music].sort((a, b) => (a.bpm || 110) - (b.bpm || 110));
  const has = (re) => re.test(p);
  const avgSpeed = steps.length ? steps.reduce((t, x) => t + x.speed, 0) / steps.length : 1;
  let song;
  if (has(/chill|slow|calm|relax|smooth|gentle|easy|sunset|soft/)) song = byBpm[0];
  else if (has(/funk|disco|groov|retro|70s|80s|feel.?good/)) song = music.find((m) => /funk|disco/i.test((m.genre || '') + (m.vibe || ''))) || byBpm[Math.floor(byBpm.length / 2)];
  else if (has(/hip.?hop|rap|swagger|confident|boss|work/)) song = music.find((m) => /hip/i.test(m.genre || '')) || byBpm[byBpm.length - 1];
  else if (has(/latin|reggaeton|brazil|samba|spicy|summer|beach/)) song = music.find((m) => /latin/i.test(m.vibe || '')) || music.find((m) => /reggaeton/i.test(m.genre || '')) || byBpm[Math.floor(byBpm.length / 2)];
  else if (has(/hype|fast|crazy|wild|party|energy|energetic|intense|fire|k.?pop|fun/) || avgSpeed > 1.2) song = byBpm[byBpm.length - 1];
  else song = byBpm[Math.floor(byBpm.length / 2)];
  return { id: song.id, reason: `Matches the energy of your routine (${song.bpm ? song.bpm + ' BPM' : song.title}).` };
}

// ---------------------------------------------------------------- clean up whatever the AI (or the fallback) returns
function sanitize(out, dances, music = []) {
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
    music: (() => {
      const m = music.find((x) => x.id === out.song_id);
      return m ? { id: m.id, title: m.title, artist: m.artist || '', file: 'Music/' + baseName(m.file), reason: String(out.song_reason || '').slice(0, 200) } : null;
    })(),
  };
}

// ---------------------------------------------------------------- Claude
async function askClaude({ prompt, dances, current, music, apiKey, model, apiUrl }) {
  const list = dances.map((d) => `- id "${d.id}": ${d.name}. ${d.desc || ''}${d.dur ? ` (about ${d.dur.toFixed(1)} s at 1x)` : ''}`).join('\n');
  const system =
    'You are a fun, expert dance choreographer for a web app where people build routines from a fixed library of dance moves. ' +
    'You may ONLY use moves from the library, using their exact ids. A routine is an ordered list of steps; each step is a move, a speed ' +
    '(one of 0.5, 0.75, 1, 1.25, 1.5, 2; higher = faster) and a number of repeats (1-8). The total time of a step is (duration / speed) x repeats. ' +
    'Respect what the user asks for (length, mood, which move starts or ends, energy build-up). If they ask for a remix, change the current routine. ' +
    'Keep routines sensible (usually 3-10 steps). ' +
    'Also choose the ONE best song from the MUSIC LIBRARY for the routine: match its tempo and energy to the mood the user asked for and to the speeds you chose, and give a one-sentence reason. ' +
    'You MUST answer by calling the tool "make_routine".';
  const user = `MOVE LIBRARY:\n${list}\n\nMUSIC LIBRARY:\n${music.map(musicLine).join('\n') || '(none)'}\n\nCURRENT ROUTINE (may be empty): ${JSON.stringify(current || [])}\n\nREQUEST: ${prompt}`;
  const res = await fetch(apiUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model, max_tokens: 1024, system, messages: [{ role: 'user', content: user }],
      tools: [{
        name: 'make_routine', description: 'Return the finished dance routine.',
        input_schema: {
          type: 'object', required: ['name', 'vibe', 'steps'].concat(music.length ? ['song_id'] : []),
          properties: {
            name: { type: 'string', description: 'A catchy routine name, max 4 words' },
            vibe: { type: 'string', description: 'One or two sentences about how the routine feels and why you ordered it this way' },
            tips: { type: 'array', items: { type: 'string' }, description: 'Up to 3 short performance tips' },
            ...(music.length ? { song_id: { type: 'string', enum: music.map((m) => m.id), description: 'id of the best song from the MUSIC LIBRARY' },
              song_reason: { type: 'string', description: 'One short sentence on why this song fits' } } : {}),
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
    vibe: `A ${Math.round(total)} second routine${build ? ' that starts easy and builds up' : ''}${last ? ` finishing with ${last.name}` : ''}. (Quick mode: add an Anthropic API key for the full AI choreographer.)`,
    tips: ['Keep your shoulders loose.', 'Hit the first move on the beat.'],
    steps,
  };
}

// ---------------------------------------------------------------- the whole request
// body  = what the browser sent: { prompt, dances, current }
// music = the music library list
// Returns { status, body } for the caller to send back.
async function choreograph(body, music, options = {}) {
  const apiKey = options.apiKey || '';
  const model = options.model || 'claude-sonnet-5-5';
  const apiUrl = (options.baseUrl || 'https://api.anthropic.com') + '/v1/messages';

  const prompt = String(body.prompt || '').trim().slice(0, 600);
  const dances = (Array.isArray(body.dances) ? body.dances : []).slice(0, 60)
    .filter((d) => d && typeof d.id === 'string')
    .map((d) => ({ id: d.id.slice(0, 60), name: String(d.name || d.id).slice(0, 60), desc: String(d.desc || '').slice(0, 240), dur: Number(d.dur) > 0 ? Number(d.dur) : 0 }));
  const current = Array.isArray(body.current) ? body.current.slice(0, 40) : [];
  music = (Array.isArray(music) ? music : []).filter((m) => m && m.id && m.file);

  if (!prompt) return { status: 400, body: { error: 'Type what you want first!' } };
  if (!dances.length) return { status: 400, body: { error: 'No dances are loaded yet, so there is nothing to choreograph.' } };

  let out, via = 'claude';
  if (apiKey) {
    try { out = await askClaude({ prompt, dances, current, music, apiKey, model, apiUrl }); }
    catch (e) { console.warn('Claude failed, using the built-in choreographer:', e.message); out = fallback(prompt, dances, current); via = 'fallback'; }
  } else { out = fallback(prompt, dances, current); via = 'fallback'; }

  const clean = sanitize(out, dances, music);
  if (!clean.music && music.length) {              // Claude gave no (valid) song, or quick mode: pick one by simple rules
    const pick = pickSongFallback(prompt, clean.steps, music);
    if (pick) clean.music = sanitize({ steps: [], song_id: pick.id, song_reason: pick.reason }, dances, music).music;
  }
  if (!clean.steps.length) return { status: 502, body: { error: 'The AI did not come up with any moves. Try rewording.' } };
  return { status: 200, body: { ...clean, via } };
}

module.exports = { choreograph };
