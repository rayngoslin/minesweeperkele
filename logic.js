// logic.js (v=20260124_2) — cleaned + mobile-ready + single-tap quick actions
// Features:
// - HUD pinned + JS auto padding under HUD
// - Field ALWAYS renders
// - One-click actions based on mode toggle (reveal/flag)
// - Single-tap quick mapping/quick flagging on revealed cells:
//    * If remaining hidden neighbors MUST be bombs -> auto-flag them
//    * If bombs already flagged -> auto-reveal the rest
//    * If revealed 0 -> reveal neighbors (mobile speed)
// - Minefield exists immediately (even if you start by flagging)  ✅
// - First reveal is safe: 3x3 safe zone enforced by relocating mines
// - Telegram Mini App: ready/expand and reacts to viewportChanged

// ===== Telegram Mini App =====
if (window.Telegram?.WebApp) {
  try { Telegram.WebApp.ready(); Telegram.WebApp.expand(); } catch (_) {}
}

// ===== Constants =====
const ROWS = 32;
const COLS = 18;
const NUM_MINES = Math.floor(ROWS * COLS * 0.15);

const DIR8 = [
  [-1,-1], [-1,0], [-1,1],
  [ 0,-1],         [ 0,1],
  [ 1,-1], [ 1,0], [ 1,1],
];

// ===== State =====
let board = [];
let revealedCount = 0;

let mode = "reveal";         // "reveal" | "flag"
let minesExist = false;      // mines placed even if first action is flag
let safeZoneLocked = false;  // safe zone enforced on first reveal
let gameOver = false;

// ===== DOM =====
const boardEl = document.getElementById("board");
const bombEl = document.getElementById("bomb-count");
const toggleBtn = document.getElementById("toggle-mode");
const restartBtn = document.getElementById("restart-btn");
const gameContainer = document.getElementById("game-container");
const hudEl = document.getElementById("hud");

// ===== Version banner (DOM-safe) =====
document.addEventListener("DOMContentLoaded", () => {
  document.body.insertAdjacentHTML(
    "afterbegin",
    `<div id="ver-banner" style="
      position:fixed;bottom:0;left:0;right:0;z-index:9999;
      background:#ff006a;color:#fff;padding:6px 10px;
      font:14px Arial;">LOGIC.JS LOADED v=20260124_2</div>`
  );
});

// ===== HUD padding (Telegram Android-friendly) =====
function syncHudPadding(){
  if (!hudEl || !gameContainer) return;
  const h = hudEl.getBoundingClientRect().height;
  gameContainer.style.paddingTop = `${Math.ceil(h + 10)}px`;
}
requestAnimationFrame(syncHudPadding);
setTimeout(syncHudPadding, 50);

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
    // values computed after first reveal safe-zone is enforced
  }
}

// Ensure first reveal is safe: 3x3 around first click has no mines
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

// ===== Responsive cell sizing =====
function syncCellSizeToScreen(){
  const margin = 20;
  const w1 = window.innerWidth || 0;
  const w2 = document.documentElement.clientWidth || 0;
  const w3 = screen.width || 0;
  const w = Math.max(w1, w2, w3, 360);

  let cell = Math.floor((w - margin) / COLS);
  if (!Number.isFinite(cell) || cell < 14) cell = 14;
  if (cell > 32) cell = 32;

  document.documentElement.style.setProperty("--cell", `${cell}px`);
  boardEl.style.gridTemplateColumns = `repeat(${COLS}, ${cell}px)`;
}

// ===== DOM build/render =====
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
        // On touch, prevent "ghost click"/scroll quirks
        if (e.pointerType === "touch") e.preventDefault();
        onCellActivate(e);
      });

      // right click support for desktop
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
}

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

// Single tap on revealed cell:
// - if forced bombs -> flag
// - if bombs satisfied -> reveal
// - if value 0 -> reveal neighbors (speed)
function smartQuickAction(r, c) {
  const cell = board[r][c];
  if (!cell.revealed) return false;

  const flagged = flaggedNeighbors(r, c);
  const hiddenUnflagged = hiddenUnflaggedNeighbors(r, c);

  // Forced bombs
  if (cell.value > 0) {
    const need = cell.value - flagged;
    if (need > 0 && need === hiddenUnflagged.length) {
      for (const [nr, nc] of hiddenUnflagged) board[nr][nc].flagged = true;
      return true;
    }

    // Forced safe reveals
    if (flagged === cell.value) {
      chordReveal(r, c);
      return true;
    }
  }

  // Speed tap on 0
  if (cell.value === 0 && hiddenUnflagged.length > 0) {
    for (const [nr, nc] of hiddenUnflagged) {
      reveal(nr, nc);
      if (gameOver) return true;
    }
    return true;
  }

  return false;
}

// ===== Input handler =====
function onCellActivate(e){
  if (gameOver) return;

  const el = e.currentTarget;
  const r = parseInt(el.dataset.r, 10);
  const c = parseInt(el.dataset.c, 10);
  const cell = board[r][c];

  // Mines exist even if first action is flag
  if (!minesExist) ensureMinefieldExists();

  // Tap revealed cell => smart quick action
  if (cell.revealed) {
    if (smartQuickAction(r, c)) renderAll();
    return;
  }

  // Normal action
  if (mode === "flag") toggleFlag(r,c);
  else reveal(r,c);

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

// Keep sizing consistent on rotations
window.addEventListener("resize", ()=>{ syncCellSizeToScreen(); syncHudPadding(); });
window.addEventListener("orientationchange", ()=>{ syncCellSizeToScreen(); syncHudPadding(); });
if (window.Telegram?.WebApp?.onEvent){
  Telegram.WebApp.onEvent("viewportChanged", ()=>{ syncCellSizeToScreen(); syncHudPadding(); });
}

// ===== INIT =====
createEmptyBoard();
buildFieldDOM();
renderAll();
updateModeText();
syncHudPadding();
