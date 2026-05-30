import { useEffect, useRef, useState, useCallback } from 'react';
import './CatsCradle.css';

/* MediaPipe loaded via CDN → window.Hands / window.Camera */

// ─── LANDMARK INDICES ─────────────────────────────────────
const TIPS = [4, 8, 12, 16, 20];
const DIPS = [3, 7, 11, 15, 19];
const PIPS = [2, 6, 10, 14, 18];
const MCPS = [1, 5, 9, 13, 17];
const ALL_IDS = Array.from({ length: 21 }, (_, i) => i);

const MAX_PARTICLES = 1200;
const MAX_SPARKLES = 500;
const TOUCH_DIST = 0.055;

// Colors
const L_COL = { mesh: 'rgba(255,0,170,0.10)', bone: '#ff44cc', joint: '#ff66ee', sparkle: ['#ff44cc','#ff88ee','#ffaaff','#ff00aa','#ff66bb'] };
const R_COL = { mesh: 'rgba(0,255,120,0.10)', bone: '#33ff88', joint: '#66ffaa', sparkle: ['#33ff88','#88ffcc','#aaffdd','#00ff66','#66ffaa'] };
const BEAM_HUES = [0, 30, 60, 120, 170, 200, 260, 300]; // rainbow
const PARTICLE_COLORS = ['#ff44cc','#44ff88','#ffaa00','#00ffee','#ff0066','#aa44ff','#ffff44','#00aaff'];

// Skeleton
const BONES = [
  [0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],
  [5,9],[9,10],[10,11],[11,12],[9,13],[13,14],[14,15],[15,16],
  [13,17],[17,18],[18,19],[19,20],[0,17],
];

// Triangles for filled mesh
const MESH_TRIS = [
  [0,1,5],[0,5,17],[5,9,17],[9,13,17],
  [1,2,5],[2,3,5],[3,4,5],
  [5,6,9],[6,7,9],[7,8,9],
  [9,10,13],[10,11,13],[11,12,13],
  [13,14,17],[14,15,17],[15,16,17],
  [17,18,0],[18,19,0],[19,20,0],
];

// Build wire pairs: every landmark to every landmark = dense web
const WIRE_PAIRS_ALL = [];
for (let a = 0; a < 21; a++) {
  for (let b = 0; b < 21; b++) {
    WIRE_PAIRS_ALL.push([a, b]);
  }
}

// ─── SPARKLE (tiny fast-fading magic dust) ────────────────
class Sparkle {
  constructor(x, y, color) {
    this.x = x; this.y = y;
    const a = Math.random() * Math.PI * 2;
    const s = 0.5 + Math.random() * 3;
    this.vx = Math.cos(a) * s + (Math.random() - 0.5) * 2;
    this.vy = Math.sin(a) * s - Math.random() * 1.5; // drift upward
    this.life = 1;
    this.decay = 0.03 + Math.random() * 0.04;
    this.radius = 0.8 + Math.random() * 2.2;
    this.color = color;
    this.twinkle = Math.random() * Math.PI * 2;
    this.twinkleSpeed = 0.1 + Math.random() * 0.2;
  }
  update() {
    this.x += this.vx;
    this.y += this.vy;
    this.vx *= 0.95;
    this.vy *= 0.95;
    this.vy -= 0.02; // float up
    this.life -= this.decay;
    this.twinkle += this.twinkleSpeed;
  }
  draw(ctx) {
    if (this.life <= 0) return;
    const flicker = 0.5 + 0.5 * Math.sin(this.twinkle);
    ctx.save();
    ctx.globalAlpha = this.life * flicker;
    ctx.shadowColor = this.color;
    ctx.shadowBlur = 10;
    ctx.fillStyle = this.color;
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.radius * this.life, 0, Math.PI * 2);
    ctx.fill();
    // tiny star cross
    if (this.radius > 1.5) {
      ctx.strokeStyle = this.color;
      ctx.lineWidth = 0.4;
      ctx.globalAlpha = this.life * flicker * 0.5;
      const r = this.radius * this.life * 1.5;
      ctx.beginPath();
      ctx.moveTo(this.x - r, this.y); ctx.lineTo(this.x + r, this.y);
      ctx.moveTo(this.x, this.y - r); ctx.lineTo(this.x, this.y + r);
      ctx.stroke();
    }
    ctx.restore();
  }
  get alive() { return this.life > 0; }
}

