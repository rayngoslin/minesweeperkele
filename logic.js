// logic.js (simple board fit to screen)
// - No zoom or panning
// - Board cell size fits the Telegram viewport

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
window.addEventListener("resize", () => { syncHudSpaceBurst(); syncCellSizeToScreen(); });
window.addEventListener("orientationchange", () => { syncHudSpaceBurst(); syncCellSizeToScreen(); });
if (window.Telegram?.WebApp?.onEvent){
  Telegram.WebApp.onEvent("viewportChanged", () => { syncHudSpaceBurst(); syncCellSizeToScreen(); });
}
if (window.ResizeObserver && hudEl){
  new ResizeObserver(() => { syncHudSpaceBurst(); syncCellSizeToScreen(); }).observe(hudEl);
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
  const gap = 2;
  const viewW = Math.max(0, gameContainer.clientWidth - 12);
  const viewH = Math.max(0, gameContainer.clientHeight - 12);

  let cell = Math.floor(Math.min(viewW / COLS, viewH / ROWS));
  if (!Number.isFinite(cell) || cell < 10) cell = 10;
  if (cell > 40) cell = 40;

  const boardW = cell * COLS + gap * (COLS - 1);
  const boardH = cell * ROWS + gap * (ROWS - 1);

  document.documentElement.style.setProperty("--cell", `${cell}px`);
  boardEl.style.gridTemplateColumns = `repeat(${COLS}, ${cell}px)`;
  boardEl.style.gridTemplateRows = `repeat(${ROWS}, ${cell}px)`;
  boardEl.style.width = `${boardW}px`;
  boardEl.style.height = `${boardH}px`;
}

// no zoom/pan: board size is fit to viewport via syncCellSizeToScreen

// ===== DOM build =====
function buildFieldDOM(){
  syncHudSpaceBurst();     // ensure camera viewport is correct first
  syncCellSizeToScreen();

  boardEl.innerHTML = "";
  boardEl.style.gridTemplateColumns = `repeat(${COLS}, var(--cell))`;
  boardEl.style.gridTemplateRows = `repeat(${ROWS}, var(--cell))`;

  const frag = document.createDocumentFragment();

  for (let r=0;r<ROWS;r++){
    for (let c=0;c<COLS;c++){
      const el = document.createElement("div");
      el.className = "cell";
      el.dataset.r = String(r);
      el.dataset.c = String(c);

      el.addEventListener("click", () => { onCellActivate(el); }, { passive: true });

      el.addEventListener("contextmenu",(e)=>{
        e.preventDefault();
      });

      frag.appendChild(el);
    }
  }

  boardEl.appendChild(frag);

  syncCellSizeToScreen();
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

// ===== tap activation =====
function onCellActivate(cellDiv){
  if (gameOver) return;

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
