// logic.js (v=20260126_SMOOTH_SAFE_INPUT)
// - Open cells ONLY on left click / tap
// - RMB = pan on PC (ONLY after first click)
// - Mobile pan = press+hold then drag (ONLY after first click)
// - Wheel zoom + pinch zoom smooth; never triggers cell
// - Intro: no movement/zoom/pan; board centered + fully visible

if (window.Telegram?.WebApp) {
  try { Telegram.WebApp.ready(); Telegram.WebApp.expand(); } catch (_) {}
}

const ROWS = 32;
const COLS = 18;
const NUM_MINES = 150;

const DIR8 = [
  [-1,-1], [-1,0], [-1,1],
  [ 0,-1],         [ 0,1],
  [ 1,-1], [ 1,0], [ 1,1],
];

let board = [];
let revealedCount = 0;

let mode = "reveal";
let minesExist = false;
let safeZoneLocked = false;
let gameOver = false;

let hasStarted = false;

// ===== Camera =====
let zoom = 1;
const ZOOM_MIN = 0.10;
const ZOOM_MAX = 3.0;

// smooth wheel
let wheelRAF = 0;
let wheelTargetZoom = 1;

// gesture state
let pointers = new Map(); // pointerId -> {x,y}
let pinch = null;         // {startDist, startZoom, cx, cy}
let suppressTapUntil = 0;

let panState = null;      // for RMB pan / mobile hold-pan
let holdTimer = 0;
const HOLD_TO_PAN_MS = 140;     // mobile "hold to pan"
const MOVE_THRESH_PX = 10;

// ===== DOM =====
const boardEl = document.getElementById("board");
const bombEl = document.getElementById("bomb-count");
const toggleBtn = document.getElementById("toggle-mode");
const restartBtn = document.getElementById("restart-btn");
const gameContainer = document.getElementById("game-container");
const hudEl = document.getElementById("hud");

// stop context menu everywhere (RMB is pan)
document.addEventListener("contextmenu", (e) => e.preventDefault(), { capture: true });

// ===== HUD spacer =====
function syncHudSpace(){
  if (!hudEl) return;
  const h = Math.ceil(hudEl.getBoundingClientRect().height);
  document.documentElement.style.setProperty("--hudSpace", `${h}px`);
}
function syncHudSpaceBurst(){
  syncHudSpace();
  requestAnimationFrame(syncHudSpace);
  setTimeout(syncHudSpace, 60);
  setTimeout(syncHudSpace, 220);
}
if (window.ResizeObserver && hudEl){
  new ResizeObserver(syncHudSpaceBurst).observe(hudEl);
}
window.addEventListener("resize", () => { syncHudSpaceBurst(); if (!hasStarted) fitIntro(); });
window.addEventListener("orientationchange", () => { syncHudSpaceBurst(); if (!hasStarted) fitIntro(); });
if (window.Telegram?.WebApp?.onEvent){
  Telegram.WebApp.onEvent("viewportChanged", () => { syncHudSpaceBurst(); if (!hasStarted) fitIntro(); });
}

// ===== Helpers =====
function clamp(v, a, b){ return Math.max(a, Math.min(b, v)); }
function now(){ return Date.now(); }

function inBounds(r,c){ return r>=0 && r<ROWS && c>=0 && c<COLS; }
function forEachNeighbor(r,c,fn){
  for (const [dr,dc] of DIR8){
    const nr=r+dr, nc=c+dc;
    if (inBounds(nr,nc)) fn(nr,nc);
  }
}

// ===== Game =====
function createEmptyBoard(){
  board = Array.from({length: ROWS}, () =>
    Array.from({length: COLS}, () => ({ mine:false, revealed:false, flagged:false, value:0 }))
  );
  revealedCount = 0;
  minesExist = false;
  safeZoneLocked = false;
  gameOver = false;
  hasStarted = false;
}

function placeMinesAnywhere(){
  let placed = 0;
  while (placed < NUM_MINES){
    const r = (Math.random()*ROWS)|0;
    const c = (Math.random()*COLS)|0;
    if (board[r][c].mine) continue;
    board[r][c].mine = true;
    placed++;
  }
}

function ensureMinefieldExists(){
  if (!minesExist){
    minesExist = true;
    placeMinesAnywhere();
  }
}

