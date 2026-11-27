// Tactile HTML5 Canvas Challenge & Curse Randomizer Wheel with Physics & Synth Audio
import { CHALLENGE_CATEGORIES } from '../data/challenges.js?v=13';
import { store } from './state.js?v=13';

const SLICE_PALETTE = [
  '#F99D1C', '#0098CD', '#168388', '#D11F2F',
  '#5AB031', '#C4258F', '#005AA3', '#F37021',
  '#00954C', '#781140', '#0284c7', '#e11d48'
];

export class ChallengeWheel {
  constructor(canvasEl, callbacks = {}) {
    this.canvas = canvasEl;
    this.ctx = canvasEl.getContext('2d');
    this.callbacks = callbacks;
    this.items = [];
    this.angle = 0; // radians
    this.spinning = false;
    this.lastTickIndex = -1;
    this.audioCtx = null;
    this.confetti = [];
    this.animId = null;
  }

  setItems(items) {
    // Cap visible wheel slices at 16 for crisp readability; sample cleanly if larger
    if (items.length > 16) {
      const shuffled = [...items].sort(() => Math.random() - 0.5);
      this.items = shuffled.slice(0, 16);
    } else {
      this.items = [...items];
    }
    this.draw();
  }

  playTick() {
    if (!store.get().soundEnabled) return;
    try {
      if (!this.audioCtx) this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      if (this.audioCtx.state === 'suspended') this.audioCtx.resume();
      const osc = this.audioCtx.createOscillator();
      const gain = this.audioCtx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(680 + Math.random() * 120, this.audioCtx.currentTime);
      gain.gain.setValueAtTime(0.08, this.audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, this.audioCtx.currentTime + 0.032);
      osc.connect(gain);
      gain.connect(this.audioCtx.destination);
      osc.start();
      osc.stop(this.audioCtx.currentTime + 0.035);
    } catch {}
  }

  playWinChime() {
    if (!store.get().soundEnabled) return;
    try {
      if (!this.audioCtx) this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const notes = [523.25, 659.25, 783.99, 1046.5];
      notes.forEach((freq, i) => {
        const t = this.audioCtx.currentTime + i * 0.075;
        const osc = this.audioCtx.createOscillator();
        const gain = this.audioCtx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, t);
        gain.gain.setValueAtTime(0.11, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
        osc.connect(gain);
        gain.connect(this.audioCtx.destination);
        osc.start(t);
        osc.stop(t + 0.26);
      });
    } catch {}
  }

  spin() {
    if (this.spinning || !this.items.length) return;
    this.spinning = true;
    this.confetti = [];
    this.callbacks.onSpinStart?.();

    const startAngle = this.angle;
    const extraTurns = (5 + Math.random() * 4) * Math.PI * 2;
    const randomOffset = Math.random() * Math.PI * 2;
    const targetAngle = startAngle + extraTurns + randomOffset;
    const duration = 4200 + Math.random() * 1100;
    const startTime = performance.now();

    const easeOutQuart = (t) => 1 - Math.pow(1 - t, 4);

    const frame = (now) => {
      const elapsed = now - startTime;
      const t = Math.min(1, elapsed / duration);
      this.angle = startAngle + (targetAngle - startAngle) * easeOutQuart(t);

      const n = this.items.length;
      const sliceArc = (Math.PI * 2) / n;
      // Pointer is at top (-PI/2)
      const norm = ((-Math.PI / 2 - this.angle) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2);
      const idx = Math.floor(norm / sliceArc) % n;
      if (idx !== this.lastTickIndex) {
        this.lastTickIndex = idx;
        this.playTick();
      }

      this.draw();

      if (t < 1) {
        this.animId = requestAnimationFrame(frame);
      } else {
        this.spinning = false;
        this.playWinChime();
        this.spawnConfetti();
        const landed = this.items[idx];
        this.callbacks.onLand?.(landed);
      }
    };

    this.animId = requestAnimationFrame(frame);
  }

  spawnConfetti() {
    const w = this.canvas.width;
    const h = this.canvas.height;
    this.confetti = Array.from({ length: 42 }, () => ({
      x: w / 2,
      y: h / 2,
      vx: (Math.random() - 0.5) * 10,
      vy: (Math.random() - 0.85) * 11,
      size: 4 + Math.random() * 5,
      color: SLICE_PALETTE[Math.floor(Math.random() * SLICE_PALETTE.length)],
      life: 1
    }));

    const animConfetti = () => {
      let alive = false;
      this.confetti.forEach((p) => {
        p.x += p.vx;
        p.y += p.vy;
        p.vy += 0.28;
        p.life -= 0.022;
        if (p.life > 0) alive = true;
      });
      this.draw();
      if (alive) requestAnimationFrame(animConfetti);
      else {
        this.confetti = [];
        this.draw();
      }
    };
    requestAnimationFrame(animConfetti);
  }

