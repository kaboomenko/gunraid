'use client';

import { usePrefs } from './store';

/**
 * Звуки синтезируются через Web Audio — без сторонних файлов и лицензий.
 * Уважают переключатель звука (usePrefs.sound).
 */
let ctx: AudioContext | null = null;

function audio(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!usePrefs.getState().sound) return null;
  try {
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

function tone(freq: number, duration: number, type: OscillatorType, gain: number, delay = 0): void {
  const a = audio();
  if (!a) return;
  const t0 = a.currentTime + delay;
  const osc = a.createOscillator();
  const g = a.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.005);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
  osc.connect(g).connect(a.destination);
  osc.start(t0);
  osc.stop(t0 + duration + 0.02);
}

export const sound = {
  tick(): void {
    tone(1600, 0.03, 'square', 0.04);
  },
  open(): void {
    tone(220, 0.12, 'sawtooth', 0.06);
    tone(330, 0.12, 'sawtooth', 0.05, 0.06);
  },
  /** tier 0..3 — чем реже предмет, тем богаче аккорд. */
  win(tier = 0): void {
    const notes = [523, 659, 784, 1046, 1318];
    const count = Math.min(notes.length, 2 + tier);
    notes.slice(0, count).forEach((f, i) => tone(f, 0.28, 'triangle', 0.08, i * 0.07));
  },
  lose(): void {
    tone(300, 0.25, 'sawtooth', 0.05);
    tone(200, 0.35, 'sawtooth', 0.05, 0.12);
  },
};
