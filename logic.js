/* =========================
   Mobile-friendly Minesweeper (full JS)
   - Tap = reveal
   - Long-press = flag (touch)
   - Right-click = flag (desktop)
   - Quick reveal / chording:
       Tap a revealed NUMBER cell → if flagged neighbors == number, it reveals the rest
   - Safe first click (3×3 around first click has no mines)
   - Fast rendering: creates DOM grid once, then updates only changed cells
   ========================= */

// ======= Settings =======
const MULTIPLIER = 5; // if you use this in CSS sizing, keep it here

const ROWS = 25;
const COLS = 50;
const NUM_MINES = Math.floor(ROWS * COLS * 0.15);

// Long press timing (touch)
const LONG_PRESS_MS = 350;
const MOVE_CANCEL_PX = 12;

// ======= State =======
let board = [];
let revealedCells = 0;
let firstClick = true;
let gameOver = false;

// DOM cache
let boardEl = null;
let bombCountEl = null;
let cellEls = []; // 2D array of divs

// Touch handling (to avoid double-trigger)
let pressTimer = null;
let pressStartX = 0;
let pressStartY = 0;
let pressActive = false;
let longPressFired = false;

// ======= Helpers =======
function inBounds(r, c) {
  return r >= 0 && r < ROWS && c >= 0 && c < COLS;
}

const directions8 = [
  [-1, -1], [-1, 0], [-1, 1],
  [ 0, -1],          [ 0, 1],
  [ 1, -1], [ 1, 0], [ 1, 1],
];

function neighbors(r, c) {
  const res = [];
  for (const [dr, dc] of directions8) {
    const nr = r + dr, nc = c + dc;
    if (inBounds(nr, nc)) res.push([nr, nc]);
  }
  return res;
}

function countFlaggedNeighbors(r, c) {
  let count = 0;
  for (const [nr, nc] of neighbors(r, c)) {
    if (board[nr][nc].flagged) count++;
  }
  return count;
}

// ======= Board creation =======
function createBoard() {
  board = Array.from({ length: ROWS }, () =>
    Array.from({ length: COLS }, () => ({
      mine: false,
      revealed: false,
      flagged: false,
      value: 0,
    }))
  );
  revealedCells = 0;
  firstClick = true;
  gameOver = false;
}

function placeMinesSafe(firstRow, firstCol) {
  // Safe zone: 3x3 centered on first click
  const safe = new Set();
  for (let r = firstRow - 1; r <= firstRow + 1; r++) {
    for (let c = firstCol - 1; c <= firstCol + 1; c++) {
      if (inBounds(r, c)) safe.add(`${r},${c}`);
    }
  }

  let minesPlaced = 0;
  while (minesPlaced < NUM_MINES) {
    const r = (Math.random() * ROWS) | 0;
    const c = (Math.random() * COLS) | 0;
    if (safe.has(`${r},${c}`)) continue;
    if (board[r][c].mine) continue;
    board[r][c].mine = true;
    minesPlaced++;
  }
}

function calculateValues() {
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const cell = board[r][c];
      if (cell.mine) continue;

      let v = 0;
      for (const [nr, nc] of neighbors(r, c)) {
        if (board[nr][nc].mine) v++;
      }
      cell.value = v;
    }
  }
}

// ======= Rendering (fast) =======
function buildDOMGridOnce() {
  boardEl = document.getElementById('board');
  bombCountEl = document.getElementById('bomb-count');

  // CSS tip: set #board { display:grid; grid-template-columns: repeat(COLS, ...); }
  // We do the columns here too, so it works even if CSS is minimal:
  boardEl.style.display = 'grid';
  boardEl.style.gridTemplateColumns = `repeat(${COLS}, 1fr)`;
  boardEl.style.touchAction = 'manipulation'; // helps mobile taps

  boardEl.innerHTML = '';
  cellEls = Array.from({ length: ROWS }, () => Array(COLS).fill(null));

  const frag = document.createDocumentFragment();

  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const el = document.createElement('div');
      el.className = 'cell';
      el.dataset.r = String(r);
      el.dataset.c = String(c);

      // Desktop right-click = flag
      el.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        if (gameOver) return;
        toggleFlag(r, c);
      });

      // Mobile + desktop: pointer events (covers mouse/touch/pen)
      el.addEventListener('pointerdown', onPointerDown);
      el.addEventListener('pointermove', onPointerMove);
      el.addEventListener('pointerup', onPointerUp);
      el.addEventListener('pointercancel', onPointerCancel);

      cellEls[r][c] = el;
      frag.appendChild(el);
    }
  }

  boardEl.appendChild(frag);
  updateBombCount();
  // Initial paint
  fullRepaint();
}

function fullRepaint() {
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      paintCell(r, c);
    }
  }
}

function paintCell(r, c) {
  const cell = board[r][c];
  const el = cellEls[r][c];

  // Reset text + classes that change
  el.textContent = '';
  el.classList.remove('revealed', 'flagged', 'mine');

  if (cell.revealed) {
    el.classList.add('revealed');
    if (cell.mine) {
      el.classList.add('mine');
      el.textContent = '💣';
    } else if (cell.value > 0) {
      el.textContent = String(cell.value);
    }
  } else if (cell.flagged) {
    el.classList.add('flagged');
    el.textContent = '🚩';
  }
}

function updateBombCount() {
  if (!bombCountEl) return;
  let flagged = 0;
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (board[r][c].flagged) flagged++;
    }
  }
  bombCountEl.textContent = `Bombs: ${NUM_MINES - flagged}`;
}

// ======= Game logic =======
function revealAllMines() {
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (board[r][c].mine) {
        board[r][c].revealed = true;
        paintCell(r, c);
      }
    }
  }
}

