/* ============================================
   HAND DIMENSION — CORE ENGINE
   Developer: Karndeep Baror
   Ultra-level hand-tracking digital reality
============================================ */

"use strict";

// ─── STATE ────────────────────────────────
const STATE = {
  tool: "draw",
  color: "#00f5ff",
  drawing: false,
  frozen: false,
  lastX: null, lastY: null,
  gesture: "NONE",
  handPresent: false,
  fps: 0,
  frameCount: 0,
  lastFpsTime: performance.now(),
  points: 0,
  particles: [],
  webNodes: [],
  webConnections: [],
  trailPoints: [],
  orbitAngle: 0,
  orbitPulse: 0,
  palmX: 0, palmY: 0,
  fingerTips: [],
  prevFingerTips: [],
  glowTrails: [],
  ripples: [],
};

// ─── CANVASES ─────────────────────────────
const video      = document.getElementById("input-video");
const canvasBg   = document.getElementById("canvas-bg");
const canvasDraw = document.getElementById("canvas-draw");
const canvasOver = document.getElementById("canvas-overlay");
const ctxBg      = canvasBg.getContext("2d");
const ctxDraw    = canvasDraw.getContext("2d");
const ctxOver    = canvasOver.getContext("2d");
const orbitCanvas= document.getElementById("orbit-canvas");
const ctxOrbit   = orbitCanvas.getContext("2d");
const orbitCont  = document.getElementById("orbit-container");

// ─── UI REFS ─────────────────────────────
const bootScreen  = document.getElementById("boot-screen");
const appEl       = document.getElementById("app");
const permScreen  = document.getElementById("perm-screen");
const permBtn     = document.getElementById("perm-btn");
const bootFill    = document.getElementById("boot-fill");
const bootStatus  = document.getElementById("boot-status");
const gestureIcon = document.getElementById("gesture-icon");
const gestureName = document.getElementById("gesture-name");
const statFps     = document.getElementById("stat-fps");
const statHands   = document.getElementById("stat-hands");
const statPoints  = document.getElementById("stat-points");
const hudLabel    = document.getElementById("hud-mode-label");

// ─── RESIZE ──────────────────────────────
function resizeAll() {
  const w = window.innerWidth, h = window.innerHeight;
  [canvasBg, canvasDraw, canvasOver].forEach(c => { c.width = w; c.height = h; });
}
resizeAll();
window.addEventListener("resize", resizeAll);

// ─── BOOT SEQUENCE ───────────────────────
const BOOT_MESSAGES = [
  "INITIALIZING NEURAL CORE...",
  "LOADING HAND-TRACKING MODEL...",
  "CALIBRATING DEPTH SENSORS...",
  "SYNCING GESTURE DATABASE...",
  "LAUNCHING PARTICLE ENGINE...",
  "MAPPING DIGITAL SPACE...",
  "READY.",
];

async function runBoot() {
  for (let i = 0; i < BOOT_MESSAGES.length; i++) {
    bootStatus.textContent = BOOT_MESSAGES[i];
    bootFill.style.width = `${((i + 1) / BOOT_MESSAGES.length) * 100}%`;
    await sleep(i === BOOT_MESSAGES.length - 1 ? 600 : 380);
  }
  await sleep(400);
  bootScreen.style.transition = "opacity 0.8s";
  bootScreen.style.opacity = "0";
  await sleep(800);
  bootScreen.classList.add("hidden");
  permScreen.classList.remove("hidden");
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ─── CAMERA & MEDIAPIPE ──────────────────
let hands;

async function initCamera() {
  permScreen.classList.add("hidden");
  appEl.classList.remove("hidden");

  hands = new Hands({ locateFile: f =>
    `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${f}` });

  hands.setOptions({
    maxNumHands: 1,
    modelComplexity: 1,
    minDetectionConfidence: 0.75,
    minTrackingConfidence: 0.75,
  });

  hands.onResults(onResults);

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } }
    });
    video.srcObject = stream;
    video.onloadedmetadata = () => {
      video.play();
      startProcessing();
    };
  } catch (e) {
    alert("Camera permission denied. Please allow camera access and refresh.");
  }
}

function startProcessing() {
  const cam = new Camera(video, {
    onFrame: async () => { await hands.send({ image: video }); },
    width: 1280, height: 720,
  });
  cam.start();
  requestAnimationFrame(loop);
}