function enforceSafeZone(sr, sc){
  const safe = new Set();
  for (let r=sr-1;r<=sr+1;r++){
    for (let c=sc-1;c<=sc+1;c++){
      if (inBounds(r,c)) safe.add(`${r},${c}`);
    }
  }

  const toMove = [];
  for (const key of safe){
    const [r,c] = key.split(",").map(Number);
    if (board[r][c].mine) toMove.push([r,c]);
  }

  for (const [r,c] of toMove) board[r][c].mine = false;

  let moved = 0;
  while (moved < toMove.length){
    const r = (Math.random()*ROWS)|0;
    const c = (Math.random()*COLS)|0;
    if (safe.has(`${r},${c}`)) continue;
    if (board[r][c].mine) continue;
    board[r][c].mine = true;
    moved++;
  }
}

function calcValues(){
  for (let r=0;r<ROWS;r++){
    for (let c=0;c<COLS;c++){
      const cell = board[r][c];
      if (cell.mine) { cell.value = 0; continue; }
      let v = 0;
      forEachNeighbor(r,c,(nr,nc)=>{ if (board[nr][nc].mine) v++; });
      cell.value = v;
    }
  }
}

function countFlags(){
  let f=0;
  for (let r=0;r<ROWS;r++) for (let c=0;c<COLS;c++) if (board[r][c].flagged) f++;
  return f;
}

function updateBombHud(){
  bombEl.textContent = `Bombs: ${NUM_MINES - countFlags()}`;
}

// ===== Responsive cells =====
function syncCellSizeToScreen(){
  const margin = 20;
  const w = Math.max(window.innerWidth || 0, document.documentElement.clientWidth || 0, 360);
  let cell = Math.floor((w - margin) / COLS);
  if (!Number.isFinite(cell) || cell < 14) cell = 14;
  if (cell > 32) cell = 32;
  document.documentElement.style.setProperty("--cell", `${cell}px`);
  boardEl.style.gridTemplateColumns = `repeat(${COLS}, ${cell}px)`;
}

// ===== Intro lock/unlock =====
function lockIntro(){
  gameContainer.classList.add("intro-lock");
  gameContainer.classList.remove("pan-ready");
  gameContainer.classList.remove("grabbing");

  boardEl.classList.add("intro-fit");
  // in intro we use zoomOut via CSS (centered with translate)
  document.documentElement.style.setProperty("--zoom", "1");
  zoom = 1;
}

function unlockIntro(){
  gameContainer.classList.remove("intro-lock");
  gameContainer.classList.add("pan-ready");

  boardEl.classList.remove("intro-fit");
  // after intro: pure scale, no translate
  document.documentElement.style.setProperty("--zoom", zoom.toFixed(4));
}

function fitIntro(){
  requestAnimationFrame(() => {
    // measure unscaled board size
    const boardW = boardEl.scrollWidth;
    const boardH = boardEl.scrollHeight;

    const viewW = gameContainer.clientWidth - 20;
    const viewH = gameContainer.clientHeight - 20;

    let z = Math.min(viewW / boardW, viewH / boardH);

    // extra zoom-out
    z *= 0.78;
    z = clamp(z, 0.06, 1);

    document.documentElement.style.setProperty("--zoomOut", z.toFixed(4));

    // keep scroll deterministic even if TG tries to start at 0,0
    gameContainer.scrollLeft = 0;
    gameContainer.scrollTop = 0;

    lockIntro();
  });
}

// ===== DOM build =====
function buildFieldDOM(){
  syncHudSpaceBurst();
  syncCellSizeToScreen();

  boardEl.innerHTML = "";
  boardEl.style.gridTemplateColumns = `repeat(${COLS}, var(--cell))`;

  const frag = document.createDocumentFragment();
  for (let r=0;r<ROWS;r++){
    for (let c=0;c<COLS;c++){
      const el = document.createElement("div");
      el.className = "cell";
      el.dataset.r = String(r);
      el.dataset.c = String(c);
      frag.appendChild(el);
    }
  }
  boardEl.appendChild(frag);

  // reset zoom + scroll
  zoom = 1;
  document.documentElement.style.setProperty("--zoom", "1");
  gameContainer.scrollLeft = 0;
  gameContainer.scrollTop = 0;

  hasStarted = false;
  fitIntro();

  // TG late layout
  setTimeout(() => { if (!hasStarted) fitIntro(); }, 140);
  setTimeout(() => { if (!hasStarted) fitIntro(); }, 360);
}

