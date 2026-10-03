import type { Point } from "./raylighting";

// Every sound is synthesised as it plays, from noise and oscillators shaped
// by filters and envelopes: there are no samples. All of it goes through a
// master volume and a limiter, so sounds piling up don't clip.
const ctx = new AudioContext();
const master = ctx.createGain();
const limiter = ctx.createDynamicsCompressor();
limiter.threshold.value = -8;
limiter.ratio.value = 6;
master.connect(limiter).connect(ctx.destination);

export function setVolume(volume: number): void {
  master.gain.value = volume;
}

// Browsers keep sound off until the page is interacted with, so it's turned
// on when the game is started. It's suspended while the game is paused or the
// tab hidden, which stops the audio clock, so sounds carry on where they were.
let unlocked = false;
let paused = true;
let running = false;
void ctx.suspend();

function updateRunning(): void {
  const run = unlocked && !paused && !document.hidden;
  if (run === running) return;
  running = run;
  void (run ? ctx.resume() : ctx.suspend());
}
document.addEventListener("visibilitychange", updateRunning);

/** Turns sound on. Call it from a key press or tap, as browsers only allow it then. */
export function unlockAudio(): void {
  unlocked = true;
  running = true;
  void ctx.resume();
  updateRunning(); // suspends it again if the game is paused
}

export function setAudioPaused(isPaused: boolean): void {
  paused = isPaused;
  updateRunning();
}

// Sounds are placed relative to the listener: quieter and duller with
// distance, as air takes the highs; panned by how far left or right they
// are; and muffled when there's a wall in between.
let listener: Point = [0, 0];
let isBlocked: (from: Point, to: Point) => boolean = () => false;

/** Hears sounds from `position`, where `blocked` tells whether a wall stands between two points. */
export function hearFrom(position: Point, blocked: (from: Point, to: Point) => boolean): void {
  listener = position;
  isBlocked = blocked;
}

interface Place {
  gain: GainNode; // feed the sound in here
  muffle: BiquadFilterNode;
  pan: StereoPannerNode;
}

function place(at: Point, dest: AudioNode = master): Place {
  const p = { gain: ctx.createGain(), muffle: ctx.createBiquadFilter(), pan: ctx.createStereoPanner() };
  p.gain.connect(p.muffle).connect(p.pan).connect(dest);
  moveTo(p, at, 0);
  return p;
}

/** Places the sound at `at` as heard from the listener, gliding there over about `smoothing` seconds. */
function moveTo({ gain, muffle, pan }: Place, at: Point, smoothing = 0.05): void {
  const [dx, dy] = [at[0] - listener[0], at[1] - listener[1]];
  const distance = Math.hypot(dx, dy);
  const blocked = isBlocked(listener, at);
  const air = 18000 * 0.25 ** (distance / 1000);
  setParam(gain.gain, (200 / (200 + distance)) * (blocked ? 0.6 : 1), smoothing);
  setParam(muffle.frequency, blocked ? Math.min(air, 700) : air, smoothing);
  setParam(pan.pan, Math.max(-1, Math.min(1, dx / 1000)), smoothing);
}

function setParam(param: AudioParam, value: number, smoothing: number): void {
  if (smoothing === 0) param.setValueAtTime(value, ctx.currentTime);
  else param.setTargetAtTime(value, ctx.currentTime, smoothing);
}

// Building blocks. Each takes the node to feed, so a chain reads from the
// source outwards: noise(t, d, filter(..., hit(..., out))).

const NOISE = (() => {
  const buffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return buffer;
})();

const rand = (a: number, b: number) => a + Math.random() * (b - a);
const semis = (n: number) => 2 ** (n / 12);

/** White noise from t, for `duration` seconds or until stopped; each starts somewhere different in the buffer. */
function noise(t: number, duration: number | null, dest: AudioNode): AudioBufferSourceNode {
  const s = ctx.createBufferSource();
  s.buffer = NOISE;
  s.loop = true;
  s.connect(dest);
  s.start(t, rand(0, 2));
  if (duration !== null) s.stop(t + duration);
  return s;
}

function osc(type: OscillatorType, freq: number, t: number, duration: number | null, dest: AudioNode): OscillatorNode {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  o.connect(dest);
  o.start(t);
  if (duration !== null) o.stop(t + duration);
  return o;
}

function gain(value: number, dest?: AudioNode): GainNode {
  const g = ctx.createGain();
  g.gain.value = value;
  if (dest) g.connect(dest);
  return g;
}