// ─── MEDIAPIPE RESULTS ───────────────────
function onResults(results) {
  if (!results.multiHandLandmarks || results.multiHandLandmarks.length === 0) {
    STATE.handPresent = false;
    STATE.fingerTips = [];
    STATE.drawing = false;
    STATE.lastX = null; STATE.lastY = null;
    updateGesture("NONE");
    return;
  }

  STATE.handPresent = true;
  const lm = results.multiHandLandmarks[0];
  const W = canvasDraw.width, H = canvasDraw.height;

  // Mirror X for selfie feel
  const mx = lm => ({ x: 1 - lm.x, y: lm.y, z: lm.z });

  const tips = [
    mx(lm[8]),  // index
    mx(lm[12]), // middle
    mx(lm[16]), // ring
    mx(lm[20]), // pinky
    mx(lm[4]),  // thumb
  ];
  STATE.prevFingerTips = [...STATE.fingerTips];
  STATE.fingerTips = tips.map(t => ({ x: t.x * W, y: t.y * H }));

  const palm = mx(lm[0]);
  STATE.palmX = palm.x * W;
  STATE.palmY = palm.y * H;

  // Finger extended detection
  const extended = [
    lm[8].y  < lm[6].y,  // index
    lm[12].y < lm[10].y, // middle
    lm[16].y < lm[14].y, // ring
    lm[20].y < lm[18].y, // pinky
    mx(lm[4]).x < mx(lm[3]).x, // thumb
  ];

  const gesture = detectGesture(extended, lm);
  updateGesture(gesture);
  handleGestureAction(gesture);

  // Position orbit icon
  orbitCont.style.left = `${STATE.palmX - 100}px`;
  orbitCont.style.top  = `${STATE.palmY - 100}px`;
  orbitCont.classList.remove("hidden");

  statHands.textContent = "HAND: ✓";
}

// ─── GESTURE DETECTION ───────────────────
function detectGesture(ext, lm) {
  const [idx, mid, ring, pinky, thumb] = ext;
  const count = [idx, mid, ring, pinky, thumb].filter(Boolean).length;

  if (!idx && !mid && !ring && !pinky)        return "FIST";
  if (idx && mid && ring && pinky && thumb)   return "OPEN_PALM";
  if (idx && !mid && !ring && !pinky)         return "POINT";
  if (idx && mid && !ring && !pinky)          return "PEACE";
  if (thumb && pinky && !idx && !mid && !ring) return "SHAKA";
  if (thumb && idx && !mid && !ring && !pinky) return "GUN";
  if (count >= 3)                             return "THREE_PLUS";
  return "UNKNOWN";
}

const GESTURE_MAP = {
  NONE:       { icon:"🤚", name:"SCANNING...",   color:"rgba(0,245,255,0.5)" },
  POINT:      { icon:"☝️",  name:"DRAW MODE",     color:"#00f5ff" },
  PEACE:      { icon:"✌️",  name:"PARTICLE BURST",color:"#ff006e" },
  OPEN_PALM:  { icon:"🖐️", name:"CLEAR / FREEZE",color:"#ffe600" },
  FIST:       { icon:"✊",  name:"FREEZE",        color:"#bf00ff" },
  SHAKA:      { icon:"🤙", name:"NEURAL WEB",    color:"#7fff00" },
  GUN:        { icon:"👉", name:"RIPPLE BLAST",  color:"#ff006e" },
  THREE_PLUS: { icon:"🖖", name:"SCATTER MODE",  color:"#ffffff" },
  UNKNOWN:    { icon:"✋", name:"GESTURE...",    color:"rgba(0,245,255,0.6)" },
};

function updateGesture(g) {
  if (STATE.gesture === g) return;
  STATE.gesture = g;
  const info = GESTURE_MAP[g] || GESTURE_MAP.UNKNOWN;
  gestureIcon.textContent = info.icon;
  gestureName.textContent = info.name;
  gestureName.style.color = info.color;
}

