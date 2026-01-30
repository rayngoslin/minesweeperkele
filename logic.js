// logic.js (v=20260130_NO_RCLICK_PRECLICK_BLOCK)
// - Intro: fit whole board visible + centered, scrolling locked
// - First click: unlock scroll (X+Y), zoom in, center clicked cell
// - After: pan freely; tap vs drag detection so panning doesn't trigger clicks
// - Hard mode: 150 mines
// - FIX: use --hudSpace (top offset) instead of paddingTop
// - FIX: center camera using gameContainer scroll sizes (not board scrollWidth)

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
let isZoomAnimating = false;
let dragState = null;
let manualZoomActive = false;
let panState = null;
const touchPointers = new Map();
let pinchState = null;
let baseBoardW = 0;
let baseBoardH = 0;

const boardEl = document.getElementById("board");
const bombEl = document.getElementById("bomb-count");
const toggleBtn = document.getElementById("toggle-mode");
const restartBtn = document.getElementById("restart-btn");
const gameContainer = document.getElementById("game-container");
const hudEl = document.getElementById("hud");
const boardWrap = document.getElementById("board-wrap");

// ===== optional banner =====
(() => {
  const b = document.createElement("div");
  b.style.cssText =
    "position:fixed;bottom:0;left:0;right:0;z-index:9999;" +
    "background:#ff006a;color:#fff;padding:6px 10px;font:14px Arial;";
  b.textContent = "LOGIC.JS LOADED v=20260125_150HARD_CENTERFIX";
  document.body.appendChild(b);
})();

// ===== HUD -> set CSS var that moves the camera viewport down =====
function syncHudSpace(){
  if (!hudEl) return;
  const h = Math.ceil(hudEl.getBoundingClientRect().height);
  document.documentElement.style.setProperty("--hudSpace", `${h}px`);
}

// call multiple times (Telegram reports sizes late)
function syncHudSpaceBurst(){
  syncHudSpace();
  requestAnimationFrame(syncHudSpace);
  setTimeout(syncHudSpace, 60);
  setTimeout(syncHudSpace, 250);
}

// keep in sync on changes
window.addEventListener("resize", () => { syncHudSpaceBurst(); refitAndCenterIntroIfNeeded(); });
window.addEventListener("orientationchange", () => { syncHudSpaceBurst(); refitAndCenterIntroIfNeeded(); });
if (window.Telegram?.WebApp?.onEvent){
  Telegram.WebApp.onEvent("viewportChanged", () => { syncHudSpaceBurst(); refitAndCenterIntroIfNeeded(); });
}
if (window.ResizeObserver && hudEl){
  new ResizeObserver(() => { syncHudSpaceBurst(); refitAndCenterIntroIfNeeded(); }).observe(hudEl);
}

// ===== helpers =====
function inBounds(r,c){ return r>=0 && r<ROWS && c>=0 && c<COLS; }

function forEachNeighbor(r,c,fn){
  for (const [dr,dc] of DIR8){
    const nr=r+dr, nc=c+dc;
    if (inBounds(nr,nc)) fn(nr,nc);
  }
}

