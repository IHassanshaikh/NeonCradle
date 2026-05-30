import { useEffect, useRef, useState, useCallback } from 'react';
import './CatsCradle.css';

/* MediaPipe loaded via CDN in index.html → window.Hands / window.Camera */

// ─── LANDMARK GROUPS ──────────────────────────────────────
const FINGERTIP_IDS = [4, 8, 12, 16, 20];
const FINGER_DIP    = [3, 7, 11, 15, 19];
const FINGER_PIP    = [2, 6, 10, 14, 18];
const FINGER_MCP    = [1, 5, 9, 13, 17];

const TOUCH_DIST = 0.05;
const MAX_PARTICLES = 800;

// ── Color palettes ──
const LEFT_COLOR  = { main: '#ff44cc', glow: '#ff00aa', mesh: 'rgba(255, 0, 170, 0.12)', joint: '#ff66dd' };
const RIGHT_COLOR = { main: '#44ff88', glow: '#00ff66', mesh: 'rgba(0, 255, 100, 0.12)', joint: '#66ffaa' };
const BEAM_COLORS = ['#ff0066', '#ff4400', '#ffaa00', '#44ff00', '#00ffcc', '#00aaff', '#8844ff', '#ff00ff'];
const PARTICLE_COLORS = ['#ff44cc', '#44ff88', '#ffaa00', '#00ffcc', '#ff0066', '#aa44ff'];

// ── Hand skeleton connections ──
const HAND_CONNECTIONS = [
  [0,1],[1,2],[2,3],[3,4],
  [0,5],[5,6],[6,7],[7,8],
  [5,9],[9,10],[10,11],[11,12],
  [9,13],[13,14],[14,15],[15,16],
  [13,17],[17,18],[18,19],[19,20],
  [0,17],
];

// ── Mesh triangles to fill the hand surface ──
const HAND_MESH_TRIS = [
  // Palm
  [0, 1, 5], [0, 5, 17], [5, 9, 17], [9, 13, 17],
  // Thumb
  [1, 2, 5], [2, 3, 5], [3, 4, 5],
  // Index
  [5, 6, 9], [6, 7, 9], [7, 8, 9],
  // Middle
  [9, 10, 13], [10, 11, 13], [11, 12, 13],
  // Ring
  [13, 14, 17], [14, 15, 17], [15, 16, 17],
  // Pinky
  [17, 18, 0], [18, 19, 0], [19, 20, 0],
];

// ── Inter-hand beam pairs: each fingertip to EVERY other fingertip ──
const ALL_BEAM_PAIRS = [];
for (const a of FINGERTIP_IDS) {
  for (const b of FINGERTIP_IDS) {
    ALL_BEAM_PAIRS.push([a, b]);
  }
}

// ── Intra-hand fingertip web ──
const INTRA_HAND_PAIRS = [];
for (let i = 0; i < FINGERTIP_IDS.length; i++) {
  for (let j = i + 1; j < FINGERTIP_IDS.length; j++) {
    INTRA_HAND_PAIRS.push([FINGERTIP_IDS[i], FINGERTIP_IDS[j]]);
  }
}

