// beat-detect.js
// Works out a song's tempo (BPM) and where its beats fall.
//
// Usage:
//   import { detectBeats } from "./beat-detect.js";
//   const { bpm, firstBeat } = detectBeats(audioBuffer);
//
// bpm        – beats per minute, e.g. 124
// firstBeat  – time in seconds of the first beat; every other beat is at
//              firstBeat + n * (60 / bpm)

const HOP_SECONDS = 0.01; // analyse the song in 10 ms slices
const MIN_BPM = 70;
const MAX_BPM = 180;

export function detectBeats(audioBuffer) {
  const channels = [];
  for (let c = 0; c < audioBuffer.numberOfChannels; c++) {
    channels.push(audioBuffer.getChannelData(c));
  }
  return detectBeatsFromSamples(channels, audioBuffer.sampleRate);
}

// Same as detectBeats, but takes raw sample arrays (handy for testing)
export function detectBeatsFromSamples(channels, sampleRate) {
  const onset = onsetStrength(channels, sampleRate);
  const hop = HOP_SECONDS;

  // 1. Rough tempo from autocorrelation (how well the song lines up with itself
  //    when shifted by one beat), nudged towards common dance tempos.
  const roughBpm = roughTempo(onset, hop);

  // 2. Fine-tune: try tempos close to the rough guess and keep the one whose
  //    beat grid lands on the most drum hits across the whole song.
  let best = { bpm: roughBpm, phase: 0, score: -Infinity };
  for (let bpm = roughBpm * 0.97; bpm <= roughBpm * 1.03; bpm += 0.05) {
    const r = bestPhase(onset, hop, bpm, 1);
    if (r.score > best.score) best = { bpm, phase: r.phase, score: r.score };
  }

  // Most produced songs use a whole-number BPM, so snap if we're very close
  let bpm = best.bpm;
  if (Math.abs(bpm - Math.round(bpm)) < 0.15) bpm = Math.round(bpm);
  bpm = Math.round(bpm * 100) / 100;

  // 3. With the final tempo, find exactly where the beats fall
  const { phase } = bestPhase(onset, hop, bpm, 0.25);
  const firstBeat = Math.round(phase * hop * 1000) / 1000;

  return { bpm, firstBeat };
}

// ----- Step 0: turn the audio into an "onset" curve that spikes on drum hits -----
function onsetStrength(channels, sampleRate) {
  const hopSize = Math.round(sampleRate * HOP_SECONDS);
  const length = channels[0].length;
  const frames = Math.floor(length / hopSize);

  // A simple low-pass filter separates the bass/kick from everything else
  const a = Math.exp((-2 * Math.PI * 150) / sampleRate);
  let low = 0;

  const lowEnergy = new Float32Array(frames);
  const highEnergy = new Float32Array(frames);

  for (let f = 0; f < frames; f++) {
    let le = 0;
    let he = 0;
    const start = f * hopSize;
    for (let i = start; i < start + hopSize; i++) {
      let x = 0;
      for (let c = 0; c < channels.length; c++) x += channels[c][i];
      x /= channels.length;
      low += (1 - a) * (x - low);
      const high = x - low;
      le += low * low;
      he += high * high;
    }
    lowEnergy[f] = le;
    highEnergy[f] = he;
  }

  const lowLog = compress(lowEnergy);
  const highLog = compress(highEnergy);

  // Onset = how much louder this slice is than the one before (only increases count)
  const raw = new Float32Array(frames);
  for (let f = 1; f < frames; f++) {
    raw[f] =
      Math.max(0, lowLog[f] - lowLog[f - 1]) +
      Math.max(0, highLog[f] - highLog[f - 1]);
  }

  // Remove the slowly-changing background so only sharp hits remain
  const win = Math.round(0.4 / HOP_SECONDS);
  const out = new Float32Array(frames);
  let sum = 0;
  for (let f = 0; f < frames; f++) {
    sum += raw[f];
    if (f >= win) sum -= raw[f - win];
    const mean = sum / Math.min(f + 1, win);
    out[f] = Math.max(0, raw[f] - mean);
  }
  return out;
}

function compress(energy) {
  let mean = 0;
  for (const e of energy) mean += e;
  mean = mean / energy.length || 1e-12;
  const out = new Float32Array(energy.length);
  for (let i = 0; i < energy.length; i++) out[i] = Math.log(1 + (energy[i] / mean) * 10);
  return out;
}

// ----- Step 1: rough tempo -----
function roughTempo(onset, hop) {
  const minLag = Math.floor(60 / MAX_BPM / hop);
  const maxLag = Math.ceil(60 / MIN_BPM / hop);
  const n = onset.length;

  let bestLag = minLag;
  let bestScore = -Infinity;
  const scores = [];

  for (let lag = minLag; lag <= maxLag; lag++) {
    let s = 0;
    for (let i = 0; i + lag < n; i++) s += onset[i] * onset[i + lag];
    s /= n - lag;

    // Prefer tempos near 120 BPM when a song could be read as half or double time
    const bpm = 60 / (lag * hop);
    const weight = Math.exp(-0.5 * Math.pow(Math.log2(bpm / 120) / 0.7, 2));
    const weighted = s * weight;
    scores[lag] = weighted;

    if (weighted > bestScore) {
      bestScore = weighted;
      bestLag = lag;
    }
  }

  // Polish the peak position between whole slices
  let lag = bestLag;
  const l = scores[bestLag - 1];
  const r = scores[bestLag + 1];
  if (l !== undefined && r !== undefined) {
    const denom = l - 2 * bestScore + r;
    if (denom !== 0) lag = bestLag + (0.5 * (l - r)) / denom;
  }
  return 60 / (lag * hop);
}

// ----- Step 2/3: for a given tempo, find where the beat grid fits best -----
function bestPhase(onset, hop, bpm, step) {
  const period = 60 / bpm / hop; // beat length in slices
  const n = onset.length;
  let best = { phase: 0, score: -Infinity };

  for (let phase = 0; phase < period; phase += step) {
    // Hits on the beat count fully; hits exactly halfway between beats
    // (hi-hats, off-beat claps) count a little. This stops the grid locking
    // onto syncopated bass notes that sit between the real beats.
    const s = gridSum(onset, phase, period) + 0.5 * gridSum(onset, phase + period / 2, period);
    if (s > best.score) best = { phase, score: s };
  }
  return best;
}

function gridSum(onset, start, period) {
  const n = onset.length;
  let s = 0;
  for (let pos = start; pos < n - 1; pos += period) {
    const i = Math.floor(pos);
    const frac = pos - i;
    s += onset[i] * (1 - frac) + onset[i + 1] * frac;
  }
  return s;
}