function createEmptyBoard(){
  board = Array.from({length: ROWS}, () =>
    Array.from({length: COLS}, () => ({
      mine:false, revealed:false, flagged:false, value:0
    }))
  );
  revealedCount = 0;
  minesExist = false;
  safeZoneLocked = false;
  gameOver = false;

  hasStarted = false;
  isZoomAnimating = false;
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
  let f = 0;
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

// ===== sizing =====
function syncCellSizeToScreen(){
  const margin = 20;
  const w = Math.max(window.innerWidth || 0, document.documentElement.clientWidth || 0, 360);

  let cell = Math.floor((w - margin) / COLS);
  if (!Number.isFinite(cell) || cell < 14) cell = 14;
  if (cell > 32) cell = 32;

  document.documentElement.style.setProperty("--cell", `${cell}px`);
  boardEl.style.gridTemplateColumns = `repeat(${COLS}, ${cell}px)`;
}

// ===== intro camera lock/unlock =====
function lockIntroCamera(){
  gameContainer.classList.add("intro-lock");
  boardEl.classList.add("zoomed-out");
  boardEl.classList.remove("zoomed-in");
  boardEl.classList.remove("zoom-manual");
  manualZoomActive = false;
}

function unlockCamera(){
  gameContainer.classList.remove("intro-lock");
  boardEl.classList.remove("zoomed-out");
}

// ===== center camera (USE gameContainer scroll sizes) =====
function centerCamera(){
  requestAnimationFrame(() => {
    const maxX = Math.max(0, gameContainer.scrollWidth  - gameContainer.clientWidth);
    const maxY = Math.max(0, gameContainer.scrollHeight - gameContainer.clientHeight);
    gameContainer.scrollLeft = Math.floor(maxX / 2);
    gameContainer.scrollTop  = Math.floor(maxY / 2);
  });
}

function centerCameraBurst(){
  centerCamera();
  requestAnimationFrame(centerCamera);
  setTimeout(centerCamera, 60);
  setTimeout(centerCamera, 250);
}

// ===== fit whole board in intro =====
function fitBoardToViewport(){
  requestAnimationFrame(() => {
    const wasZoomed = boardEl.classList.contains("zoomed-out");
    const wasZoomedIn = boardEl.classList.contains("zoomed-in");
    const wasManual = boardEl.classList.contains("zoom-manual");

    // measure unscaled board size
    boardEl.classList.remove("zoomed-out");
    boardEl.classList.remove("zoomed-in");
    boardEl.classList.remove("zoom-manual");
    boardEl.style.transform = "";

    const boardW = boardEl.scrollWidth;
    const boardH = boardEl.scrollHeight;
    baseBoardW = boardW;
    baseBoardH = boardH;

    if (wasZoomed) boardEl.classList.add("zoomed-out");
    if (wasZoomedIn) boardEl.classList.add("zoomed-in");
    if (wasManual) boardEl.classList.add("zoom-manual");

    // IMPORTANT: gameContainer is already "below HUD" via top: --hudSpace
    const viewW = gameContainer.clientWidth  - 20;
    const viewH = gameContainer.clientHeight - 20;

    let scale = Math.min(viewW / boardW, viewH / boardH);

    // extra zoom-out (smaller than perfect fit). adjust if you want:
    scale *= 0.75; // 0.85 => more zoomed-out than exact-fit

    if (scale > 1) scale = 1;
    if (scale < 0.06) scale = 0.06;

    document.documentElement.style.setProperty("--zoomOut", scale.toFixed(3));
    updateBoardWrapSize(scale);

    // after zoomOut applied, center scroll so board isn't stuck top-left
    centerCamera();
  });
}

function measureBoardBaseSize(){
  const wasZoomed = boardEl.classList.contains("zoomed-out");
  const wasZoomedIn = boardEl.classList.contains("zoomed-in");
  const wasManual = boardEl.classList.contains("zoom-manual");

  boardEl.classList.remove("zoomed-out");
  boardEl.classList.remove("zoomed-in");
  boardEl.classList.remove("zoom-manual");
  boardEl.style.transform = "";

  baseBoardW = boardEl.scrollWidth;
  baseBoardH = boardEl.scrollHeight;

  if (wasZoomed) boardEl.classList.add("zoomed-out");
  if (wasZoomedIn) boardEl.classList.add("zoomed-in");
  if (wasManual) boardEl.classList.add("zoom-manual");
}

function updateBoardWrapSize(scale){
  if (!boardWrap) return;
  if (!baseBoardW || !baseBoardH) measureBoardBaseSize();
  const w = Math.max(baseBoardW * scale, gameContainer.clientWidth);
  const h = Math.max(baseBoardH * scale, gameContainer.clientHeight);
  boardWrap.style.width = `${Math.ceil(w)}px`;
  boardWrap.style.height = `${Math.ceil(h)}px`;
}

function syncZoomInScale(bounds){
  const wasZoomedOut = boardEl.classList.contains("zoomed-out");
  const wasZoomedIn = boardEl.classList.contains("zoomed-in");
  const wasManual = boardEl.classList.contains("zoom-manual");

  boardEl.classList.remove("zoomed-out");
  boardEl.classList.remove("zoomed-in");
  boardEl.classList.remove("zoom-manual");
  boardEl.style.transform = "";

  const rootStyles = getComputedStyle(document.documentElement);
  const cellSize = parseFloat(rootStyles.getPropertyValue("--cell")) || 18;
  const boardStyles = getComputedStyle(boardEl);
  const gap = parseFloat(boardStyles.gap) || 0;

  const cellsWide = Math.max(1, (bounds.maxC - bounds.minC + 1));
  const cellsHigh = Math.max(1, (bounds.maxR - bounds.minR + 1));
  const patchW = cellsWide * cellSize + (cellsWide - 1) * gap;
  const patchH = cellsHigh * cellSize + (cellsHigh - 1) * gap;
  const viewW = gameContainer.clientWidth  - 20;
  const viewH = gameContainer.clientHeight - 20;

  const fit = Math.min(viewW / patchW, viewH / patchH);
  const patchArea = patchW * patchH;
  const viewArea = viewW * viewH;
  const areaRatio = viewArea > 0 ? (patchArea / viewArea) : 1;

  // Adaptive zoom: smaller patches get extra zoom, larger patches get a bit less
  let boost = 1.0;
  if (areaRatio < 0.06) boost = 1.25;
  else if (areaRatio < 0.12) boost = 1.15;
  else if (areaRatio < 0.2) boost = 1.08;
  else if (areaRatio > 0.6) boost = 0.95;

  let scale = Math.max(1.6, Math.min(6.0, fit * boost));
  if (!Number.isFinite(scale)) scale = 1.2;

  document.documentElement.style.setProperty("--zoomIn", scale.toFixed(3));
  updateBoardWrapSize(scale);

  if (wasZoomedOut) boardEl.classList.add("zoomed-out");
  if (wasZoomedIn) boardEl.classList.add("zoomed-in");
  if (wasManual) boardEl.classList.add("zoom-manual");
}

// If we’re still in intro (hasStarted=false), keep it fit+center on resizes
function refitAndCenterIntroIfNeeded(){
  if (!hasStarted){
    fitBoardToViewport();
  }
}

// ===== DOM build =====
function buildFieldDOM(){
  syncHudSpaceBurst();     // ensure camera viewport is correct first
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

      el.addEventListener("pointerdown", onPointerDown, { passive: true });
      el.addEventListener("pointermove", onPointerMove, { passive: true });
      el.addEventListener("pointerup", onPointerUp, { passive: true });
      el.addEventListener("pointercancel", () => { dragState = null; }, { passive: true });

      frag.appendChild(el);
    }
  }

  boardEl.appendChild(frag);

  hasStarted = false;
  isZoomAnimating = false;
  lockIntroCamera();

  measureBoardBaseSize();

  // reset scroll to deterministic position, then fit+center
  gameContainer.scrollLeft = 0;
  gameContainer.scrollTop  = 0;

  fitBoardToViewport();
  setTimeout(() => { if (!hasStarted) fitBoardToViewport(); }, 120); // Telegram late layout
}