// ===== Render =====
function renderCell(el, r, c){
  const cell = board[r][c];
  el.classList.remove("revealed","flagged");
  el.textContent = "";

  if (cell.revealed){
    el.classList.add("revealed");
    el.textContent = cell.mine ? "💣" : (cell.value || "");
  } else if (cell.flagged){
    el.classList.add("flagged");
    el.textContent = "🚩";
  }
}

function renderAll(){
  const cells = boardEl.querySelectorAll(".cell");
  let i = 0;
  for (let r=0;r<ROWS;r++){
    for (let c=0;c<COLS;c++){
      renderCell(cells[i++], r, c);
    }
  }
  updateBombHud();
}

function revealAllMines(){
  for (let r=0;r<ROWS;r++) for (let c=0;c<COLS;c++) if (board[r][c].mine) board[r][c].revealed = true;
}

function lose(){
  gameOver = true;
  revealAllMines();
  renderAll();
  setTimeout(()=>alert("Game Over!"), 10);
}

function winCheck(){
  if (revealedCount === ROWS*COLS - NUM_MINES){
    gameOver = true;
    renderAll();
    setTimeout(()=>alert("You Win!"), 10);
  }
}

// ===== Actions =====
function toggleFlag(r,c){
  const cell = board[r][c];
  if (cell.revealed) return;
  cell.flagged = !cell.flagged;
}

function floodReveal(sr, sc){
  const stack = [[sr, sc]];
  while (stack.length){
    const [r,c] = stack.pop();
    if (!inBounds(r,c)) continue;

    const cell = board[r][c];
    if (cell.revealed || cell.flagged || cell.mine) continue;

    cell.revealed = true;
    revealedCount++;

    if (cell.value === 0){
      forEachNeighbor(r,c,(nr,nc)=>{
        const n = board[nr][nc];
        if (!n.revealed && !n.flagged) stack.push([nr,nc]);
      });
    }
  }
}

function reveal(r,c){
  const cell = board[r][c];
  if (cell.revealed || cell.flagged) return;

  ensureMinefieldExists();

  if (!safeZoneLocked){
    safeZoneLocked = true;
    enforceSafeZone(r,c);
    calcValues();
  }

  if (cell.mine){
    cell.revealed = true;
    lose();
    return;
  }

  if (cell.value === 0) floodReveal(r,c);
  else { cell.revealed = true; revealedCount++; }

  winCheck();
}

function flaggedNeighbors(r,c){
  let f=0;
  forEachNeighbor(r,c,(nr,nc)=>{ if (board[nr][nc].flagged) f++; });
  return f;
}

function hiddenUnflaggedNeighbors(r,c){
  const out = [];
  forEachNeighbor(r,c,(nr,nc)=>{
    const n = board[nr][nc];
    if (!n.revealed && !n.flagged) out.push([nr,nc]);
  });
  return out;
}

function chordReveal(r,c){
  const cell = board[r][c];
  if (!cell.revealed || cell.value <= 0) return;
  if (flaggedNeighbors(r,c) !== cell.value) return;

  const targets = hiddenUnflaggedNeighbors(r,c);
  for (const [nr,nc] of targets){
    const n = board[nr][nc];
    if (n.mine){
      n.revealed = true;
      lose();
      return;
    }
    if (n.value === 0) floodReveal(nr,nc);
    else if (!n.revealed){ n.revealed = true; revealedCount++; }
    if (gameOver) return;
  }
  winCheck();
}

function smartQuickAction(r, c){
  const cell = board[r][c];
  if (!cell.revealed) return false;

  const flagged = flaggedNeighbors(r, c);
  const hiddenUnflagged = hiddenUnflaggedNeighbors(r, c);

  if (cell.value > 0){
    const need = cell.value - flagged;

    if (need > 0 && need === hiddenUnflagged.length){
      for (const [nr, nc] of hiddenUnflagged) board[nr][nc].flagged = true;
      return true;
    }

    if (flagged === cell.value){
      chordReveal(r, c);
      return true;
    }
  }

  if (cell.value === 0 && hiddenUnflagged.length > 0){
    for (const [nr, nc] of hiddenUnflagged){
      reveal(nr, nc);
      if (gameOver) return true;
    }
    return true;
  }

  return false;
}