function endGameLose() {
  gameOver = true;
  revealAllMines();
  // keep it simple; replace with your own UI if you want
  setTimeout(() => alert('Game Over!'), 10);
}

function endGameWin() {
  gameOver = true;
  setTimeout(() => alert('You Win!'), 10);
}

function checkWin() {
  if (revealedCells === ROWS * COLS - NUM_MINES) endGameWin();
}

function toggleFlag(r, c) {
  const cell = board[r][c];
  if (gameOver) return;
  if (cell.revealed) return;

  cell.flagged = !cell.flagged;
  paintCell(r, c);
  updateBombCount();
}

function revealSingleCell(r, c) {
  const cell = board[r][c];
  if (cell.revealed || cell.flagged) return;

  cell.revealed = true;
  revealedCells++;
  paintCell(r, c);
}

function floodRevealFromZero(startR, startC) {
  // Iterative flood-fill:
  // reveals all connected zero cells + the bordering number cells.
  const stack = [[startR, startC]];

  while (stack.length) {
    const [r, c] = stack.pop();
    if (!inBounds(r, c)) continue;

    const cell = board[r][c];
    if (cell.revealed || cell.flagged) continue;
    if (cell.mine) continue;

    cell.revealed = true;
    revealedCells++;
    paintCell(r, c);

    if (cell.value === 0) {
      for (const [nr, nc] of neighbors(r, c)) {
        const ncell = board[nr][nc];
        // push everything; guards above will stop repeats
        if (!ncell.revealed && !ncell.flagged) stack.push([nr, nc]);
      }
    }
  }
}

function revealCell(r, c) {
  if (gameOver) return;

  const cell = board[r][c];
  if (cell.flagged) return;

  if (firstClick) {
    firstClick = false;
    placeMinesSafe(r, c);
    calculateValues();
  }

  if (cell.revealed) {
    // Quick reveal / chording:
    // Tap a revealed number cell: if flagged neighbors == number, reveal remaining neighbors.
    if (cell.value > 0) {
      quickRevealNeighbors(r, c);
      checkWin();
    }
    return;
  }

  if (cell.mine) {
    cell.revealed = true;
    paintCell(r, c);
    endGameLose();
    return;
  }

  if (cell.value === 0) {
    floodRevealFromZero(r, c);
  } else {
    revealSingleCell(r, c);
  }

  checkWin();
}

function quickRevealNeighbors(r, c) {
  const cell = board[r][c];
  if (!cell.revealed || cell.value <= 0) return;

  const flagged = countFlaggedNeighbors(r, c);
  if (flagged !== cell.value) return; // strict rule

  for (const [nr, nc] of neighbors(r, c)) {
    const ncell = board[nr][nc];
    if (ncell.flagged || ncell.revealed) continue;

    // If player incorrectly flagged, this can cause a mine reveal (like real Minesweeper)
    if (ncell.mine) {
      ncell.revealed = true;
      paintCell(nr, nc);
      endGameLose();
      return;
    }

    if (ncell.value === 0) floodRevealFromZero(nr, nc);
    else revealSingleCell(nr, nc);
  }
}

// ======= Touch / pointer controls =======
function getCellRCFromEvent(e) {
  const el = e.currentTarget;
  const r = parseInt(el.dataset.r, 10);
  const c = parseInt(el.dataset.c, 10);
  return [r, c];
}

function onPointerDown(e) {
  if (gameOver) return;

  // If it's a mouse click, we can just reveal on pointerup (no long press needed).
  // For touch/pen: long press flags.
  pressActive = true;
  longPressFired = false;
  pressStartX = e.clientX;
  pressStartY = e.clientY;

  // capture pointer so moves/up stay consistent
  e.currentTarget.setPointerCapture?.(e.pointerId);

  if (e.pointerType === 'touch' || e.pointerType === 'pen') {
    clearTimeout(pressTimer);
    pressTimer = setTimeout(() => {
      if (!pressActive) return;
      longPressFired = true;
      const [r, c] = getCellRCFromEvent(e);
      toggleFlag(r, c);
    }, LONG_PRESS_MS);
  }
}

function onPointerMove(e) {
  if (!pressActive) return;
  const dx = e.clientX - pressStartX;
  const dy = e.clientY - pressStartY;
  if ((dx * dx + dy * dy) > (MOVE_CANCEL_PX * MOVE_CANCEL_PX)) {
    // cancel long press if user is scrolling / moving finger
    clearTimeout(pressTimer);
  }
}

function onPointerUp(e) {
  if (!pressActive) return;
  pressActive = false;
  clearTimeout(pressTimer);

  // If long press already flagged, do NOT also reveal.
  if (longPressFired) return;

  const [r, c] = getCellRCFromEvent(e);

  // For mouse: left click reveal; right click handled by contextmenu already.
  // For touch: tap reveal.
  revealCell(r, c);
}

function onPointerCancel() {
  pressActive = false;
  clearTimeout(pressTimer);
}

// ======= Init =======
function startGame() {
  createBoard();
  // Build DOM once; if already built, just repaint
  if (!document.getElementById('board')) {
    console.error('Missing #board element in HTML');
    return;
  }
  if (!cellEls.length) buildDOMGridOnce();
  else {
    updateBombCount();
    fullRepaint();
  }
}

// Start
startGame();

/*
  Minimal HTML expected:
    <div id="hud"><span id="bomb-count"></span></div>
    <div id="board"></div>

  Minimal CSS suggestion (you likely already have your own):
    #board { gap: 1px; }
    .cell { user-select:none; display:flex; align-items:center; justify-content:center; }
    .cell.revealed { /* styling *\/ }
    .cell.flagged { /* styling *\/ }
*/
