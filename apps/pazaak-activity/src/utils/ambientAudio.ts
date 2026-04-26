/**
 * Synthesized KOTOR-flavoured ambient table music using Web Audio API.
 *
 * Three oscillators tuned to a minor-third drone (E2 / B2 / G3) are
 * slowly modulated by a low-frequency oscillator so the sound shimmers
 * like background cantina ambiance without requiring any audio asset.
 *
 * Usage:
 *   const stopMusic = startAmbientMusic();   // returns a teardown fn
 *   stopMusic();                             // fades out and closes ctx
 */

type StopFn = () => void;

const MUSIC_STORAGE_KEY = "pazaak-activity-music-enabled-v1";

export function getStoredMusicEnabled(): boolean {
  try {
    const raw = window.localStorage.getItem(MUSIC_STORAGE_KEY);
    if (raw === null) return false;
    return raw === "true";
  } catch {
    return false;
  }
}

export function setStoredMusicEnabled(value: boolean): void {
  try {
    window.localStorage.setItem(MUSIC_STORAGE_KEY, value ? "true" : "false");
  } catch { /* storage unavailable */ }
}

export function startAmbientMusic(volume = 0.055): StopFn {
  const AudioContextCtor =
    window.AudioContext ??
    (window as typeof window & { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;

  if (!AudioContextCtor) return () => {};

  let ctx: AudioContext;
  try {
    ctx = new AudioContextCtor();
  } catch {
    return () => {};
  }

  // Resume if created in a suspended state (autoplay policy).
  if (ctx.state === "suspended") {
    ctx.resume().catch(() => {});
  }

  const master = ctx.createGain();
  master.gain.setValueAtTime(0, ctx.currentTime);
  master.gain.linearRampToValueAtTime(volume, ctx.currentTime + 3.5);
  master.connect(ctx.destination);

  // Slow LFO for pitch shimmer (~0.12 Hz → about an 8-second sweep).
  const lfo = ctx.createOscillator();
  const lfoGain = ctx.createGain();
  lfo.type = "sine";
  lfo.frequency.value = 0.12;
  lfoGain.gain.value = 3.0; // detune depth in cents
  lfo.connect(lfoGain);
  lfo.start();

  // Drone chord: E2 (82.4 Hz), B2 (123.5 Hz), G3 (196.0 Hz)
  const droneFreqs = [82.41, 123.47, 196.0];
  const oscillators: OscillatorNode[] = [];

  for (const freq of droneFreqs) {
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.value = freq;
    lfoGain.connect(osc.detune);

    // Each voice slightly detuned for natural spread.
    osc.detune.value = (Math.random() - 0.5) * 8;

    const voiceGain = ctx.createGain();
    voiceGain.gain.value = 1 / droneFreqs.length;
    osc.connect(voiceGain);
    voiceGain.connect(master);
    osc.start();
    oscillators.push(osc);
  }

  // A second, higher shimmer layer at A4/E5 played very softly.
  const shimmerFreqs = [440.0, 659.25];
  for (const freq of shimmerFreqs) {
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.value = freq;

    const shimmerLfo = ctx.createOscillator();
    const shimmerLfoGain = ctx.createGain();
    shimmerLfo.type = "sine";
    shimmerLfo.frequency.value = 0.08 + Math.random() * 0.04;
    shimmerLfoGain.gain.value = 5;
    shimmerLfo.connect(shimmerLfoGain);
    shimmerLfoGain.connect(osc.detune);
    shimmerLfo.start();

    const shimGain = ctx.createGain();
    shimGain.gain.value = 0.06;
    osc.connect(shimGain);
    shimGain.connect(master);
    osc.start();
    oscillators.push(osc);
  }

  let stopped = false;
  return () => {
    if (stopped) return;
    stopped = true;
    try {
      master.gain.setValueAtTime(master.gain.value, ctx.currentTime);
      master.gain.linearRampToValueAtTime(0, ctx.currentTime + 1.8);
      window.setTimeout(() => {
        try { lfo.stop(); } catch { /* already stopped */ }
        for (const osc of oscillators) {
          try { osc.stop(); } catch { /* already stopped */ }
        }
        void ctx.close();
      }, 2000);
    } catch { /* ignore */ }
  };
}