// ===== pointer tap vs drag =====
function onPointerDown(e){
  if (gameOver || isZoomAnimating) return;

  dragState = {
    el: e.currentTarget,
    startX: e.clientX,
    startY: e.clientY,
    moved: false
  };
}

function onPointerMove(e){
  if (!dragState) return;
  const dx = e.clientX - dragState.startX;
  const dy = e.clientY - dragState.startY;
  if ((dx*dx + dy*dy) > (8*8)) dragState.moved = true;
}

function onPointerUp(){
  if (!dragState) return;
  if (dragState.moved){
    dragState = null;
    return;
  }
  onCellActivate(dragState.el);
  dragState = null;
}

// ===== render =====
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

// ===== actions =====
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

// ===== intro zoom-in =====
function zoomIntoCell(r, c, bounds){
  if (isZoomAnimating) return;
  isZoomAnimating = true;

  const idx = r * COLS + c;
  const cellEl = boardEl.querySelectorAll(".cell")[idx];

  requestAnimationFrame(() => {
    syncZoomInScale(bounds);
    boardEl.classList.add("zoomed-in");
    boardEl.classList.remove("zoomed-out");
    boardEl.classList.remove("zoom-manual");
    manualZoomActive = false;

    if (cellEl?.scrollIntoView){
      requestAnimationFrame(() => {
        cellEl.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
        setTimeout(() => {
          if (cellEl?.scrollIntoView){
            cellEl.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
          }
        }, 160);
      });
    }
    setTimeout(() => { isZoomAnimating = false; }, 520);
  });
}

function getRevealedBounds(fallbackR, fallbackC){
  let minR = ROWS, minC = COLS, maxR = -1, maxC = -1;
  for (let r=0;r<ROWS;r++){
    for (let c=0;c<COLS;c++){
      if (!board[r][c].revealed) continue;
      if (r < minR) minR = r;
      if (c < minC) minC = c;
      if (r > maxR) maxR = r;
      if (c > maxC) maxC = c;
    }
  }

  if (maxR < 0){
    minR = maxR = fallbackR;
    minC = maxC = fallbackC;
  }

  return { minR, minC, maxR, maxC };
}

// ===== tap activation =====
function onCellActivate(cellDiv){
  if (gameOver || isZoomAnimating) return;

  const r = parseInt(cellDiv.dataset.r, 10);
  const c = parseInt(cellDiv.dataset.c, 10);
  const cell = board[r][c];

  ensureMinefieldExists();

  if (cell.revealed){
    if (smartQuickAction(r, c)) renderAll();
    return;
  }

  if (mode === "flag"){
    toggleFlag(r, c);
    renderAll();
    return;
  }

  if (!hasStarted){
    hasStarted = true;
    unlockCamera();
    boardEl.classList.remove("zoomed-out");
  }

  reveal(r, c);
  renderAll();

  if (hasStarted && !isZoomAnimating && !boardEl.classList.contains("zoomed-in")){
    const bounds = getRevealedBounds(r, c);
    zoomIntoCell(r, c, bounds);
  }
}

