export function createCelebration({ settings, isSpeaking = () => false }) {
  let context, timer, overlay, notes = [];
  const seen = new Set();
  function prepare() {
    if (!settings().sound) return;
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return;
      context ||= new AudioContext();
      // Called within the student's send/submit gesture; mobile browsers require it.
      if (context.state === 'suspended') void context.resume().catch(() => {});
    } catch { /* The written encouragement still works without audio. */ }
  }
  function stop() {
    clearTimeout(timer); overlay?.remove(); overlay = null;
    for (const note of notes) { try { note.stop(); } catch {} }
    notes = [];
  }
  function melody() {
    if (!context || context.state !== 'running' || isSpeaking()) return;
    // A short original four-note chime, with a soft attack and no downloaded music.
    [523.25, 659.25, 783.99, 1046.5].forEach((frequency, i) => {
      const oscillator = context.createOscillator(), gain = context.createGain();
      const at = context.currentTime + i * 0.16;
      oscillator.type = 'sine'; oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0, at); gain.gain.linearRampToValueAtTime(0.075, at + 0.025); gain.gain.exponentialRampToValueAtTime(0.001, at + 0.42);
      oscillator.connect(gain); gain.connect(context.destination);
      oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); notes = notes.filter(n => n !== oscillator); };
      notes.push(oscillator); oscillator.start(at); oscillator.stop(at + 0.45);
    });
  }
  function show(feedback) {
    if (!feedback?.id || !['correct_step', 'correct_answer'].includes(feedback.kind) || seen.has(feedback.id) || document.hidden) return;
    seen.add(feedback.id); if (seen.size > 500) seen.delete(seen.values().next().value);
    stop();
    const options = settings();
    if (options.sound) melody();
    if (!options.visual) return;
    overlay = document.createElement('div'); overlay.className = 'celebration';
    const badge = document.createElement('div'); badge.className = 'celebration-badge'; badge.setAttribute('role', 'status');
    badge.textContent = feedback.kind === 'correct_answer' ? '答对啦，给自己鼓个掌！' : '这一步，想对啦！';
    overlay.append(badge);
    if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
      const colors = ['#f3b84c', '#a2bf8a', '#ad9bda', '#79b9ca', '#eb9b8c'];
      for (let i = 0; i < 36; i++) {
        const piece = document.createElement('i'); piece.className = 'celebration-confetti'; piece.setAttribute('aria-hidden', 'true');
        piece.style.setProperty('--x', `${(Math.random() - 0.5) * Math.min(innerWidth * 0.85, 780)}px`);
        piece.style.setProperty('--rise', `${-70 - Math.random() * 150}px`);
        piece.style.setProperty('--fall', `${180 + Math.random() * 180}px`);
        piece.style.setProperty('--spin', `${(Math.random() - 0.5) * 900}deg`);
        piece.style.setProperty('--delay', `${Math.random() * 0.12}s`);
        piece.style.background = colors[i % colors.length]; overlay.append(piece);
      }
    }
    (document.querySelector('dialog[open]') || document.body).append(overlay);
    timer = setTimeout(stop, 2300);
  }
  document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); });
  window.addEventListener('pagehide', stop);
  return { prepare, show, stop };
}