// ─── PARTICLE ─────────────────────────────────────────────
class Particle {
  constructor(x, y, color) {
    this.x = x;
    this.y = y;
    const angle = Math.random() * Math.PI * 2;
    const speed = 2 + Math.random() * 7;
    this.vx = Math.cos(angle) * speed;
    this.vy = Math.sin(angle) * speed;
    this.life = 1;
    this.decay = 0.012 + Math.random() * 0.02;
    this.radius = 1.5 + Math.random() * 4;
    this.color = color;
  }
  update() {
    this.x += this.vx;
    this.y += this.vy;
    this.vx *= 0.96;
    this.vy *= 0.96;
    this.vy += 0.06;
    this.life -= this.decay;
  }
  draw(ctx) {
    if (this.life <= 0) return;
    ctx.save();
    ctx.globalAlpha = this.life;
    ctx.shadowColor = this.color;
    ctx.shadowBlur = 16;
    ctx.fillStyle = this.color;
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.radius * this.life, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  get alive() { return this.life > 0; }
}

// ─── DRAWING HELPERS ──────────────────────────────────────

function lmDist(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/** Filled semi-transparent mesh surface over the hand */
function drawHandMesh(ctx, lm, meshColor, W, H) {
  ctx.save();
  ctx.fillStyle = meshColor;
  for (const [a, b, c] of HAND_MESH_TRIS) {
    ctx.beginPath();
    ctx.moveTo(lm[a].x * W, lm[a].y * H);
    ctx.lineTo(lm[b].x * W, lm[b].y * H);
    ctx.lineTo(lm[c].x * W, lm[c].y * H);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

/** Hand skeleton with colored bones */
function drawHandSkeleton(ctx, lm, color, W, H) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.shadowColor = color;
  ctx.shadowBlur = 6;
  ctx.lineWidth = 2.5;
  ctx.globalAlpha = 0.65;
  for (const [a, b] of HAND_CONNECTIONS) {
    ctx.beginPath();
    ctx.moveTo(lm[a].x * W, lm[a].y * H);
    ctx.lineTo(lm[b].x * W, lm[b].y * H);
    ctx.stroke();
  }
  ctx.restore();
}

/** Glowing joint dot */
function drawJoint(ctx, x, y, color, radius) {
  ctx.save();
  ctx.shadowColor = color;
  ctx.shadowBlur = 22;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fill();
  // hot white core
  ctx.shadowBlur = 0;
  ctx.globalAlpha = 0.8;
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(x, y, radius * 0.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/** Draw all joints on a hand */
function drawAllJoints(ctx, lm, color, W, H) {
  for (let i = 0; i < lm.length; i++) {
    const isTip = FINGERTIP_IDS.includes(i);
    const r = isTip ? 7 : FINGER_MCP.includes(i) ? 5 : 3.5;
    drawJoint(ctx, lm[i].x * W, lm[i].y * H, color, r);
  }
}

/** Thick rainbow laser beam between hands */
function drawRainbowBeam(ctx, x1, y1, x2, y2, dist, colorIndex) {
  const t = Math.min(dist / 0.5, 1);
  const color = BEAM_COLORS[colorIndex % BEAM_COLORS.length];
  const baseWidth = 4 - t * 3;

  ctx.save();

  // Wide outer glow
  ctx.strokeStyle = color;
  ctx.shadowColor = color;
  ctx.shadowBlur = 30 + (1 - t) * 25;
  ctx.lineWidth = baseWidth + 6;
  ctx.globalAlpha = 0.15;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();

  // Main beam
  ctx.globalAlpha = 0.75;
  ctx.lineWidth = baseWidth + 2;
  ctx.shadowBlur = 18;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();

  // Core
  ctx.globalAlpha = 0.9;
  ctx.lineWidth = baseWidth;
  ctx.shadowBlur = 10;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();

  // White-hot center
  ctx.globalAlpha = 0.45;
  ctx.strokeStyle = '#ffffff';
  ctx.shadowColor = '#ffffff';
  ctx.shadowBlur = 4;
  ctx.lineWidth = Math.max(baseWidth * 0.35, 0.5);
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();

  ctx.restore();
}

/** Thin thread wire for subtle connections */
function drawThread(ctx, x1, y1, x2, y2, dist, color, alpha = 0.2) {
  const t = Math.min(dist / 0.6, 1);
  ctx.save();
  ctx.strokeStyle = color;
  ctx.shadowColor = color;
  ctx.shadowBlur = 5;
  ctx.lineWidth = 0.8 + (1 - t) * 0.6;
  ctx.globalAlpha = alpha * (1 - t * 0.6);
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
  ctx.restore();
}

/** HUD overlay */
function drawHUD(ctx, leftHand, rightHand, fps) {
  const handCount = (leftHand ? 1 : 0) + (rightHand ? 1 : 0);

  ctx.save();

  // Background pill
  ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
  ctx.beginPath();
  ctx.roundRect(14, 14, 90, 62, 8);
  ctx.fill();

  // Hand count
  ctx.fillStyle = '#00ffcc';
  ctx.font = 'bold 22px Outfit, sans-serif';
  ctx.fillText(`🖐 ${handCount}`, 24, 40);

  // FPS
  ctx.fillStyle = 'rgba(170, 220, 200, 0.7)';
  ctx.font = '12px Outfit, sans-serif';
  ctx.fillText(`${fps} FPS`, 26, 62);

  ctx.restore();
}

/** Subtle scanlines */
function drawScanlines(ctx, W, H) {
  ctx.save();
  ctx.fillStyle = 'rgba(0, 0, 0, 0.04)';
  for (let y = 0; y < H; y += 4) {
    ctx.fillRect(0, y, W, 1);
  }
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
  const frameCountRef = useRef(0);
  const leftHandRef = useRef(null);
  const rightHandRef = useRef(null);
  const fpsRef = useRef(0);
  const fpsFrames = useRef(0);
  const fpsTime = useRef(performance.now());

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [handsDetected, setHandsDetected] = useState(false);

  const spawnBurst = useCallback((x, y) => {
    const color = PARTICLE_COLORS[Math.floor(Math.random() * PARTICLE_COLORS.length)];
    for (let i = 0; i < 40; i++) {
      if (particlesRef.current.length < MAX_PARTICLES) {
        particlesRef.current.push(new Particle(x, y, color));
      }
    }
  }, []);

  // ── Main render loop ──
  const renderLoop = useCallback(() => {
    const canvas = canvasRef.current;
    const video = videoRef.current;
    if (!canvas || !video) return;

    const ctx = canvas.getContext('2d');
    const W = canvas.width;
    const H = canvas.height;
    frameCountRef.current++;

    // FPS counter
    fpsFrames.current++;
    const now = performance.now();
    if (now - fpsTime.current >= 1000) {
      fpsRef.current = fpsFrames.current;
      fpsFrames.current = 0;
      fpsTime.current = now;
    }

    // ── Draw camera feed as background (clearly visible, mirrored) ──
    if (video.readyState >= 2) {
      ctx.save();
      ctx.translate(W, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(video, 0, 0, W, H);
      ctx.restore();
    } else {
      ctx.fillStyle = '#111';
      ctx.fillRect(0, 0, W, H);
    }

    // Slight dim overlay for contrast
    ctx.save();
    ctx.fillStyle = 'rgba(0, 0, 20, 0.15)';
    ctx.fillRect(0, 0, W, H);
    ctx.restore();

    const leftHand = leftHandRef.current;
    const rightHand = rightHandRef.current;

    // ── LEFT HAND ──
    if (leftHand) {
      drawHandMesh(ctx, leftHand, LEFT_COLOR.mesh, W, H);
      drawHandSkeleton(ctx, leftHand, LEFT_COLOR.main, W, H);
      drawAllJoints(ctx, leftHand, LEFT_COLOR.joint, W, H);
    }

    // ── RIGHT HAND ──
    if (rightHand) {
      drawHandMesh(ctx, rightHand, RIGHT_COLOR.mesh, W, H);
      drawHandSkeleton(ctx, rightHand, RIGHT_COLOR.main, W, H);
      drawAllJoints(ctx, rightHand, RIGHT_COLOR.joint, W, H);
    }

    // ── INTER-HAND BEAMS ──
    if (leftHand && rightHand) {

      // Subtle thread web: every fingertip cross
      let threadIdx = 0;
      for (const [li, ri] of ALL_BEAM_PAIRS) {
        if (li === ri) continue; // skip primary pairs for threads
        const lm1 = leftHand[li];
        const lm2 = rightHand[ri];
        const x1 = lm1.x * W, y1 = lm1.y * H;
        const x2 = lm2.x * W, y2 = lm2.y * H;
        const dist = lmDist(lm1, lm2);
        const color = BEAM_COLORS[threadIdx % BEAM_COLORS.length];
        drawThread(ctx, x1, y1, x2, y2, dist, color, 0.1);
        threadIdx++;
      }

      // Primary rainbow beams: matching fingertips
      for (let i = 0; i < FINGERTIP_IDS.length; i++) {
        const id = FINGERTIP_IDS[i];
        const lm1 = leftHand[id];
        const lm2 = rightHand[id];
        const x1 = lm1.x * W, y1 = lm1.y * H;
        const x2 = lm2.x * W, y2 = lm2.y * H;
        const dist = lmDist(lm1, lm2);

        drawRainbowBeam(ctx, x1, y1, x2, y2, dist, i);

        if (dist < TOUCH_DIST && frameCountRef.current % 3 === 0) {
          spawnBurst((x1 + x2) / 2, (y1 + y2) / 2);
        }
      }

      // Secondary beams: knuckle pairs
      for (let i = 0; i < FINGER_MCP.length; i++) {
        const id = FINGER_MCP[i];
        const lm1 = leftHand[id];
        const lm2 = rightHand[id];
        const x1 = lm1.x * W, y1 = lm1.y * H;
        const x2 = lm2.x * W, y2 = lm2.y * H;
        const dist = lmDist(lm1, lm2);

        ctx.save();
        ctx.globalAlpha = 0.5;
        drawRainbowBeam(ctx, x1, y1, x2, y2, dist, i + 5);
        ctx.restore();
      }

      // Wrist beam
      {
        const lm1 = leftHand[0];
        const lm2 = rightHand[0];
        const dist = lmDist(lm1, lm2);
        ctx.save();
        ctx.globalAlpha = 0.35;
        drawRainbowBeam(ctx, lm1.x * W, lm1.y * H, lm2.x * W, lm2.y * H, dist, 7);
        ctx.restore();
      }

      // Cross-finger particle bursts
      for (const id of FINGERTIP_IDS) {
        for (const id2 of FINGERTIP_IDS) {
          if (id === id2) continue;
          const d = lmDist(leftHand[id], rightHand[id2]);
          if (d < TOUCH_DIST * 0.8 && frameCountRef.current % 5 === 0) {
            const mx = (leftHand[id].x * W + rightHand[id2].x * W) / 2;
            const my = (leftHand[id].y * H + rightHand[id2].y * H) / 2;
            spawnBurst(mx, my);
          }
        }
      }
    }

    // ── Particles ──
    particlesRef.current = particlesRef.current.filter((p) => p.alive);
    for (const p of particlesRef.current) {
      p.update();
      p.draw(ctx);
    }

    // ── Post-processing ──
    drawScanlines(ctx, W, H);
    drawHUD(ctx, leftHand, rightHand, fpsRef.current);

    rafRef.current = requestAnimationFrame(renderLoop);
  }, [spawnBurst]);

  // Resize
  useEffect(() => {
    const handleResize = () => {
      const canvas = canvasRef.current;
      if (canvas) {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
      }
    };
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // MediaPipe + Camera
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    let isMounted = true;
    let pollTimer = null;

    function init() {
      if (!window.Hands || !window.Camera) {
        pollTimer = setTimeout(init, 100);
        return;
      }

      const hands = new window.Hands({
        locateFile: (file) =>
          `https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4/${file}`,
      });

      hands.setOptions({
        maxNumHands: 2,
        modelComplexity: 1,
        minDetectionConfidence: 0.4,
        minTrackingConfidence: 0.3,
      });

      hands.onResults((results) => {
        if (!isMounted) return;

        leftHandRef.current = null;
        rightHandRef.current = null;

        if (results.multiHandLandmarks && results.multiHandedness) {
          for (let i = 0; i < results.multiHandLandmarks.length; i++) {
            const label = results.multiHandedness[i].label;
            if (label === 'Left') {
              rightHandRef.current = results.multiHandLandmarks[i];
            } else {
              leftHandRef.current = results.multiHandLandmarks[i];
            }
          }
        }

        if (leftHandRef.current || rightHandRef.current) {
          setHandsDetected(true);
        }
      });

      handsRef.current = hands;

      const cam = new window.Camera(video, {
        onFrame: async () => {
          await hands.send({ image: video });
        },
        width: 1280,
        height: 720,
      });

      cameraRef.current = cam;

      cam
        .start()
        .then(() => { if (isMounted) setLoading(false); })
        .catch((err) => {
          if (isMounted) {
            setError('Camera access was denied or is unavailable.');
            setLoading(false);
            console.error(err);
          }
        });
    }

    init();

    return () => {
      isMounted = false;
      if (pollTimer) clearTimeout(pollTimer);
      cameraRef.current?.stop?.();
      handsRef.current?.close?.();
    };
  }, []);

  // Render loop
  useEffect(() => {
    rafRef.current = requestAnimationFrame(renderLoop);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [renderLoop]);

  if (error) {
    return (
      <div className="error-overlay">
        <h2>⚠ Camera Error</h2>
        <p>{error}</p>
        <p style={{ marginTop: 12 }}>Please allow camera access and reload the page.</p>
      </div>
    );
  }

  return (
    <>
      <div className={`loading-overlay ${loading ? '' : 'hidden'}`}>
        <div className="loader-ring" />
        <p>Initializing Hand Tracking…</p>
      </div>

      <div className={`instructions ${handsDetected ? 'fade' : ''}`}>
        Bring both hands into the frame to see the magic ✨
      </div>

      <video ref={videoRef} style={{ display: 'none' }} playsInline />

      <div className="cradle-wrapper">
        <canvas ref={canvasRef} className="cradle-canvas" />
      </div>
    </>
  );
}
