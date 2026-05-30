import { useEffect, useRef, useState, useCallback } from 'react';
import { Hands } from '@mediapipe/hands';
import { Camera } from '@mediapipe/camera_utils';
import './CatsCradle.css';

// ─── CONSTANTS ────────────────────────────────────────────
const FINGERTIP_IDS = [4, 8, 12, 16, 20];
const TOUCH_DIST = 0.04;
const MAX_PARTICLES = 600;
const BG_COLOR = '#0b0b2a';

const CYAN = '#00ffff';
const MAGENTA = '#ff00ff';
const YELLOW = '#ffff00';
const COLORS = [CYAN, MAGENTA, YELLOW, '#00ff88', '#ff6600'];

const HAND_CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20],
  [0, 17],
];

const CROSS_PAIRS = [
  [FINGERTIP_IDS[0], FINGERTIP_IDS[4]],
  [FINGERTIP_IDS[1], FINGERTIP_IDS[3]],
];

// ─── PARTICLE ─────────────────────────────────────────────
class Particle {
  constructor(x, y, color) {
    this.x = x;
    this.y = y;
    this.vx = (Math.random() - 0.5) * 8;
    this.vy = (Math.random() - 0.5) * 8;
    this.life = 1;
    this.decay = 0.015 + Math.random() * 0.025;
    this.radius = 1.5 + Math.random() * 3;
    this.color = color;
  }

  update() {
    this.x += this.vx;
    this.y += this.vy;
    this.vx *= 0.97;
    this.vy *= 0.97;
    this.life -= this.decay;
  }

