// logic.js (v=20260126_CAMERA_ZOOM_PAN)
// - Intro: board fully visible + centered (extra zoom-out)
// - Restart: resets scroll to center + recalcs zoom-out
// - PC: wheel zoom, RMB drag pan
// - Mobile: one-finger drag pan, two-finger pinch zoom
// - No translate() camera (prevents TG Android desync)
// - Gameplay: tap vs drag detection so panning doesn't click cells
// - Hard mode: 150 mines

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

// ===== State =====
let board = [];
let revealedCount = 0;

let mode = "reveal";
let minesExist = false;
let safeZoneLocked = false;
let gameOver = false;

let hasStarted = false;       // first reveal not yet done

// ===== Camera (zoom/pan) =====
let zoom = 1;                 // current zoom
const ZOOM_MIN = 0.08;
const ZOOM_MAX = 3.0;

let pointers = new Map();     // pointerId -> {x,y}
let pinch = null;             // {startDist, startZoom}
let pan = null;               // {id, startX, startY, startLeft, startTop, moved}

// ===== DOM =====
const boardEl = document.getElementById("board");
const bombEl = document.getElementById("bomb-count");
const toggleBtn = document.getElementById("toggle-mode");
const restartBtn = document.getElementById("restart-btn");
const gameContainer = document.getElementById("game-container");
const hudEl = document.getElementById("hud");

// ===== optional banner =====
(() => {
  const b = document.createElement("div");
  b.style.cssText =
    "position:fixed;bottom:0;left:0;right:0;z-index:9999;" +
    "background:#ff006a;color:#fff;padding:6px 10px;font:14px Arial;";
  b.textContent = "LOGIC.JS LOADED v=20260126_CAMERA_ZOOM_PAN";
  document.body.appendChild(b);
})();

// ===== HUD spacer -> CSS var =====
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
function inBounds(r,c){ return r>=0 && r<ROWS && c>=0 && c<COLS; }
function forEachNeighbor(r,c,fn){
  for (const [dr,dc] of DIR8){
    const nr=r+dr, nc=c+dc;
    if (inBounds(nr,nc)) fn(nr,nc);
  }
}

// ===== Game init =====
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

// 3x3 safe zone around first reveal
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
  for (let r=0;r<ROWS;r++){
    for (let c=0;c<COLS;c++){
      if (board[r][c].flagged) f++;
    }
  }
  return f;
}
function updateBombHud(){
  bombEl.textContent = `Bombs: ${NUM_MINES - countFlags()}`;
}

// ===== Responsive cell size =====
function syncCellSizeToScreen(){
  const margin = 20;
  const w = Math.max(window.innerWidth || 0, document.documentElement.clientWidth || 0, 360);

  let cell = Math.floor((w - margin) / COLS);
  if (!Number.isFinite(cell) || cell < 14) cell = 14;
  if (cell > 32) cell = 32;

  document.documentElement.style.setProperty("--cell", `${cell}px`);
  boardEl.style.gridTemplateColumns = `repeat(${COLS}, ${cell}px)`;
}

// ===== Camera: zoom/pan math =====
function clamp(v, a, b){ return Math.max(a, Math.min(b, v)); }

function setZoom(newZoom, clientX, clientY){
  newZoom = clamp(newZoom, ZOOM_MIN, ZOOM_MAX);

  const rect = gameContainer.getBoundingClientRect();
  const x = clientX - rect.left;
  const y = clientY - rect.top;

  // content coordinate under cursor BEFORE zoom
  const contentX = (gameContainer.scrollLeft + x) / zoom;
  const contentY = (gameContainer.scrollTop  + y) / zoom;

  zoom = newZoom;
  document.documentElement.style.setProperty("--zoom", zoom.toFixed(4));

  // keep cursor pinned to same content point
  gameContainer.scrollLeft = contentX * zoom - x;
  gameContainer.scrollTop  = contentY * zoom - y;
}

function centerScroll(){
  requestAnimationFrame(() => {
    const maxX = Math.max(0, gameContainer.scrollWidth  - gameContainer.clientWidth);
    const maxY = Math.max(0, gameContainer.scrollHeight - gameContainer.clientHeight);
    gameContainer.scrollLeft = Math.floor(maxX / 2);
    gameContainer.scrollTop  = Math.floor(maxY / 2);
  });
}

// Intro: lock scroll, fit zoomOut, center
function lockIntro(){
  gameContainer.classList.add("intro-lock");
  boardEl.classList.add("zoomed-out");
}

// After first click: unlock scroll
function unlockIntro(){
  gameContainer.classList.remove("intro-lock");
  boardEl.classList.remove("zoomed-out");
}

// compute zoomOut to fit board in viewport, then apply extra zoom-out
function fitIntro(){
  requestAnimationFrame(() => {
    // temporarily measure board at zoom=1
    const prevZoom = zoom;
    zoom = 1;
    document.documentElement.style.setProperty("--zoom", "1");

    const boardW = boardEl.scrollWidth;
    const boardH = boardEl.scrollHeight;

    const viewW = gameContainer.clientWidth  - 20;
    const viewH = gameContainer.clientHeight - 20;

    let z = Math.min(viewW / boardW, viewH / boardH);

    // EXTRA zoom-out (smaller than perfect fit)
    z *= 0.78; // lower => more zoom-out

    z = clamp(z, 0.06, 1);

    document.documentElement.style.setProperty("--zoomOut", z.toFixed(4));

    // apply intro zoomOut
    lockIntro();
    zoom = z;
    document.documentElement.style.setProperty("--zoom", z.toFixed(4));

    // deterministic camera position
    centerScroll();

    // restore (we keep intro zoom anyway)
    prevZoom; // no-op, kept to show intent
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

      // gameplay tap (we decide tap vs drag in pointer handlers below)
      el.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        if (gameOver) return;
        toggleFlag(r,c);
        renderAll();
      });

      frag.appendChild(el);
    }
  }
  boardEl.appendChild(frag);

  // reset camera hard
  zoom = 1;
  document.documentElement.style.setProperty("--zoom", "1");
  gameContainer.scrollLeft = 0;
  gameContainer.scrollTop = 0;

  // intro
  hasStarted = false;
  fitIntro();

  // Telegram can lay out late; run again
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
  for (let r=0;r<ROWS;r++){
    for (let c=0;c<COLS;c++){
      if (board[r][c].mine) board[r][c].revealed = true;
    }
  }
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