function filter(type: BiquadFilterType, freq: number, q: number, dest: AudioNode): BiquadFilterNode {
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  f.connect(dest);
  return f;
}

/** A percussive envelope: a quick rise to `peak`, then an exponential decay. */
function hit(t: number, peak: number, decay: number, dest: AudioNode, attack = 0.002): GainNode {
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(Math.max(peak, 1e-4), t + attack); // an exponential ramp can't start from 0
  g.gain.exponentialRampToValueAtTime(1e-4, t + attack + decay);
  g.connect(dest);
  return g;
}

// The sounds.

/** A two-note chime, pitched up a semitone for each coin in a quick run, `run` counting from 0. */
export function playCoin(at: Point, run: number): void {
  const out = place(at).gain;
  const t = ctx.currentTime;
  const f = 988 * semis(run);
  const gap = 0.07; // seconds between the notes
  const notes = [[f, 0, gap * 1.3], [f * semis(5), gap, 0.45]]; // frequency, start, decay
  for (const [freq, start, decay] of notes) {
    const env = hit(t + start, 0.45, decay, out);
    for (const [ratio, amp] of [[1, 1], [2, 0.3], [3, 0.045]]) osc("sine", freq * ratio, t + start, decay + 0.05, gain(amp, env));
  }
}

/** A whoosh: noise through a band sweeping up quickly and back down. */
export function playThrow(at: Point): void {
  const t = ctx.currentTime;
  const duration = 0.28;
  const env = gain(0, place(at).gain);
  const band = filter("bandpass", 400, 1.5, env);
  band.frequency.setValueAtTime(400, t);
  band.frequency.exponentialRampToValueAtTime(2200, t + duration * 0.35);
  band.frequency.exponentialRampToValueAtTime(280, t + duration);
  env.gain.setValueAtTime(0, t);
  env.gain.linearRampToValueAtTime(0.9, t + duration * 0.35);
  env.gain.linearRampToValueAtTime(0, t + duration);
  noise(t, duration + 0.05, band);
}

/** A flare hitting the floor or a wall: a thump and a click, both louder and the click longer the harder the `impact`, from 0 to 1. */
export function playBounce(at: Point, impact: number, wall: boolean): void {
  const out = place(at).gain;
  const t = ctx.currentTime;
  const f = wall ? 252 : 180;
  const thump = osc("sine", f, t, 0.13, hit(t, 0.7 * impact, 0.08, out));
  thump.frequency.exponentialRampToValueAtTime(f / 2, t + 0.08);
  const click = hit(t, 0.35 * impact * (wall ? 2 : 1.3), 0.012 + 0.02 * impact, out, 0.0005);
  noise(t, 0.06, filter("bandpass", 3000 * rand(0.8, 1.2), 1.5, click));
}

/** A wooden thud and the flares inside rattling. */
export function playCratePickup(at: Point): void {
  const out = place(at).gain;
  const t = ctx.currentTime;
  const thud = osc("sine", 90, t, 0.25, hit(t, 0.36, 0.15, out));
  thud.frequency.exponentialRampToValueAtTime(54, t + 0.15);
  noise(t, 0.15, filter("lowpass", 400, 0.7, hit(t, 0.25, 0.07, out)));
  for (let i = 0; i < 5; i++) {
    const ti = t + 0.02 + rand(0, 0.12);
    const f = 1400 * rand(0.75, 1.3);
    const level = 0.6 * rand(0.4, 1);
    noise(ti, 0.1, filter("bandpass", f, 10, hit(ti, level * 4, 0.05, out, 0.0005)));
    osc("triangle", f, ti, 0.1, hit(ti, level * 0.12, 0.05, out, 0.0005));
  }
}

