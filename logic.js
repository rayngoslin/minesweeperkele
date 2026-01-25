// logic.js (v=20260125_150HARD) — mobile-safe + single-tap quick actions + FIT zoom-out + 150 mines
// Fixes:
// - Uses a scroll container (#game-container) for both X/Y panning
// - Zoom-out scale is applied via CSS var --zoomOut (set by JS)
// - No translate() panning (prevents Android WebView tap desync)
// - Input locked during zoom animation
// - Pointerdown as single input source (Telegram Android-friendly)

if (window.Telegram?.WebApp) {
  try { Telegram.WebApp.ready(); Telegram.WebApp.expand(); } catch (_) {}
}

// ===== Constants =====
const ROWS = 32;
const COLS = 18;
const NUM_MINES = 150; // HARD MODE

const DIR8 = [
  [-1,-1], [-1,0], [-1,1],
  [ 0,-1],         [ 0,1],
  [ 1,-1], [ 1,0], [ 1,1],
];

// ===== State =====
let board = [];
let revealedCount = 0;

let hasStarted = false;
let isZoomAnimating = false;
let mode = "reveal";
let minesExist = false;
let safeZoneLocked = false;
let gameOver = false;

// ===== DOM =====
const boardEl = document.getElementById("board");
const bombEl = document.getElementById("bomb-count");
const toggleBtn = document.getElementById("toggle-mode");
const restartBtn = document.getElementById("restart-btn");
const gameContainer = document.getElementById("game-container");
const hudEl = document.getElementById("hud");

// ===== Version banner =====
(function addBanner(){
  const banner = document.createElement("div");
  banner.id = "ver-banner";
  banner.style.cssText =
    "position:fixed;bottom:0;left:0;right:0;z-index:9999;" +
    "background:#ff006a;color:#fff;padding:6px 10px;font:14px Arial;";
  banner.textContent = "LOGIC.JS LOADED v=20260125_150HARD";
  document.body.appendChild(banner);
})();

// ===== HUD padding =====
function syncHudPadding(){
  if (!hudEl || !gameContainer) return;
  const h = hudEl.getBoundingClientRect().height;
  gameContainer.style.paddingTop = `${Math.ceil(h + 10)}px`;
}
requestAnimationFrame(syncHudPadding);
setTimeout(syncHudPadding, 60);

window.addEventListener("resize", syncHudPadding);
window.addEventListener("orientationchange", syncHudPadding);
if (window.Telegram?.WebApp?.onEvent){
  Telegram.WebApp.onEvent("viewportChanged", syncHudPadding);
}

// ===== Helpers =====
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

// ===== Responsive sizing =====
function syncCellSizeToScreen(){
  const margin = 20;
  const w = Math.max(
    window.innerWidth || 0,
    document.documentElement.clientWidth || 0,
    screen.width || 0,
    360
  );

  let cell = Math.floor((w - margin) / COLS);
  if (!Number.isFinite(cell) || cell < 14) cell = 14;
  if (cell > 32) cell = 32;

  document.documentElement.style.setProperty("--cell", `${cell}px`);
  boardEl.style.gridTemplateColumns = `repeat(${COLS}, ${cell}px)`;
}

// Fit zoom-out so whole board is visible
function fitBoardToViewport(){
  requestAnimationFrame(() => {
    const hudH = hudEl ? hudEl.getBoundingClientRect().height : 0;
    const vw = window.innerWidth || document.documentElement.clientWidth;
    const vh = (window.innerHeight || document.documentElement.clientHeight) - hudH - 20;

    // measure untransformed board size
    const prev = boardEl.style.transform;
    boardEl.style.transform = "";
    const rect = boardEl.getBoundingClientRect();
    boardEl.style.transform = prev;

    const scaleX = vw / rect.width;
    const scaleY = vh / rect.height;

    let scale = Math.min(scaleX, scaleY) * 0.98;

    if (scale > 1) scale = 1;
    if (scale < 0.12) scale = 0.12;

    document.documentElement.style.setProperty("--zoomOut", String(scale.toFixed(3)));

    // center board at top-left of scroll container
    gameContainer.scrollLeft = 0;
    gameContainer.scrollTop = 0;
  });
}

// ===== DOM build =====
function buildFieldDOM(){
  syncCellSizeToScreen();

  boardEl.style.gridTemplateColumns = `repeat(${COLS}, var(--cell))`;
  boardEl.innerHTML = "";

  const frag = document.createDocumentFragment();

  for (let r=0;r<ROWS;r++){
    for (let c=0;c<COLS;c++){
      const el = document.createElement("div");
      el.className = "cell";
      el.dataset.r = String(r);
      el.dataset.c = String(c);

      el.addEventListener("pointerdown", (e) => {
        if (e.pointerType === "touch") e.preventDefault();
        onCellActivate(e);
      });

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

  // intro zoom-out state
  boardEl.classList.add("zoomed-out");
  hasStarted = false;
  isZoomAnimating = false;

  fitBoardToViewport();
}

// Zoom-in: remove zoomed-out and scroll target into center (X + Y)
function zoomIntoCell(r, c){
  if (isZoomAnimating) return;
  isZoomAnimating = true;

  const idx = r * COLS + c;
  const cellEl = boardEl.querySelectorAll(".cell")[idx];

  boardEl.classList.remove("zoomed-out");

  requestAnimationFrame(() => {
    if (cellEl) {
      cellEl.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
    }
    setTimeout(() => { isZoomAnimating = false; }, 450);
  });
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

// ===== Quick logic =====
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

// ===== Input =====
function onCellActivate(e){
  if (gameOver) return;
  if (isZoomAnimating) return;

  const el = e.currentTarget;
  const r = parseInt(el.dataset.r, 10);
  const c = parseInt(el.dataset.c, 10);
  const cell = board[r][c];

  ensureMinefieldExists();

  if (cell.revealed){
    if (smartQuickAction(r, c)) renderAll();
    return;
  }

  if (mode === "flag"){
    toggleFlag(r,c);
    renderAll();
    return;
  }

  // reveal mode
  if (!hasStarted){
    hasStarted = true;
    zoomIntoCell(r, c);
  }

  reveal(r,c);
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
  syncHudPadding();
  updateModeText();
});

// keep sizes correct
function resyncAll(){
  syncCellSizeToScreen();
  syncHudPadding();
  fitBoardToViewport();
}
window.addEventListener("resize", resyncAll);
window.addEventListener("orientationchange", resyncAll);
if (window.Telegram?.WebApp?.onEvent){
  Telegram.WebApp.onEvent("viewportChanged", resyncAll);
}

// ===== INIT =====
createEmptyBoard();
buildFieldDOM();
renderAll();
updateModeText();
syncHudPadding();