// ===== Zoom (pure scale after intro) =====
function setZoom(newZoom, clientX, clientY){
  newZoom = clamp(newZoom, ZOOM_MIN, ZOOM_MAX);

  const rect = gameContainer.getBoundingClientRect();
  const x = clientX - rect.left;
  const y = clientY - rect.top;

  // content point under cursor before zoom
  const contentX = (gameContainer.scrollLeft + x) / zoom;
  const contentY = (gameContainer.scrollTop  + y) / zoom;

  zoom = newZoom;
  document.documentElement.style.setProperty("--zoom", zoom.toFixed(4));

  // keep that content point under cursor
  gameContainer.scrollLeft = contentX * zoom - x;
  gameContainer.scrollTop  = contentY * zoom - y;
}

// ===== Input rules you requested =====
// - BEFORE first click: NO pan/zoom at all; only left click/tap opens.
// - AFTER first click:
//   - left click/tap opens cells
//   - right click drag pans (PC)
//   - hold+drag pans (mobile)
//   - wheel zoom / pinch zoom smooth

function isLeftMouseOpen(e){
  return e.pointerType === "mouse" ? (e.button === 0) : true;
}
function isRightMousePan(e){
  return e.pointerType === "mouse" && e.button === 2;
}

function clearHoldTimer(){
  if (holdTimer) { clearTimeout(holdTimer); holdTimer = 0; }
}

gameContainer.addEventListener("wheel", (e) => {
  // no zoom before first click
  if (!hasStarted) return;

  e.preventDefault();

  const factor = Math.exp(-e.deltaY * 0.0014);
  wheelTargetZoom = clamp(zoom * factor, ZOOM_MIN, ZOOM_MAX);

  if (!wheelRAF){
    wheelRAF = requestAnimationFrame(() => {
      wheelRAF = 0;
      setZoom(wheelTargetZoom, e.clientX, e.clientY);
      suppressTapUntil = now() + 220;
    });
  }
}, { passive: false });

// pointerdown on camera
gameContainer.addEventListener("pointerdown", (e) => {
  if (gameOver) return;

  // before first click: ignore all movement + zoom gestures
  // but we still allow a left click/tap to open a cell
  if (!hasStarted){
    // store pointer just so pinch doesn’t start
    pointers.clear();
    pinch = null;
    panState = null;
    return;
  }

  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

  // pinch start (2 fingers)
  if (pointers.size === 2){
    const pts = [...pointers.values()];
    const dx = pts[0].x - pts[1].x;
    const dy = pts[0].y - pts[1].y;
    pinch = { startDist: Math.hypot(dx, dy), startZoom: zoom };
    suppressTapUntil = now() + 250;
    clearHoldTimer();
    return;
  }

  // PC: RMB drag pan only
  if (isRightMousePan(e)){
    panState = {
      id: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      startLeft: gameContainer.scrollLeft,
      startTop: gameContainer.scrollTop,
      moved: false,
      panEnabled: true
    };
    gameContainer.classList.add("grabbing");
    suppressTapUntil = now() + 250;
    return;
  }

  // Mobile: hold-to-pan (one finger)
  if (e.pointerType !== "mouse"){
    panState = {
      id: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      startLeft: gameContainer.scrollLeft,
      startTop: gameContainer.scrollTop,
      moved: false,
      panEnabled: false // becomes true after hold
    };

    clearHoldTimer();
    holdTimer = setTimeout(() => {
      if (panState && panState.id === e.pointerId){
        panState.panEnabled = true;
        suppressTapUntil = now() + 300;
      }
    }, HOLD_TO_PAN_MS);
  }

  try { gameContainer.setPointerCapture(e.pointerId); } catch(_) {}
}, true);

