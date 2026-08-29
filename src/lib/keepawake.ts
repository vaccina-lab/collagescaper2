/* SALVAGE/9 — keep-awake.
   Browsers freeze background tabs (timer clamping → full suspend).
   Defenses: silent looping AudioContext + held Web Lock + worker heartbeat.
   Heavy inference lives in its own worker, so the main thread never hangs. */

let ctx: AudioContext | null = null;
let gain: GainNode | null = null;
let osc: OscillatorNode | null = null;
let lfo: OscillatorNode | null = null;
let lfoGain: GainNode | null = null;
let worker: Worker | null = null;
let lockAbort: AbortController | null = null;
let nudge: (() => void) | null = null;
let lastBeat = 0;
let gestureArmed = false;

const armGestureResume = () => {
  if (gestureArmed) return;
  gestureArmed = true;
  const resume = () => { void ctx?.resume(); };
  window.addEventListener('pointerdown', resume, { once: true });
  window.addEventListener('keydown', resume, { once: true });
};

export function startKeepAwake(onNudge: () => void) {
  nudge = onNudge;
  try {
    if (!ctx) {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      ctx = new AC();
      gain = ctx.createGain();
      gain.gain.value = 0.0018;
      gain.connect(ctx.destination);
      osc = ctx.createOscillator();
      osc.frequency.value = 19;
      lfo = ctx.createOscillator();
      lfo.frequency.value = 0.07;
      lfoGain = ctx.createGain();
      lfoGain.gain.value = 0.0008;
      lfo.connect(lfoGain);
      lfoGain.connect(gain.gain);
      osc.connect(gain);
      osc.start();
      lfo.start();
    }
    if (ctx.state === 'suspended') { void ctx.resume(); armGestureResume(); }
  } catch { /* other defenses still run */ }

  try {
    if (!lockAbort && navigator.locks?.request) {
      lockAbort = new AbortController();
      void navigator.locks.request('salvage9-keep-awake', { signal: lockAbort.signal }, () =>
        new Promise<void>(() => { /* hold until aborted */ }));
    }
  } catch { /* unsupported */ }

  try {
    if (!worker) {
      const blob = new Blob([
        'let t=null;self.onmessage=function(e){if(e.data==="start"){t=setInterval(function(){postMessage("tick")},400)}else if(e.data==="stop"){clearInterval(t);t=null}};',
      ], { type: 'application/javascript' });
      worker = new Worker(URL.createObjectURL(blob));
      worker.onmessage = () => {
        const now = Date.now();
        if (now - lastBeat < 350) return;
        lastBeat = now;
        nudge?.();
      };
      worker.postMessage('start');
    }
  } catch { /* unsupported */ }
}

export function stopKeepAwake() {
  try { worker?.postMessage('stop'); } catch { /* noop */ }
  worker?.terminate();
  worker = null;
  try { lockAbort?.abort(); } catch { /* noop */ }
  lockAbort = null;
  try {
    osc?.stop(); lfo?.stop();
    osc = lfo = null;
    lfoGain = null;
    gain?.disconnect();
    gain = null;
    void ctx?.close();
    ctx = null;
  } catch { /* noop */ }
  nudge = null;
}
