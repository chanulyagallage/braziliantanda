// beat-worker.js
// Runs the tempo detection in the background so the page doesn't freeze.
import { detectBeatsFromSamples } from "./beat-detect.js";

self.onmessage = (e) => {
  const { samples, sampleRate } = e.data;
  self.postMessage(detectBeatsFromSamples([samples], sampleRate));
};