function handleGestureAction(g) {
  const ix = STATE.fingerTips[0]?.x, iy = STATE.fingerTips[0]?.y;

  switch(g) {
    case "POINT":
      if (STATE.tool !== "draw") break;
      if (STATE.lastX !== null && !STATE.frozen) {
        drawLine(ctxDraw, STATE.lastX, STATE.lastY, ix, iy, STATE.color);
        addGlowTrail(ix, iy);
        STATE.points += 1;
      }
      STATE.lastX = ix; STATE.lastY = iy;
      STATE.drawing = true;
      break;

    case "PEACE":
      spawnParticleBurst(ix, iy, 18);
      STATE.lastX = null; STATE.lastY = null;
      STATE.drawing = false;
      break;

    case "FIST":
      STATE.frozen = true;
      STATE.lastX = null; STATE.lastY = null;
      break;

    case "OPEN_PALM":
      STATE.frozen = false;
      STATE.lastX = null; STATE.lastY = null;
      break;

    case "SHAKA":
      updateWebMode(ix, iy);
      STATE.lastX = null; STATE.lastY = null;
      break;

    case "GUN":
      spawnRipple(ix, iy);
      STATE.lastX = null; STATE.lastY = null;
      break;

    default:
      STATE.lastX = null; STATE.lastY = null;
      STATE.drawing = false;
  }

  if (g !== "POINT") STATE.drawing = false;
  statPoints.textContent = `PTS: ${STATE.points}`;
}

// ─── DRAW LINE ───────────────────────────
function drawLine(ctx, x1, y1, x2, y2, color, width = 3) {
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.shadowBlur = 18;
  ctx.shadowColor = color;
  ctx.globalAlpha = 0.92;
  ctx.stroke();
  ctx.restore();
}

// ─── GLOW TRAIL ──────────────────────────
function addGlowTrail(x, y) {
  STATE.glowTrails.push({ x, y, life: 1.0, color: STATE.color });
}

// ─── PARTICLE BURST ──────────────────────
function spawnParticleBurst(x, y, count) {
  for (let i = 0; i < count; i++) {
    const angle = (Math.PI * 2 * i) / count + Math.random() * 0.5;
    const speed = 2 + Math.random() * 4;
    const hue = Math.random() < 0.5 ? STATE.color : "#ff006e";
    STATE.particles.push({
      x, y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      life: 1.0,
      size: 2 + Math.random() * 3,
      color: hue,
    });
  }
}

// ─── RIPPLE ─────────────────────────────
function spawnRipple(x, y) {
  STATE.ripples.push({ x, y, r: 0, maxR: 180, life: 1.0, color: STATE.color });
}

// ─── NEURAL WEB ──────────────────────────
function updateWebMode(x, y) {
  if (!x || !y) return;
  const now = Date.now();
  STATE.webNodes.push({ x, y, born: now, life: 1.0 });
  if (STATE.webNodes.length > 80) STATE.webNodes.shift();
}