  draw(ctx) {
    if (this.life <= 0) return;
    ctx.save();
    ctx.globalAlpha = this.life;
    ctx.shadowColor = this.color;
    ctx.shadowBlur = 12;
    ctx.fillStyle = this.color;
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.radius * this.life, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  get alive() {
    return this.life > 0;
  }
}

// ─── DRAWING HELPERS ──────────────────────────────────────

function drawJoint(ctx, x, y, color, radius = 5) {
  ctx.save();
  ctx.shadowColor = color;
  ctx.shadowBlur = 18;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  ctx.beginPath();
  ctx.arc(x, y, radius * 0.35, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawLaserBeam(ctx, x1, y1, x2, y2, dist) {
  const t = Math.min(dist / 0.6, 1);
  const baseWidth = 3.5 - t * 2.5;
  const hue = 180 + t * 120;
  const color = `hsl(${hue}, 100%, 60%)`;

  ctx.save();

  // Outer glow
  ctx.strokeStyle = color;
  ctx.shadowColor = color;
  ctx.shadowBlur = 25 + (1 - t) * 20;
  ctx.lineWidth = baseWidth + 4;
  ctx.globalAlpha = 0.25;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();

  // Core beam
  ctx.globalAlpha = 0.85;
  ctx.lineWidth = baseWidth;
  ctx.shadowBlur = 15;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();

  // Inner white-hot core
  ctx.globalAlpha = 0.5;
  ctx.strokeStyle = '#ffffff';
  ctx.shadowColor = '#ffffff';
  ctx.shadowBlur = 6;
  ctx.lineWidth = Math.max(baseWidth * 0.3, 0.5);
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();

  ctx.restore();
}

function drawHandSilhouette(ctx, landmarks, color, W, H) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.shadowColor = color;
  ctx.shadowBlur = 8;
  ctx.lineWidth = 1.8;
  ctx.globalAlpha = 0.35;
  for (const [a, b] of HAND_CONNECTIONS) {
    ctx.beginPath();
    ctx.moveTo(landmarks[a].x * W, landmarks[a].y * H);
    ctx.lineTo(landmarks[b].x * W, landmarks[b].y * H);
    ctx.stroke();
  }
  ctx.restore();
}

function drawScanlines(ctx, W, H) {
  ctx.save();
  ctx.fillStyle = 'rgba(0, 0, 0, 0.06)';
  for (let y = 0; y < H; y += 3) {
    ctx.fillRect(0, y, W, 1);
  }
  ctx.restore();
}

function drawVignette(ctx, W, H) {
  const cx = W / 2;
  const cy = H / 2;
  const r = Math.max(cx, cy) * 1.2;
  const grad = ctx.createRadialGradient(cx, cy, r * 0.3, cx, cy, r);
  grad.addColorStop(0, 'transparent');
  grad.addColorStop(1, 'rgba(0, 0, 0, 0.55)');
  ctx.save();
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);
  ctx.restore();
}

function drawAllJoints(ctx, landmarks, palette, W, H) {
  for (let i = 0; i < landmarks.length; i++) {
    const lm = landmarks[i];
    const isTip = FINGERTIP_IDS.includes(i);
    const color = palette[i % palette.length];
    drawJoint(ctx, lm.x * W, lm.y * H, color, isTip ? 6 : 3.5);
  }
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

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [handsDetected, setHandsDetected] = useState(false);

  // Spawn a particle burst at (x, y)
  const spawnBurst = useCallback((x, y) => {
    const color = COLORS[Math.floor(Math.random() * COLORS.length)];
    for (let i = 0; i < 35; i++) {
      if (particlesRef.current.length < MAX_PARTICLES) {
        particlesRef.current.push(new Particle(x, y, color));
      }
    }
  }, []);

  // Main render loop
  const renderLoop = useCallback(() => {
    const canvas = canvasRef.current;
    const video = videoRef.current;
    if (!canvas || !video) return;

    const ctx = canvas.getContext('2d');
    const W = canvas.width;
    const H = canvas.height;
    frameCountRef.current++;

    // Background
    ctx.fillStyle = BG_COLOR;
    ctx.fillRect(0, 0, W, H);

    // Faint mirrored video
    if (video.readyState >= 2) {
      ctx.save();
      ctx.globalAlpha = 0.08;
      ctx.translate(W, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(video, 0, 0, W, H);
      ctx.restore();
    }

    const leftHand = leftHandRef.current;
    const rightHand = rightHandRef.current;

    // Hand silhouettes
    if (leftHand) drawHandSilhouette(ctx, leftHand, CYAN, W, H);
    if (rightHand) drawHandSilhouette(ctx, rightHand, MAGENTA, W, H);

    // Joints
    if (leftHand) drawAllJoints(ctx, leftHand, [CYAN, '#00ddff', '#00ffaa'], W, H);
    if (rightHand) drawAllJoints(ctx, rightHand, [MAGENTA, '#ff44aa', YELLOW], W, H);

    // Laser beams between fingertips
    if (leftHand && rightHand) {
      for (let i = 0; i < FINGERTIP_IDS.length; i++) {
        const li = FINGERTIP_IDS[i];
        const lm1 = leftHand[li];
        const lm2 = rightHand[li];

        const x1 = lm1.x * W, y1 = lm1.y * H;
        const x2 = lm2.x * W, y2 = lm2.y * H;

        const dx = lm1.x - lm2.x;
        const dy = lm1.y - lm2.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        drawLaserBeam(ctx, x1, y1, x2, y2, dist);

        // Particle burst on touch
        if (dist < TOUCH_DIST && frameCountRef.current % 3 === 0) {
          spawnBurst((x1 + x2) / 2, (y1 + y2) / 2);
        }
      }

      // Cross-strings
      for (const [li, ri] of CROSS_PAIRS) {
        const lm1 = leftHand[li];
        const lm2 = rightHand[ri];
        const x1 = lm1.x * W, y1 = lm1.y * H;
        const x2 = lm2.x * W, y2 = lm2.y * H;
        const dx = lm1.x - lm2.x;
        const dy = lm1.y - lm2.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        ctx.save();
        ctx.globalAlpha = 0.4;
        drawLaserBeam(ctx, x1, y1, x2, y2, dist);
        ctx.restore();
      }
    }

    // Particles
    particlesRef.current = particlesRef.current.filter((p) => p.alive);
    for (const p of particlesRef.current) {
      p.update();
      p.draw(ctx);
    }

    // Post-processing
    drawVignette(ctx, W, H);
    drawScanlines(ctx, W, H);

    rafRef.current = requestAnimationFrame(renderLoop);
  }, [spawnBurst]);

  // Resize handler
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

  // MediaPipe + Camera setup
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    let isMounted = true;

    const hands = new Hands({
      locateFile: (file) =>
        `https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4/${file}`,
    });

    hands.setOptions({
      maxNumHands: 2,
      modelComplexity: 1,
      minDetectionConfidence: 0.65,
      minTrackingConfidence: 0.55,
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

    const cam = new Camera(video, {
      onFrame: async () => {
        await hands.send({ image: video });
      },
      width: 1280,
      height: 720,
    });

    cameraRef.current = cam;

    cam
      .start()
      .then(() => {
        if (isMounted) setLoading(false);
      })
      .catch((err) => {
        if (isMounted) {
          setError('Camera access was denied or is unavailable.');
          setLoading(false);
          console.error(err);
        }
      });

    return () => {
      isMounted = false;
      cam.stop?.();
      hands.close?.();
    };
  }, []);

  // Start / stop render loop
  useEffect(() => {
    rafRef.current = requestAnimationFrame(renderLoop);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [renderLoop]);

  // ─── Error state ───────────────────────────────
  if (error) {
    return (
      <div className="error-overlay">
        <h2>⚠ Camera Error</h2>
        <p>{error}</p>
        <p style={{ marginTop: 12 }}>
          Please allow camera access and reload the page.
        </p>
      </div>
    );
  }

  return (
    <>
      {/* Loading */}
      <div className={`loading-overlay ${loading ? '' : 'hidden'}`}>
        <div className="loader-ring" />
        <p>Initializing Hand Tracking…</p>
      </div>

      {/* Instructions */}
      <div className={`instructions ${handsDetected ? 'fade' : ''}`}>
        Bring both hands into the frame to see the magic ✨
      </div>

      {/* Hidden video */}
      <video ref={videoRef} style={{ display: 'none' }} playsInline />

      {/* Canvas */}
      <div className="cradle-wrapper">
        <canvas ref={canvasRef} className="cradle-canvas" />
      </div>
    </>
  );
}