function getCurrentZoom(){
  const rootStyles = getComputedStyle(document.documentElement);
  if (boardEl.classList.contains("zoom-manual")){
    return parseFloat(rootStyles.getPropertyValue("--zoomManual")) || 1;
  }
  if (boardEl.classList.contains("zoomed-in")){
    return parseFloat(rootStyles.getPropertyValue("--zoomIn")) || 1;
  }
  return parseFloat(rootStyles.getPropertyValue("--zoomOut")) || 1;
}

function applyManualZoom(scale){
  if (!Number.isFinite(scale)) return;
  const next = Math.max(0.5, Math.min(6.0, scale));
  document.documentElement.style.setProperty("--zoomManual", next.toFixed(3));
  boardEl.classList.add("zoom-manual");
  boardEl.classList.remove("zoomed-out");
  boardEl.classList.remove("zoomed-in");
  manualZoomActive = true;
  updateBoardWrapSize(next);
}

function onWheelZoom(e){
  if (!hasStarted) return;
  if (isZoomAnimating) return;
  if (e.ctrlKey) return;
  e.preventDefault();

  const current = getCurrentZoom();
  const factor = Math.pow(1.0015, -e.deltaY);
  applyManualZoom(current * factor);
}

function onMousePanStart(e){
  if (e.button !== 2) return;
  panState = {
    startX: e.clientX,
    startY: e.clientY,
    scrollLeft: gameContainer.scrollLeft,
    scrollTop: gameContainer.scrollTop
  };
  e.preventDefault();
}

function onMousePanMove(e){
  if (!panState) return;
  const dx = e.clientX - panState.startX;
  const dy = e.clientY - panState.startY;
  gameContainer.scrollLeft = panState.scrollLeft - dx;
  gameContainer.scrollTop = panState.scrollTop - dy;
}

function onMousePanEnd(){
  panState = null;
}

function onTouchPointerDown(e){
  if (e.pointerType !== "touch") return;
  touchPointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

  if (touchPointers.size === 2){
    const pts = Array.from(touchPointers.values());
    const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
    pinchState = { startDist: dist, startZoom: getCurrentZoom() };
  }
}

function onTouchPointerMove(e){
  if (e.pointerType !== "touch") return;
  if (!touchPointers.has(e.pointerId)) return;

  const prev = touchPointers.get(e.pointerId);
  touchPointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

  if (touchPointers.size === 2 && pinchState){
    e.preventDefault();
    const pts = Array.from(touchPointers.values());
    const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
    const scale = pinchState.startZoom * (dist / Math.max(1, pinchState.startDist));
    applyManualZoom(scale);
    return;
  }

  if (touchPointers.size === 1){
    const dx = e.clientX - prev.x;
    const dy = e.clientY - prev.y;
    if ((dx*dx + dy*dy) > 4){
      gameContainer.scrollLeft -= dx;
      gameContainer.scrollTop -= dy;
    }
  }
}

function onTouchPointerUp(e){
  if (e.pointerType !== "touch") return;
  touchPointers.delete(e.pointerId);
  if (touchPointers.size < 2) pinchState = null;
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

  // refit again (Telegram late), only if still intro
  setTimeout(() => { if (!hasStarted) fitBoardToViewport(); }, 200);
});

// ===== init =====
syncHudSpaceBurst();
createEmptyBoard();
buildFieldDOM();
renderAll();
updateModeText();

gameContainer.addEventListener("wheel", onWheelZoom, { passive: false });
gameContainer.addEventListener("mousedown", onMousePanStart, { passive: false });
window.addEventListener("mousemove", onMousePanMove, { passive: true });
window.addEventListener("mouseup", onMousePanEnd, { passive: true });
gameContainer.addEventListener("contextmenu", (e) => {
  if (panState) e.preventDefault();
});
boardEl.addEventListener("contextmenu", (e) => {
  e.preventDefault();
});

gameContainer.addEventListener("pointerdown", onTouchPointerDown, { passive: true });
gameContainer.addEventListener("pointermove", onTouchPointerMove, { passive: false });
gameContainer.addEventListener("pointerup", onTouchPointerUp, { passive: true });
gameContainer.addEventListener("pointercancel", onTouchPointerUp, { passive: true });