// ===== Gameplay actions =====
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
  let f = 0;
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

    // forced bombs
    if (need > 0 && need === hiddenUnflagged.length){
      for (const [nr, nc] of hiddenUnflagged) board[nr][nc].flagged = true;
      return true;
    }
    // forced safe reveals
    if (flagged === cell.value){
      chordReveal(r, c);
      return true;
    }
  }

  // speed tap on 0
  if (cell.value === 0 && hiddenUnflagged.length > 0){
    for (const [nr, nc] of hiddenUnflagged){
      reveal(nr, nc);
      if (gameOver) return true;
    }
    return true;
  }

  return false;
}

// ===== First-click zoom-in behavior =====
function zoomInOnFirstClick(clientX, clientY){
  // unlock scroll and set a slightly higher default zoom
  unlockIntro();
  const targetZoom = 1.12; // "a little bit higher"
  setZoom(targetZoom, clientX, clientY);
}

// ===== Input: pan + pinch + wheel + tap =====

// disable browser context menu on camera (so RMB drag works)
gameContainer.addEventListener("contextmenu", (e) => e.preventDefault());

// PC wheel zoom
gameContainer.addEventListener("wheel", (e) => {
  e.preventDefault();
  const factor = Math.exp(-e.deltaY * 0.0016);
  setZoom(zoom * factor, e.clientX, e.clientY);
}, { passive: false });

// pointer handlers on camera (capture) so it works even when touching cells
gameContainer.addEventListener("pointerdown", (e) => {
  if (gameOver) return;

  // track pointers (for pinch)
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

  // start pan:
  // - touch: always allowed
  // - mouse: only right button (button===2)
  const allowPan =
    (e.pointerType !== "mouse") ||
    (e.pointerType === "mouse" && e.button === 2);

  if (allowPan){
    pan = {
      id: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      startLeft: gameContainer.scrollLeft,
      startTop: gameContainer.scrollTop,
      moved: false,
      isMouseRMB: (e.pointerType === "mouse" && e.button === 2)
    };
    if (pan.isMouseRMB) gameContainer.classList.add("grabbing");
  }

  // two pointers => pinch start
  if (pointers.size === 2){
    const pts = [...pointers.values()];
    const dx = pts[0].x - pts[1].x;
    const dy = pts[0].y - pts[1].y;
    pinch = {
      startDist: Math.hypot(dx, dy),
      startZoom: zoom
    };
  }

  // capture pointer so moves keep coming
  try { gameContainer.setPointerCapture(e.pointerId); } catch(_){}
}, true);

gameContainer.addEventListener("pointermove", (e) => {
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
    return;
  }

  // one-finger / RMB pan
  if (pan && pan.id === e.pointerId){
    const dx = e.clientX - pan.startX;
    const dy = e.clientY - pan.startY;

    if (!pan.moved && (dx*dx + dy*dy) > (8*8)) pan.moved = true;

    if (pan.moved){
      e.preventDefault();
      gameContainer.scrollLeft = pan.startLeft - dx;
      gameContainer.scrollTop  = pan.startTop  - dy;
    }
  }
}, { passive: false, capture: true });

gameContainer.addEventListener("pointerup", (e) => {
  const wasPan = pan && pan.id === e.pointerId ? pan : null;

  pointers.delete(e.pointerId);
  if (pointers.size < 2) pinch = null;

  // end pan
  if (pan && pan.id === e.pointerId){
    if (pan.isMouseRMB) gameContainer.classList.remove("grabbing");
    pan = null;
  }

  // If it was a tap (not moved) on a cell => gameplay click
  if (wasPan && !wasPan.moved){
    const target = document.elementFromPoint(e.clientX, e.clientY);
    const cellDiv = target?.closest?.(".cell");
    if (cellDiv) handleCellTap(cellDiv, e.clientX, e.clientY);
  }
}, true);

gameContainer.addEventListener("pointercancel", (e) => {
  pointers.delete(e.pointerId);
  pinch = null;
  if (pan && pan.id === e.pointerId){
    if (pan.isMouseRMB) gameContainer.classList.remove("grabbing");
    pan = null;
  }
}, true);

// ===== Gameplay tap handler (called after camera decides it's a tap) =====
function handleCellTap(cellDiv, clientX, clientY){
  if (gameOver) return;

  const r = parseInt(cellDiv.dataset.r, 10);
  const c = parseInt(cellDiv.dataset.c, 10);
  const cell = board[r][c];

  ensureMinefieldExists();

  // revealed => quick action
  if (cell.revealed){
    if (smartQuickAction(r, c)) renderAll();
    return;
  }

  // flag mode
  if (mode === "flag"){
    toggleFlag(r, c);
    renderAll();
    return;
  }

  // FIRST reveal => zoom in a bit and unlock intro
  if (!hasStarted){
    hasStarted = true;
    zoomInOnFirstClick(clientX, clientY);
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
