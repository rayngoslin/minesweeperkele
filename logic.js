// logic.js (v=20260124_1) — Guaranteed visible field + cache-proof debug banner
// Features:
// - HUD pinned + JS auto padding under HUD
// - Field ALWAYS renders (1250 cells)
// - One-click actions based on mode toggle (reveal/flag)
// - One-click quick mapping/quick flagging by clicking revealed number cell
// - Minefield exists immediately (even if you start by flagging)
// - First reveal is safe: 3x3 safe zone enforced by relocating mines
// - Telegram Mini App: tries expand/ready and reacts to viewportChanged

// ===== VERSION BANNER (so you KNOW what's loaded) =====
document.body.insertAdjacentHTML(
  "afterbegin",
  `<div id="ver-banner" style="
    position:fixed;bottom:0;left:0;right:0;z-index:9999;
    background:#ff006a;color:#fff;padding:6px 10px;
    font:14px Arial;">LOGIC.JS LOADED v=20260124_1</div>`
);

if (window.Telegram?.WebApp) {
  try { Telegram.WebApp.ready(); Telegram.WebApp.expand(); } catch (_) {}
}

const ROWS = 25;
const COLS = 50;
const NUM_MINES = Math.floor(ROWS * COLS * 0.15);

let board = [];
let revealedCount = 0;

let mode = "reveal";         // reveal | flag
let minesExist = false;      // minefield created even if first action is flag
let safeZoneLocked = false;  // safe zone enforced on first reveal
let gameOver = false;

const boardEl = document.getElementById("board");
const bombEl = document.getElementById("bomb-count");
const toggleBtn = document.getElementById("toggle-mode");
const restartBtn = document.getElementById("restart-btn");
const gameContainer = document.getElementById("game-container");
const hudEl = document.getElementById("hud");

const DIR8 = [
  [-1,-1], [-1,0], [-1,1],
  [ 0,-1],         [ 0,1],
  [ 1,-1], [ 1,0], [ 1,1],
];

document.body.insertAdjacentHTML(
  "afterbegin",
  `<div style="position:fixed;bottom:0;left:0;right:0;z-index:99999;
              background:#ff006a;color:white;padding:6px 10px;
              font:14px Arial;">LOGIC VERSION: 150</div>`
);

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

// ===== Responsive sizing (Telegram WebView can lie about innerWidth) =====
function syncCellSizeToScreen(){
  const margin = 20;
  const w1 = window.innerWidth || 0;
  const w2 = document.documentElement.clientWidth || 0;
  const w3 = screen.width || 0;

  const w = Math.max(w1, w2, w3, 360);

  let cell = Math.floor((w - margin) / COLS);

  // HARD FLOOR: never invisible
  if (!Number.isFinite(cell) || cell < 14) cell = 14;
  if (cell > 32) cell = 32;

  document.documentElement.style.setProperty("--cell", `${cell}px`);
  boardEl.style.gridTemplateColumns = `repeat(${COLS}, ${cell}px)`;
}

function syncHudPadding(){
  const h = hudEl.getBoundingClientRect().height;
  gameContainer.style.paddingTop = `${Math.ceil(h + 10)}px`;
}

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

      // click/tap
      el.addEventListener("click", onCellActivate);
      el.addEventListener("touchend", (e)=>{ e.preventDefault(); onCellActivate(e); }, {passive:false});

      // optional right-click flag
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

  // DEBUG: prove it exists
  setTimeout(() => {
    const cells = document.querySelectorAll(".cell").length;
    const rect = boardEl.getBoundingClientRect();
    console.log("Field built:", {cells, boardW: rect.width, boardH: rect.height});
  }, 0);
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

function ensureMinefieldExists(){
  if (!minesExist){
    minesExist = true;
    placeMinesAnywhere();
    // values computed after first reveal safe-zone is enforced
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

// ===== Quick mapping/flagging with ONE click on revealed number =====
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

function chordFlag(r,c){
  const cell = board[r][c];
  if (!cell.revealed || cell.value <= 0) return;

  const f = flaggedNeighbors(r,c);
  const targets = hiddenUnflaggedNeighbors(r,c);
  const need = cell.value - f;

  if (need > 0 && need === targets.length){
    for (const [nr,nc] of targets){
      board[nr][nc].flagged = true;
    }
  }
}

// ===== Click/tap handler =====
function onCellActivate(e){
  if (gameOver) return;
  const el = e.currentTarget;
  const r = parseInt(el.dataset.r, 10);
  const c = parseInt(el.dataset.c, 10);
  const cell = board[r][c];

  ensureMinefieldExists();

  // One-click quick actions on revealed numbers
  if (cell.revealed && cell.value > 0){
    if (mode === "reveal") chordReveal(r,c);
    else chordFlag(r,c);
    renderAll();
    return;
  }

  // Normal action
  if (mode === "flag") toggleFlag(r,c);
  else reveal(r,c);

  renderAll();
}

// ===== UI =====
toggleBtn.addEventListener("click", ()=>{
  mode = (mode === "reveal") ? "flag" : "reveal";
  toggleBtn.textContent = (mode === "reveal") ? "Switch to Flag Mode" : "Switch to Reveal Mode";
});

restartBtn.addEventListener("click", ()=>{
  createEmptyBoard();
  buildFieldDOM();
  renderAll();
  syncHudPadding();
});

// Resize behavior
window.addEventListener("resize", ()=>{ syncCellSizeToScreen(); syncHudPadding(); });
window.addEventListener("orientationchange", ()=>{ syncCellSizeToScreen(); syncHudPadding(); });

if (window.Telegram?.WebApp?.onEvent){
  Telegram.WebApp.onEvent("viewportChanged", ()=>{
    syncCellSizeToScreen();
    syncHudPadding();
  });
}

// ===== INIT =====
createEmptyBoard();
buildFieldDOM();
toggleBtn.textContent = "Switch to Flag Mode";
renderAll();
syncHudPadding();