function drawNeuralWeb(ctx) {
  const nodes = STATE.webNodes;
  const MAX_DIST = 160;
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const dx = nodes[i].x - nodes[j].x;
      const dy = nodes[i].y - nodes[j].y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < MAX_DIST) {
        const alpha = (1 - dist / MAX_DIST) * nodes[i].life * nodes[j].life * 0.8;
        ctx.beginPath();
        ctx.moveTo(nodes[i].x, nodes[i].y);
        ctx.lineTo(nodes[j].x, nodes[j].y);
        ctx.strokeStyle = `rgba(127,255,0,${alpha})`;
        ctx.lineWidth = 1;
        ctx.shadowBlur = 6;
        ctx.shadowColor = "#7fff00";
        ctx.stroke();
      }
    }
  }
  nodes.forEach(n => {
    ctx.beginPath();
    ctx.arc(n.x, n.y, 3, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(127,255,0,${n.life})`;
    ctx.shadowBlur = 10;
    ctx.shadowColor = "#7fff00";
    ctx.fill();
  });
}

// ─── ORBIT ICON ──────────────────────────
function drawOrbit() {
  const ctx = ctxOrbit;
  const W = 200, H = 200, cx = 100, cy = 100;
  ctx.clearRect(0, 0, W, H);

  STATE.orbitAngle += 0.025;
  STATE.orbitPulse = Math.sin(STATE.orbitAngle * 2) * 0.5 + 0.5;

  if (!STATE.handPresent) return;

  // Core glow
  const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, 40);
  grad.addColorStop(0, `rgba(0,245,255,${0.3 + STATE.orbitPulse * 0.3})`);
  grad.addColorStop(1, "transparent");
  ctx.beginPath();
  ctx.arc(cx, cy, 40, 0, Math.PI * 2);
  ctx.fillStyle = grad;
  ctx.fill();

  // Central ring
  ctx.beginPath();
  ctx.arc(cx, cy, 20, 0, Math.PI * 2);
  ctx.strokeStyle = `rgba(0,245,255,${0.5 + STATE.orbitPulse * 0.5})`;
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Orbiting dots
  const orbits = [
    { r: 38, speed: 1, size: 4, color: "#00f5ff", count: 3 },
    { r: 56, speed: -0.6, size: 3, color: "#ff006e", count: 4 },
    { r: 70, speed: 0.4, size: 2, color: "#ffe600", count: 5 },
  ];
  orbits.forEach(orb => {
    for (let i = 0; i < orb.count; i++) {
      const ang = STATE.orbitAngle * orb.speed + (Math.PI * 2 * i) / orb.count;
      const ox = cx + Math.cos(ang) * orb.r;
      const oy = cy + Math.sin(ang) * orb.r;
      ctx.beginPath();
      ctx.arc(ox, oy, orb.size, 0, Math.PI * 2);
      ctx.fillStyle = orb.color;
      ctx.shadowBlur = 12;
      ctx.shadowColor = orb.color;
      ctx.fill();
    }
    // Ellipse ring
    ctx.beginPath();
    ctx.ellipse(cx, cy, orb.r, orb.r * 0.3, STATE.orbitAngle * 0.2, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(0,245,255,0.08)`;
    ctx.lineWidth = 1;
    ctx.stroke();
  });
}

// ─── BACKGROUND GRID ─────────────────────
function drawGrid() {
  const ctx = ctxBg;
  const W = canvasBg.width, H = canvasBg.height;
  ctx.clearRect(0, 0, W, H);

  const t = Date.now() / 5000;
  const GRID = 55;

  ctx.strokeStyle = "rgba(0,245,255,0.05)";
  ctx.lineWidth = 1;
  for (let x = 0; x <= W; x += GRID) {
    ctx.beginPath();
    ctx.moveTo(x, 0); ctx.lineTo(x, H);
    ctx.stroke();
  }
  for (let y = 0; y <= H; y += GRID) {
    ctx.beginPath();
    ctx.moveTo(0, y); ctx.lineTo(W, y);
    ctx.stroke();
  }

  // Moving scan line
  const scanY = (H * ((t % 1)));
  const scanGrad = ctx.createLinearGradient(0, scanY - 30, 0, scanY + 30);
  scanGrad.addColorStop(0, "transparent");
  scanGrad.addColorStop(0.5, "rgba(0,245,255,0.07)");
  scanGrad.addColorStop(1, "transparent");
  ctx.fillStyle = scanGrad;
  ctx.fillRect(0, scanY - 30, W, 60);
}