/** The player bursting into `shards` hot shards that skid to a halt and cool. */
export function playShatter(at: Point, shards: number): void {
  const out = place(at).gain;
  const t = ctx.currentTime;
  const cool = 1.2; // seconds the sizzle and the skids last
  const tone = 4000; // Hz
  // A whump like a gas flame catching: noise whose filter closes fast, over a falling sine.
  const whump = filter("lowpass", 2500, 1, hit(t, 0.735, 0.35, out, 0.01));
  whump.frequency.setValueAtTime(2500, t);
  whump.frequency.exponentialRampToValueAtTime(120, t + 0.3);
  noise(t, 0.5, whump);
  const body = osc("sine", 90, t, 0.5, hit(t, 0.49, 0.35, out, 0.005));
  body.frequency.exponentialRampToValueAtTime(40, t + 0.35);
  // A sizzle that darkens and dies away as the shards cool.
  const sizzle = filter("bandpass", tone, 0.8, hit(t, 0.35, cool, out, 0.02));
  sizzle.frequency.setValueAtTime(tone, t);
  sizzle.frequency.exponentialRampToValueAtTime(tone * 0.2, t + cool);
  noise(t, cool + 0.1, sizzle);
  // Each shard scraping to a halt, with a couple of ticks fading as it slows.
  const k = 0.7 / Math.sqrt(Math.max(shards, 1)); // about as loud however many there are
  for (let i = 0; i < shards; i++) {
    const ti = t + rand(0, 0.04);
    const duration = cool * rand(0.4, 1);
    noise(ti, duration + 0.05, filter("bandpass", tone * rand(0.3, 0.7), 3, hit(ti, k * rand(0.5, 1), duration, out, 0.003)));
    for (let j = 0; j < 2; j++) {
      const tick = duration * Math.random() ** 1.5;
      noise(ti + tick, 0.03, filter("bandpass", rand(2000, 6000), 2, hit(ti + tick, k * 1.5 * (1 - tick / duration), 0.006, out, 0.0005)));
    }
  }
}

/** The dead player's torch sputtering out over `duration` seconds: a hiss that flickers, drops out and dulls, with fading pops. */
export function playTorchOut(at: Point, duration: number): void {
  const out = place(at).gain;
  const t = ctx.currentTime;
  const volume = 0.5;
  const flicker = 14; // per second
  const tone = 1800; // Hz
  const bus = gain(0, out);
  const band = filter("bandpass", tone, 0.9, bus);
  band.frequency.setValueAtTime(tone, t);
  band.frequency.exponentialRampToValueAtTime(tone * 0.35, t + duration);
  noise(t, duration + 0.2, band);
  noise(t, duration + 0.2, filter("lowpass", 300, 0.7, gain(1.5, bus)));
  const steps = Math.round(duration * flicker);
  for (let i = 0; i < steps; i++) {
    const done = i / steps;
    const left = (1 - done) ** 1.5;
    const dropped = Math.random() < 0.35 * (0.5 + done); // more often as it dies
    bus.gain.setTargetAtTime(volume * left * (dropped ? 0.03 : rand(0.5, 1)), t + i / flicker, 0.012);
  }
  bus.gain.setTargetAtTime(0, t + duration, 0.02);
  const pops = Math.round(0.5 * duration * 15);
  for (let i = 0; i < pops; i++) {
    const at = duration * Math.random() ** 1.3;
    const env = hit(t + at, 0.25 * (1 - at / duration) * rand(0.5, 2), rand(0.004, 0.015), out, 0.0005);
    noise(t + at, 0.04, filter("bandpass", rand(1500, 5000), 2, env));
  }
  noise(t + duration, 0.3, filter("lowpass", 800, 0.7, hit(t + duration, 0.2, 0.15, out, 0.02))); // a last puff
}

/** A warm chord swelling up over `swell` seconds as its filter opens, with a sparkle of bells on top. */
export function playLevelCleared(swell: number): void {
  const t = ctx.currentTime;
  const volume = 0.4;
  const root = 130.8; // C3
  const hold = 1.5;
  const end = t + swell + hold + 2.5;
  const bus = gain(0, master);
  bus.gain.setValueAtTime(0, t);
  bus.gain.linearRampToValueAtTime(volume, t + swell);
  bus.gain.setValueAtTime(volume, t + swell + hold);
  bus.gain.linearRampToValueAtTime(0, end);
  const lowpass = filter("lowpass", 200, 0.7, bus);
  lowpass.frequency.setValueAtTime(200, t);
  lowpass.frequency.exponentialRampToValueAtTime(2500, t + swell);
  for (const n of [0, 7, 12, 16, 19]) {
    for (const detune of [-10, 10]) osc("sawtooth", root * semis(n), t, end - t, gain(0.12, lowpass)).detune.value = detune;
  }
  [24, 28, 31, 36, 40, 43].forEach((n, i) => {
    const ti = t + swell * 0.6 + i * 0.12;
    const f = root * semis(n);
    const env = hit(ti, volume / 4, 1.2, master);
    osc("sine", f, ti, 1.3, env);
    osc("sine", f * 2, ti, 1.3, gain(0.15, env));
  });
}