  draw() {
    const canvas = this.canvas;
    const ctx = this.ctx;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cssSize = Math.min(canvas.parentElement?.clientWidth || 340, 380);
    if (canvas.width !== cssSize * dpr || canvas.height !== cssSize * dpr) {
      canvas.width = cssSize * dpr;
      canvas.height = cssSize * dpr;
      canvas.style.width = `${cssSize}px`;
      canvas.style.height = `${cssSize}px`;
    }

    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, cssSize, cssSize);

    const cx = cssSize / 2;
    const cy = cssSize / 2;
    const r = cssSize / 2 - 18;
    const n = this.items.length;

    // Outer metallic rim
    ctx.beginPath();
    ctx.arc(cx, cy, r + 9, 0, Math.PI * 2);
    ctx.fillStyle = '#0f172a';
    ctx.fill();
    ctx.lineWidth = 4;
    ctx.strokeStyle = '#334155';
    ctx.stroke();

    if (n === 0) {
      ctx.fillStyle = '#94a3b8';
      ctx.font = '700 14px "Space Grotesk", Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('No challenges yet', cx, cy - 8);
      ctx.font = '500 12px Inter, sans-serif';
      ctx.fillStyle = '#64748b';
      ctx.fillText('Create your own below to spin', cx, cy + 14);
      ctx.restore();
      return;
    }

    const sliceArc = (Math.PI * 2) / n;
    const catColors = Object.fromEntries(CHALLENGE_CATEGORIES.map((c) => [c.id, c.color]));

    for (let i = 0; i < n; i++) {
      const item = this.items[i];
      const start = this.angle + i * sliceArc;
      const end = start + sliceArc;
      const fill = item.category && catColors[item.category]
        ? (i % 2 === 0 ? catColors[item.category] : SLICE_PALETTE[i % SLICE_PALETTE.length])
        : SLICE_PALETTE[i % SLICE_PALETTE.length];

      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, r, start, end);
      ctx.closePath();
      ctx.fillStyle = fill;
      ctx.fill();
      ctx.lineWidth = 1.6;
      ctx.strokeStyle = 'rgba(11, 16, 32, 0.75)';
      ctx.stroke();

      // Label
      ctx.save();
      ctx.translate(cx, cy);
      ctx.fillStyle = '#ffffff';
      ctx.shadowColor = 'rgba(0,0,0,0.65)';
      ctx.shadowBlur = 4;
      ctx.font = `700 ${n > 12 ? 10.5 : 12.5}px "Space Grotesk", Inter, sans-serif`;
      if (n === 1) {
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const label = item.title.length > 24 ? `${item.title.slice(0, 23)}…` : item.title;
        ctx.fillText(label, 0, -r * 0.55);
      } else {
        ctx.rotate(start + sliceArc / 2);
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        const maxChars = n > 12 ? 16 : 20;
        const label = item.title.length > maxChars ? `${item.title.slice(0, maxChars - 1)}…` : item.title;
        ctx.fillText(label, r - 14, 0);
      }
      ctx.restore();
    }

    // Rim pegs
    for (let i = 0; i < n; i++) {
      const a = this.angle + i * sliceArc;
      const px = cx + Math.cos(a) * (r + 3);
      const py = cy + Math.sin(a) * (r + 3);
      ctx.beginPath();
      ctx.arc(px, py, 3.2, 0, Math.PI * 2);
      ctx.fillStyle = '#f8fafc';
      ctx.fill();
    }

    // Center hub button
    ctx.beginPath();
    ctx.arc(cx, cy, 28, 0, Math.PI * 2);
    ctx.fillStyle = '#0b1020';
    ctx.fill();
    ctx.lineWidth = 4;
    ctx.strokeStyle = '#F99D1C';
    ctx.stroke();

    ctx.fillStyle = '#f8fafc';
    ctx.font = '800 11px "Space Grotesk", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(this.spinning ? '•••' : 'SPIN', cx, cy);

    // Top Pointer Arrow
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(cx, cy - r + 8);
    ctx.lineTo(cx - 13, cy - r - 15);
    ctx.lineTo(cx + 13, cy - r - 15);
    ctx.closePath();
    ctx.fillStyle = '#fbbf24';
    ctx.shadowColor = 'rgba(0,0,0,0.6)';
    ctx.shadowBlur = 6;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#0b1020';
    ctx.stroke();
    ctx.restore();

    // Confetti overlay
    if (this.confetti.length) {
      ctx.save();
      ctx.scale(1 / dpr, 1 / dpr);
      this.confetti.forEach((p) => {
        if (p.life <= 0) return;
        ctx.globalAlpha = Math.max(0, p.life);
        ctx.fillStyle = p.color;
        ctx.fillRect(p.x, p.y, p.size, p.size * 0.65);
      });
      ctx.restore();
    }

    ctx.restore();
  }
}
