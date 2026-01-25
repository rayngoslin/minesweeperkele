// logic.js (v=20260125_150HARD_CENTERFIX_2)
// Fixes:
// - Zoom-in centering is MANUAL (no scrollIntoView) -> no Telegram top-left bias
// - Intro-fit still works
// - Restart always recenters
// - Banner fixed for Telegram Desktop (or you can disable it)

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

const boardEl = document.getElementById("board");
const bombEl = document.getElementById("bomb-count");
const toggleBtn = document.getElementById("toggle-mode");
const restartBtn = document.getElementById("restart-btn");
const gameContainer = document.getElementById("game-container");
const hudEl = document.getElementById("hud");

// ===== banner (disable if you want) =====
const SHOW_BANNER = true;
if (SHOW_BANNER) {
  const b = document.createElement("div");
  b.id = "ver-banner";
  b.style.cssText =
    "position:fixed;left:0;right:0;top:auto;" +
    "bottom:env(safe-area-inset-bottom,0px);" +
    "inset:auto 0 0 0;" +
    "z-index:999999;background:#ff006a;color:#fff;" +
    "padding:6px 10px;font:14px Arial;" +
    "pointer-events:none;transform:translateZ(0);";
  b.textContent = "LOGIC.JS LOADED v=20260125_150HARD_CENTERFIX_2";
  document.body.appendChild(b);
}

// ===== HUD -> set CSS var that moves the camera viewport down =====
function syncHudSpace(){
  if (!hudEl) return;
  const h = Math.ceil(hudEl.getBoundingClientRect().height);
  document.documentElement.style.setProperty("--hudSpace", `${h}px`);
}

function syncHudSpaceBurst(){
  syncHudSpace();
  requestAnimationFrame(syncHudSpace);
  setTimeout(syncHudSpace, 60);
  setTimeout(syncHudSpace, 250);
}

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
}

function unlockCamera(){
  gameContainer.classList.remove("intro-lock");
  boardEl.classList.remove("zoomed-out");
}

// ===== center camera using SCROLLABLE SIZE of gameContainer =====
function centerCamera(){
  requestAnimationFrame(() => {
    const maxX = Math.max(0, gameContainer.scrollWidth  - gameContainer.clientWidth);
    const maxY = Math.max(0, gameContainer.scrollHeight - gameContainer.clientHeight);
    gameContainer.scrollLeft = Math.floor(maxX / 2);
    gameContainer.scrollTop  = Math.floor(maxY / 2);
  });
}

// ===== MANUAL center on a cell (no scrollIntoView) =====
function centerOnCell(r, c){
  const cellSize = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--cell")) || 18;
  const gap = 2; // your grid gap in CSS
  const pitch = cellSize + gap;

  // cell center in board coordinates
  const targetX = (c * pitch) + cellSize / 2;
  const targetY = (r * pitch) + cellSize / 2;

  // where to scroll so that target center is centered in viewport
  const viewW = gameContainer.clientWidth;
  const viewH = gameContainer.clientHeight;

  let left = Math.round(targetX - viewW / 2);
  let top  = Math.round(targetY - viewH / 2);

  // clamp
  const maxLeft = Math.max(0, gameContainer.scrollWidth  - viewW);
  const maxTop  = Math.max(0, gameContainer.scrollHeight - viewH);
  if (left < 0) left = 0; if (left > maxLeft) left = maxLeft;
  if (top  < 0) top  = 0; if (top  > maxTop)  top  = maxTop;

  gameContainer.scrollLeft = left;
  gameContainer.scrollTop  = top;
}

// ===== fit whole board in intro =====
function fitBoardToViewport(){
  requestAnimationFrame(() => {
    const wasZoomed = boardEl.classList.contains("zoomed-out");

    boardEl.classList.remove("zoomed-out");
    boardEl.style.transform = "";

    const boardW = boardEl.scrollWidth;
    const boardH = boardEl.scrollHeight;

    if (wasZoomed) boardEl.classList.add("zoomed-out");

    const viewW = gameContainer.clientWidth  - 20;
    const viewH = gameContainer.clientHeight - 20;

    let scale = Math.min(viewW / boardW, viewH / boardH);

    // more zoom out (smaller) -> tweak this if you want even more:
    scale *= 0.85;

    if (scale > 1) scale = 1;
    if (scale < 0.06) scale = 0.06;

    document.documentElement.style.setProperty("--zoomOut", scale.toFixed(3));

    centerCamera();
  });
}

function refitAndCenterIntroIfNeeded(){
  if (!hasStarted) fitBoardToViewport();
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

      el.addEventListener("pointerdown", onPointerDown, { passive: true });
      el.addEventListener("pointermove", onPointerMove, { passive: true });
      el.addEventListener("pointerup", onPointerUp, { passive: true });
      el.addEventListener("pointercancel", () => { dragState = null; }, { passive: true });

      el.addEventListener("contextmenu",(e)=>{
        e.preventDefault();
        if (gameOver) return;
        toggleFlag(r,c);
        renderAll();
      });

      frag.appendChild(el);
    }
  }

  boardEl.appendChild(frag);

  hasStarted = false;
  isZoomAnimating = false;
  lockIntroCamera();

  // deterministic scroll start
  gameContainer.scrollLeft = 0;
  gameContainer.scrollTop  = 0;

  fitBoardToViewport();
  setTimeout(() => { if (!hasStarted) fitBoardToViewport(); }, 160);
  setTimeout(() => { if (!hasStarted) fitBoardToViewport(); }, 320);
}

// ===== pointer tap vs drag =====
function onPointerDown(e){
  if (gameOver || isZoomAnimating) return;
  dragState = { el: e.currentTarget, startX: e.clientX, startY: e.clientY, moved: false };
}
function onPointerMove(e){
  if (!dragState) return;
  const dx = e.clientX - dragState.startX;
  const dy = e.clientY - dragState.startY;
  if ((dx*dx + dy*dy) > (8*8)) dragState.moved = true;
}
function onPointerUp(){
  if (!dragState) return;
  if (dragState.moved) { dragState = null; return; }
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
    if (n.mine){ n.revealed = true; lose(); return; }
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

// ===== zoom-in (manual center) =====
function zoomIntoCell(r, c){
  if (isZoomAnimating) return;
  isZoomAnimating = true;

  requestAnimationFrame(() => {
    centerOnCell(r, c); // reliable in Telegram
    setTimeout(() => { isZoomAnimating = false; }, 300);
  });
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
    zoomIntoCell(r, c);
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

// ===== init =====
syncHudSpaceBurst();
createEmptyBoard();
buildFieldDOM();
renderAll();
updateModeText();