// ─── BURST PARTICLE (bigger, for touch explosions) ────────
class Particle {
  constructor(x, y, color) {
    this.x = x; this.y = y;
    const a = Math.random() * Math.PI * 2;
    const s = 2 + Math.random() * 8;
    this.vx = Math.cos(a) * s;
    this.vy = Math.sin(a) * s;
    this.life = 1;
    this.decay = 0.01 + Math.random() * 0.02;
    this.radius = 2 + Math.random() * 4;
    this.color = color;
  }
  update() {
    this.x += this.vx; this.y += this.vy;
    this.vx *= 0.96; this.vy *= 0.96;
    this.vy += 0.05;
    this.life -= this.decay;
  }
  draw(ctx) {
    if (this.life <= 0) return;
    ctx.save();
    ctx.globalAlpha = this.life;
    ctx.shadowColor = this.color;
    ctx.shadowBlur = 18;
    ctx.fillStyle = this.color;
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.radius * this.life, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  get alive() { return this.life > 0; }
}

// ─── AMBIENT FLOATING MOTE ───────────────────────────────
class AmbientMote {
  constructor(W, H) {
    this.x = Math.random() * W;
    this.y = Math.random() * H;
    this.vx = (Math.random() - 0.5) * 0.3;
    this.vy = -0.1 - Math.random() * 0.3;
    this.radius = 0.5 + Math.random() * 1.5;
    this.alpha = 0.1 + Math.random() * 0.2;
    this.phase = Math.random() * Math.PI * 2;
    this.color = PARTICLE_COLORS[Math.floor(Math.random() * PARTICLE_COLORS.length)];
    this.W = W; this.H = H;
  }
  update() {
    this.x += this.vx + Math.sin(this.phase) * 0.2;
    this.y += this.vy;
    this.phase += 0.02;
    if (this.y < -10) { this.y = this.H + 10; this.x = Math.random() * this.W; }
    if (this.x < -10) this.x = this.W + 10;
    if (this.x > this.W + 10) this.x = -10;
  }
  draw(ctx) {
    const flicker = 0.6 + 0.4 * Math.sin(this.phase * 3);
    ctx.save();
    ctx.globalAlpha = this.alpha * flicker;
    ctx.fillStyle = this.color;
    ctx.shadowColor = this.color;
    ctx.shadowBlur = 6;
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

// ─── DRAWING HELPERS ──────────────────────────────────────

function lmDist(a, b) {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
}

/** Lerp between two landmark sets for smoothing */
function lerpLandmarks(prev, curr, t) {
  if (!prev) return curr;
  return curr.map((c, i) => ({
    x: prev[i].x + (c.x - prev[i].x) * t,
    y: prev[i].y + (c.y - prev[i].y) * t,
    z: prev[i].z + (c.z - prev[i].z) * t,
  }));
}

function drawHandMesh(ctx, lm, color, W, H) {
  ctx.save();
  ctx.fillStyle = color;
  for (const [a, b, c] of MESH_TRIS) {
    ctx.beginPath();
    ctx.moveTo(lm[a].x * W, lm[a].y * H);
    ctx.lineTo(lm[b].x * W, lm[b].y * H);
    ctx.lineTo(lm[c].x * W, lm[c].y * H);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

function drawSkeleton(ctx, lm, color, W, H) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.shadowColor = color;
  ctx.shadowBlur = 8;
  ctx.lineWidth = 2.5;
  ctx.globalAlpha = 0.6;
  for (const [a, b] of BONES) {
    ctx.beginPath();
    ctx.moveTo(lm[a].x * W, lm[a].y * H);
    ctx.lineTo(lm[b].x * W, lm[b].y * H);
    ctx.stroke();
  }
  ctx.restore();
}

function drawJoint(ctx, x, y, color, r) {
  ctx.save();
  ctx.shadowColor = color;
  ctx.shadowBlur = 24;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.globalAlpha = 0.85;
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.arc(x, y, r * 0.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawAllJoints(ctx, lm, color, W, H) {
  for (let i = 0; i < lm.length; i++) {
    const isTip = TIPS.includes(i);
    const r = isTip ? 7 : MCPS.includes(i) ? 5 : 3.5;
    drawJoint(ctx, lm[i].x * W, lm[i].y * H, color, r);
  }
}

/** Ultra-thin gossamer wire */
function drawWire(ctx, x1, y1, x2, y2, dist, hue, alpha) {
  const t = Math.min(dist / 0.65, 1);
  if (t > 0.95) return; // fade out when too far
  const color = `hsl(${hue}, 90%, 65%)`;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.shadowColor = color;
  ctx.shadowBlur = 4;
  ctx.lineWidth = 0.5 + (1 - t) * 0.5;
  ctx.globalAlpha = alpha * (1 - t);
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
  ctx.restore();
}

/** Thick primary rainbow beam */
function drawBeam(ctx, x1, y1, x2, y2, dist, hue) {
  const t = Math.min(dist / 0.5, 1);
  const color = `hsl(${hue}, 100%, 60%)`;
  const w = 4 - t * 3;

  ctx.save();
  // Wide glow
  ctx.strokeStyle = color; ctx.shadowColor = color;
  ctx.shadowBlur = 35 + (1 - t) * 20;
  ctx.lineWidth = w + 6; ctx.globalAlpha = 0.12;
  ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
  // Main
  ctx.globalAlpha = 0.7; ctx.lineWidth = w + 2; ctx.shadowBlur = 16;
  ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
  // Core
  ctx.globalAlpha = 0.85; ctx.lineWidth = w; ctx.shadowBlur = 8;
  ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
  // White hot
  ctx.globalAlpha = 0.4; ctx.strokeStyle = '#fff'; ctx.shadowColor = '#fff';
  ctx.shadowBlur = 4; ctx.lineWidth = Math.max(w * 0.3, 0.5);
  ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
  ctx.restore();
}

function drawHUD(ctx, L, R, fps) {
  const n = (L ? 1 : 0) + (R ? 1 : 0);
  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.beginPath(); ctx.roundRect(14, 14, 95, 62, 8); ctx.fill();
  ctx.fillStyle = '#00ffcc'; ctx.font = 'bold 22px Outfit, sans-serif';
  ctx.fillText(`🖐 ${n}`, 24, 40);
  ctx.fillStyle = 'rgba(170,220,200,0.65)'; ctx.font = '12px Outfit, sans-serif';
  ctx.fillText(`${fps} FPS`, 26, 62);
  ctx.restore();
}

function drawScanlines(ctx, W, H) {
  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.035)';
  for (let y = 0; y < H; y += 4) ctx.fillRect(0, y, W, 1);
  ctx.restore();
}

// ─── COMPONENT ────────────────────────────────────────────

export default function CatsCradle() {
  const canvasRef = useRef(null);
  const videoRef = useRef(null);
  const rafRef = useRef(null);
  const cameraRef = useRef(null);
  const handsRef = useRef(null);

  const particlesRef = useRef([]);
  const sparklesRef = useRef([]);
  const ambientRef = useRef([]);

  const frameRef = useRef(0);
  const leftRef = useRef(null);
  const rightRef = useRef(null);
  const prevLeftRef = useRef(null);
  const prevRightRef = useRef(null);

  const fpsRef = useRef(0);
  const fpsCnt = useRef(0);
  const fpsT = useRef(performance.now());

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [detected, setDetected] = useState(false);

  // Init ambient motes
  const initAmbient = useCallback((W, H) => {
    if (ambientRef.current.length === 0) {
      for (let i = 0; i < 60; i++) ambientRef.current.push(new AmbientMote(W, H));
    }
  }, []);

  const spawnBurst = useCallback((x, y) => {
    const c = PARTICLE_COLORS[Math.floor(Math.random() * PARTICLE_COLORS.length)];
    for (let i = 0; i < 45; i++) {
      if (particlesRef.current.length < MAX_PARTICLES) particlesRef.current.push(new Particle(x, y, c));
    }
  }, []);

  const emitSparkles = useCallback((lm, colors, W, H) => {
    for (let i = 0; i < TIPS.length; i++) {
      const tip = lm[TIPS[i]];
      const x = tip.x * W, y = tip.y * H;
      const col = colors[i % colors.length];
      // Emit 2-3 sparkles per tip per frame
      for (let j = 0; j < 2 + Math.floor(Math.random() * 2); j++) {
        if (sparklesRef.current.length < MAX_SPARKLES) {
          sparklesRef.current.push(new Sparkle(x, y, col));
        }
      }
    }
  }, []);

  // ── RENDER LOOP ──
  const renderLoop = useCallback(() => {
    const canvas = canvasRef.current;
    const video = videoRef.current;
    if (!canvas || !video) return;

    const ctx = canvas.getContext('2d');
    const W = canvas.width;
    const H = canvas.height;
    frameRef.current++;

    // FPS
    fpsCnt.current++;
    const now = performance.now();
    if (now - fpsT.current >= 1000) {
      fpsRef.current = fpsCnt.current;
      fpsCnt.current = 0;
      fpsT.current = now;
    }

    initAmbient(W, H);

    // ── Camera feed (clearly visible, mirrored) ──
    if (video.readyState >= 2) {
      ctx.save();
      ctx.translate(W, 0); ctx.scale(-1, 1);
      ctx.drawImage(video, 0, 0, W, H);
      ctx.restore();
    } else {
      ctx.fillStyle = '#111'; ctx.fillRect(0, 0, W, H);
    }

    // Light dim for contrast
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,15,0.12)';
    ctx.fillRect(0, 0, W, H);
    ctx.restore();

    // ── Ambient floating motes ──
    for (const m of ambientRef.current) { m.update(); m.draw(ctx); }

    // Smooth landmarks with lerp
    let leftHand = leftRef.current;
    let rightHand = rightRef.current;

    if (leftHand) {
      leftHand = lerpLandmarks(prevLeftRef.current, leftHand, 0.55);
      prevLeftRef.current = leftHand;
    } else {
      prevLeftRef.current = null;
    }
    if (rightHand) {
      rightHand = lerpLandmarks(prevRightRef.current, rightHand, 0.55);
      prevRightRef.current = rightHand;
    } else {
      prevRightRef.current = null;
    }

    // ── LEFT HAND ──
    if (leftHand) {
      drawHandMesh(ctx, leftHand, L_COL.mesh, W, H);
      drawSkeleton(ctx, leftHand, L_COL.bone, W, H);
      drawAllJoints(ctx, leftHand, L_COL.joint, W, H);
      emitSparkles(leftHand, L_COL.sparkle, W, H);
    }

    // ── RIGHT HAND ──
    if (rightHand) {
      drawHandMesh(ctx, rightHand, R_COL.mesh, W, H);
      drawSkeleton(ctx, rightHand, R_COL.bone, W, H);
      drawAllJoints(ctx, rightHand, R_COL.joint, W, H);
      emitSparkles(rightHand, R_COL.sparkle, W, H);
    }

    // ── INTER-HAND WIRES ──
    if (leftHand && rightHand) {

      // Dense thin wire web: ALL 21×21 landmark pairs
      for (let a = 0; a < 21; a++) {
        for (let b = 0; b < 21; b++) {
          const la = leftHand[a], lb = rightHand[b];
          const dist = lmDist(la, lb);
          if (dist > 0.65) continue; // cull far wires for perf
          const hue = (a * 17 + b * 29) % 360;
          const isTipPair = TIPS.includes(a) && TIPS.includes(b);
          const alpha = isTipPair ? 0.15 : 0.06;
          drawWire(ctx, la.x * W, la.y * H, lb.x * W, lb.y * H, dist, hue, alpha);
        }
      }

      // Medium beams: DIP + PIP + MCP matching pairs
      const mediumPairs = [...DIPS.map((id) => [id, id]), ...PIPS.map((id) => [id, id]), ...MCPS.map((id) => [id, id])];
      mediumPairs.push([0, 0]); // wrist
      for (let i = 0; i < mediumPairs.length; i++) {
        const [li, ri] = mediumPairs[i];
        const la = leftHand[li], lb = rightHand[ri];
        const dist = lmDist(la, lb);
        const hue = BEAM_HUES[i % BEAM_HUES.length];
        ctx.save();
        ctx.globalAlpha = 0.35;
        drawBeam(ctx, la.x * W, la.y * H, lb.x * W, lb.y * H, dist, hue);
        ctx.restore();
      }

      // Primary beams: fingertip matching pairs (brightest)
      for (let i = 0; i < TIPS.length; i++) {
        const la = leftHand[TIPS[i]], lb = rightHand[TIPS[i]];
        const x1 = la.x * W, y1 = la.y * H;
        const x2 = lb.x * W, y2 = lb.y * H;
        const dist = lmDist(la, lb);
        const hue = BEAM_HUES[i % BEAM_HUES.length];
        drawBeam(ctx, x1, y1, x2, y2, dist, hue);

        if (dist < TOUCH_DIST && frameRef.current % 3 === 0) {
          spawnBurst((x1 + x2) / 2, (y1 + y2) / 2);
        }
      }

      // Cross fingertip touch detection
      for (const a of TIPS) {
        for (const b of TIPS) {
          if (a === b) continue;
          const d = lmDist(leftHand[a], rightHand[b]);
          if (d < TOUCH_DIST * 0.8 && frameRef.current % 6 === 0) {
            spawnBurst(
              (leftHand[a].x * W + rightHand[b].x * W) / 2,
              (leftHand[a].y * H + rightHand[b].y * H) / 2
            );
          }
        }
      }
    }

    // ── Sparkles ──
    sparklesRef.current = sparklesRef.current.filter((s) => s.alive);
    for (const s of sparklesRef.current) { s.update(); s.draw(ctx); }

    // ── Burst particles ──
    particlesRef.current = particlesRef.current.filter((p) => p.alive);
    for (const p of particlesRef.current) { p.update(); p.draw(ctx); }

    // ── Post-processing ──
    drawScanlines(ctx, W, H);
    drawHUD(ctx, leftHand, rightHand, fpsRef.current);

    rafRef.current = requestAnimationFrame(renderLoop);
  }, [spawnBurst, emitSparkles, initAmbient]);

  // Resize
  useEffect(() => {
    const resize = () => {
      const c = canvasRef.current;
      if (c) { c.width = window.innerWidth; c.height = window.innerHeight; }
    };
    resize();
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);

  // MediaPipe + Camera
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    let alive = true;
    let poll = null;

    function init() {
      if (!window.Hands || !window.Camera) { poll = setTimeout(init, 100); return; }

      const hands = new window.Hands({
        locateFile: (f) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4/${f}`,
      });
      hands.setOptions({
        maxNumHands: 2,
        modelComplexity: 1,
        minDetectionConfidence: 0.5,
        minTrackingConfidence: 0.4,
      });
      hands.onResults((r) => {
        if (!alive) return;
        leftRef.current = null;
        rightRef.current = null;
        if (r.multiHandLandmarks && r.multiHandedness) {
          for (let i = 0; i < r.multiHandLandmarks.length; i++) {
            if (r.multiHandedness[i].label === 'Left') rightRef.current = r.multiHandLandmarks[i];
            else leftRef.current = r.multiHandLandmarks[i];
          }
        }
        if (leftRef.current || rightRef.current) setDetected(true);
      });
      handsRef.current = hands;

      const cam = new window.Camera(video, {
        onFrame: async () => { await hands.send({ image: video }); },
        width: 1280, height: 720,
      });
      cameraRef.current = cam;
      cam.start()
        .then(() => { if (alive) setLoading(false); })
        .catch((e) => { if (alive) { setError('Camera access denied.'); setLoading(false); console.error(e); } });
    }

    init();
    return () => { alive = false; if (poll) clearTimeout(poll); cameraRef.current?.stop?.(); handsRef.current?.close?.(); };
  }, []);

  // Render loop lifecycle
  useEffect(() => {
    rafRef.current = requestAnimationFrame(renderLoop);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [renderLoop]);

  if (error) {
    return (
      <div className="error-overlay">
        <h2>⚠ Camera Error</h2>
        <p>{error}</p>
        <p style={{ marginTop: 12 }}>Please allow camera access and reload.</p>
      </div>
    );
  }

  return (
    <>
      <div className={`loading-overlay ${loading ? '' : 'hidden'}`}>
        <div className="loader-ring" />
        <p>Initializing Hand Tracking…</p>
      </div>
      <div className={`instructions ${detected ? 'fade' : ''}`}>
        Bring both hands into the frame to see the magic ✨
      </div>
      <video ref={videoRef} style={{ display: 'none' }} playsInline />
      <div className="cradle-wrapper">
        <canvas ref={canvasRef} className="cradle-canvas" />
      </div>
    </>
  );
}