// ─── MAIN LOOP ───────────────────────────
function loop(ts) {
  // FPS
  STATE.frameCount++;
  if (ts - STATE.lastFpsTime >= 1000) {
    STATE.fps = STATE.frameCount;
    STATE.frameCount = 0;
    STATE.lastFpsTime = ts;
    statFps.textContent = `FPS: ${STATE.fps}`;
  }

  // Background
  drawGrid();

  // Overlay canvas clear
  ctxOver.clearRect(0, 0, canvasOver.width, canvasOver.height);

  // ── Particles ──
  STATE.particles = STATE.particles.filter(p => p.life > 0);
  STATE.particles.forEach(p => {
    p.x += p.vx; p.y += p.vy;
    p.vy += 0.08;
    p.life -= 0.02;
    ctxOver.save();
    ctxOver.globalAlpha = p.life;
    ctxOver.beginPath();
    ctxOver.arc(p.x, p.y, p.size * p.life, 0, Math.PI * 2);
    ctxOver.fillStyle = p.color;
    ctxOver.shadowBlur = 12;
    ctxOver.shadowColor = p.color;
    ctxOver.fill();
    ctxOver.restore();
  });

  // ── Ripples ──
  STATE.ripples = STATE.ripples.filter(r => r.life > 0);
  STATE.ripples.forEach(r => {
    r.r += 6;
    r.life -= 0.025;
    const rings = 3;
    for (let i = 0; i < rings; i++) {
      const rr = r.r - i * 22;
      if (rr < 0) continue;
      ctxOver.beginPath();
      ctxOver.arc(r.x, r.y, rr, 0, Math.PI * 2);
      ctxOver.strokeStyle = r.color;
      ctxOver.lineWidth = 1.5;
      ctxOver.globalAlpha = r.life * (1 - i * 0.3);
      ctxOver.shadowBlur = 15;
      ctxOver.shadowColor = r.color;
      ctxOver.stroke();
    }
    ctxOver.globalAlpha = 1;
  });

  // ── Glow trails on draw canvas ──
  STATE.glowTrails = STATE.glowTrails.filter(t => t.life > 0);
  STATE.glowTrails.forEach(t => {
    t.life -= 0.04;
    ctxOver.save();
    ctxOver.globalAlpha = t.life * 0.5;
    ctxOver.beginPath();
    ctxOver.arc(t.x, t.y, 8 * t.life, 0, Math.PI * 2);
    ctxOver.fillStyle = t.color;
    ctxOver.shadowBlur = 20;
    ctxOver.shadowColor = t.color;
    ctxOver.fill();
    ctxOver.restore();
  });

  // ── Web mode (age & fade nodes) ──
  STATE.webNodes.forEach(n => { n.life = Math.max(0, n.life - 0.003); });
  STATE.webNodes = STATE.webNodes.filter(n => n.life > 0.05);
  if (STATE.webNodes.length > 0) {
    ctxOver.save();
    drawNeuralWeb(ctxOver);
    ctxOver.restore();
  }

  // ── Hand fingertip dots ──
  if (STATE.handPresent && STATE.fingerTips.length) {
    STATE.fingerTips.forEach((tip, i) => {
      const colors = ["#00f5ff", "#ff006e", "#ffe600", "#7fff00", "#bf00ff"];
      ctxOver.beginPath();
      ctxOver.arc(tip.x, tip.y, i === 0 && STATE.drawing ? 10 : 6, 0, Math.PI * 2);
      ctxOver.fillStyle = colors[i];
      ctxOver.shadowBlur = 20;
      ctxOver.shadowColor = colors[i];
      ctxOver.globalAlpha = 0.85;
      ctxOver.fill();
      ctxOver.globalAlpha = 1;

      // Cross hair on index
      if (i === 0 && STATE.drawing) {
        ctxOver.strokeStyle = STATE.color;
        ctxOver.lineWidth = 1;
        ctxOver.globalAlpha = 0.5;
        ctxOver.beginPath();
        ctxOver.moveTo(tip.x - 20, tip.y);
        ctxOver.lineTo(tip.x + 20, tip.y);
        ctxOver.moveTo(tip.x, tip.y - 20);
        ctxOver.lineTo(tip.x, tip.y + 20);
        ctxOver.stroke();
        ctxOver.globalAlpha = 1;
      }
    });
  } else {
    orbitCont.classList.add("hidden");
  }

  // ── Orbit icon ──
  drawOrbit();

  // ── HUD mode label ──
  hudLabel.textContent = STATE.frozen ? "⏸ FROZEN" : (GESTURE_MAP[STATE.gesture]?.name || "STANDBY");

  requestAnimationFrame(loop);
}

// ─── TOOL BUTTONS ────────────────────────
document.querySelectorAll(".tool-btn[data-tool]").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tool-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    STATE.tool = btn.dataset.tool;
  });
});

document.querySelectorAll(".color-dot").forEach(dot => {
  dot.addEventListener("click", () => {
    document.querySelectorAll(".color-dot").forEach(d => d.classList.remove("active"));
    dot.classList.add("active");
    STATE.color = dot.dataset.color;
  });
});

document.getElementById("btn-clear").addEventListener("click", () => {
  ctxDraw.clearRect(0, 0, canvasDraw.width, canvasDraw.height);
  STATE.webNodes = [];
  STATE.particles = [];
  STATE.glowTrails = [];
  STATE.ripples = [];
  STATE.points = 0;
  statPoints.textContent = "PTS: 0";
});

// ─── PERMISSION BUTTON ───────────────────
permBtn.addEventListener("click", initCamera);

// ─── LAUNCH ──────────────────────────────
window.addEventListener("load", runBoot);