gameContainer.addEventListener("pointermove", (e) => {
  if (!hasStarted) return;
  if (!pointers.has(e.pointerId)) return;

  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

  // pinch zoom
  if (pointers.size === 2 && pinch){
    e.preventDefault();
    const pts = [...pointers.values()];
    const cx = (pts[0].x + pts[1].x) / 2;
    const cy = (pts[0].y + pts[1].y) / 2;

    const dx = pts[0].x - pts[1].x;
    const dy = pts[0].y - pts[1].y;
    const dist = Math.hypot(dx, dy);

    const factor = dist / (pinch.startDist || dist);
    setZoom(pinch.startZoom * factor, cx, cy);

    suppressTapUntil = now() + 250;
    clearHoldTimer();
    return;
  }

  // pan
  if (panState && panState.id === e.pointerId){
    const dx = e.clientX - panState.startX;
    const dy = e.clientY - panState.startY;

    if (!panState.moved && (dx*dx + dy*dy) > (MOVE_THRESH_PX*MOVE_THRESH_PX)){
      panState.moved = true;
    }

    if (panState.panEnabled){
      e.preventDefault();
      gameContainer.scrollLeft = panState.startLeft - dx;
      gameContainer.scrollTop  = panState.startTop  - dy;
      suppressTapUntil = now() + 250;
    }
  }
}, { passive: false, capture: true });

gameContainer.addEventListener("pointerup", (e) => {
  clearHoldTimer();

  if (!hasStarted){
    // intro: left click/tap opens cell, nothing else
    if (isLeftMouseOpen(e)){
      const target = document.elementFromPoint(e.clientX, e.clientY);
      const cellDiv = target?.closest?.(".cell");
      if (cellDiv) handleCellOpen(cellDiv, e.clientX, e.clientY);
    }
    return;
  }

  pointers.delete(e.pointerId);
  if (pointers.size < 2) pinch = null;

  // end pan
  if (panState && panState.id === e.pointerId){
    if (e.pointerType === "mouse") gameContainer.classList.remove("grabbing");
    const moved = panState.moved;
    const panEnabled = panState.panEnabled;
    panState = null;

    // if pan was enabled/moved -> no tap
    if (panEnabled || moved) return;
  }

  // suppress taps right after pinch/zoom/pan
  if (now() < suppressTapUntil) return;

  // open cell ONLY on left click / tap
  if (isLeftMouseOpen(e)){
    const target = document.elementFromPoint(e.clientX, e.clientY);
    const cellDiv = target?.closest?.(".cell");
    if (cellDiv) handleCellOpen(cellDiv, e.clientX, e.clientY);
  }
}, true);

gameContainer.addEventListener("pointercancel", () => {
  clearHoldTimer();
  pointers.clear();
  pinch = null;
  panState = null;
  gameContainer.classList.remove("grabbing");
}, true);

// ===== Only this function opens cells =====
function handleCellOpen(cellDiv, clientX, clientY){
  if (gameOver) return;

  const r = parseInt(cellDiv.dataset.r, 10);
  const c = parseInt(cellDiv.dataset.c, 10);
  const cell = board[r][c];

  ensureMinefieldExists();

  // revealed -> quick action
  if (cell.revealed){
    if (smartQuickAction(r, c)) renderAll();
    return;
  }

  // flag mode (still left click/tap)
  if (mode === "flag"){
    toggleFlag(r, c);
    renderAll();
    return;
  }

  // first click: unlock movement + switch from intro-fit to real zoom
  if (!hasStarted){
    hasStarted = true;

    // set a slightly higher initial zoom than 1
    zoom = 1.12;
    unlockIntro();
    document.documentElement.style.setProperty("--zoom", zoom.toFixed(4));

    // center where user clicked (no smooth scroll; stable)
    setZoom(zoom, clientX, clientY);

    // block accidental immediate gestures
    suppressTapUntil = now() + 200;

    // now panning is allowed
  }

  reveal(r, c);
  renderAll();
}

// ===== UI =====
function updateModeText(){
  toggleBtn.textContent = (mode === "reveal") ? "Switch to Flag Mode" : "Switch to Reveal Mode";
}
toggleBtn.addEventListener("click", ()=>{
  mode = (mode === "reveal") ? "flag" : "reveal";
  updateModeText();
});

restartBtn.addEventListener("click", ()=>{
  // hard reset everything
  pointers.clear();
  pinch = null;
  panState = null;
  suppressTapUntil = 0;
  clearHoldTimer();

  createEmptyBoard();
  buildFieldDOM();
  renderAll();
  updateModeText();
});

// ===== INIT =====
syncHudSpaceBurst();
createEmptyBoard();
buildFieldDOM();
renderAll();
updateModeText();
