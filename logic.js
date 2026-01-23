// =========================
// Mobile-friendly Minesweeper
// =========================

const ROWS = 25;
const COLS = 50;
const NUM_MINES = Math.floor(ROWS * COLS * 0.15);

// timing
const LONG_PRESS_MS = 350;
const DOUBLE_TAP_MS = 280;
const MOVE_CANCEL_PX = 12;

let board = [];
let revealedCells = 0;
let firstClick = true;
let gameOver = false;

// DOM
let boardEl, bombCountEl, cellEls = [];

// touch / click state
let pressTimer = null;
let pressActive = false;
let longPressFired = false;
let pressStartX = 0;
let pressStartY = 0;

let lastTapTime = 0;
let lastTapR = -1;
let lastTapC = -1;

// helpers
const directions8 = [
  [-1, -1], [-1, 0], [-1, 1],
  [ 0, -1],          [ 0, 1],
  [ 1, -1], [ 1, 0], [ 1, 1],
];

function inBounds(r, c) {
  return r >= 0 && r < ROWS && c >= 0 && c < COLS;
}

function neighbors(r, c) {
  const res = [];
  for (const [dr, dc] of directions8) {
    const nr = r + dr, nc = c + dc;
    if (inBounds(nr, nc)) res.push([nr, nc]);
  }
  return res;
}

function countFlaggedNeighbors(r, c) {
  let n = 0;
  for (const [nr, nc] of neighbors(r, c)) {
    if (board[nr][nc].flagged) n++;
  }
  return n;
}

// =========================
// Board
// =========================
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

function placeMinesSafe(sr, sc) {
  const safe = new Set();
  for (let r = sr - 1; r <= sr + 1; r++) {
    for (let c = sc - 1; c <= sc + 1; c++) {
      if (inBounds(r, c)) safe.add(`${r},${c}`);
    }
  }

  let placed = 0;
  while (placed < NUM_MINES) {
    const r = (Math.random() * ROWS) | 0;
    const c = (Math.random() * COLS) | 0;
    if (safe.has(`${r},${c}`)) continue;
    if (board[r][c].mine) continue;
    board[r][c].mine = true;
    placed++;
  }
}

function calculateValues() {
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (board[r][c].mine) continue;
      let v = 0;
      for (const [nr, nc] of neighbors(r, c)) {
        if (board[nr][nc].mine) v++;
      }
      board[r][c].value = v;
    }
  }
}

// =========================
// Rendering
// =========================
function buildDOM() {
  boardEl = document.getElementById("board");
  bombCountEl = document.getElementById("bomb-count");

  boardEl.style.display = "grid";
  boardEl.style.gridTemplateColumns = `repeat(${COLS}, 1fr)`;
  boardEl.style.touchAction = "manipulation";

  boardEl.innerHTML = "";
  cellEls = Array.from({ length: ROWS }, () => Array(COLS));

  const frag = document.createDocumentFragment();

  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const el = document.createElement("div");
      el.className = "cell";
      el.dataset.r = r;
      el.dataset.c = c;

      el.addEventListener("contextmenu", e => {
        e.preventDefault();
        if (!gameOver) toggleFlag(r, c);
      });

      el.addEventListener("pointerdown", onPointerDown);
      el.addEventListener("pointermove", onPointerMove);
      el.addEventListener("pointerup", onPointerUp);
      el.addEventListener("pointercancel", onPointerCancel);

      cellEls[r][c] = el;
      frag.appendChild(el);
    }
  }

  boardEl.appendChild(frag);
  updateBombCount();
  fullRepaint();
}

function paintCell(r, c) {
  const cell = board[r][c];
  const el = cellEls[r][c];

  el.textContent = "";
  el.classList.remove("revealed", "flagged", "mine");

  if (cell.revealed) {
    el.classList.add("revealed");
    if (cell.mine) {
      el.classList.add("mine");
      el.textContent = "💣";
    } else if (cell.value > 0) {
      el.textContent = cell.value;
    }
  } else if (cell.flagged) {
    el.classList.add("flagged");
    el.textContent = "🚩";
  }
}

function fullRepaint() {
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      paintCell(r, c);
    }
  }
}

function updateBombCount() {
  let flagged = 0;
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (board[r][c].flagged) flagged++;
    }
  }
  bombCountEl.textContent = `Bombs: ${NUM_MINES - flagged}`;
}

// =========================
// Game logic
// =========================
function toggleFlag(r, c) {
  const cell = board[r][c];
  if (gameOver || cell.revealed) return;

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

function floodRevealFromZero(sr, sc) {
  const stack = [[sr, sc]];

  while (stack.length) {
    const [r, c] = stack.pop();
    if (!inBounds(r, c)) continue;

    const cell = board[r][c];
    if (cell.revealed || cell.flagged || cell.mine) continue;

    cell.revealed = true;
    revealedCells++;
    paintCell(r, c);

    if (cell.value === 0) {
      for (const [nr, nc] of neighbors(r, c)) {
        stack.push([nr, nc]);
      }
    }
  }
}

function quickRevealNeighbors(r, c) {
  const cell = board[r][c];
  if (!cell.revealed || cell.value <= 0) return;

  const flagged = countFlaggedNeighbors(r, c);
  if (flagged !== cell.value) return;

  for (const [nr, nc] of neighbors(r, c)) {
    const ncell = board[nr][nc];
    if (ncell.revealed || ncell.flagged) continue;

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

function revealCell(r, c) {
  if (gameOver) return;
  const cell = board[r][c];
  if (cell.flagged) return;

  if (firstClick) {
    firstClick = false;
    placeMinesSafe(r, c);
    calculateValues();
  }

  if (cell.revealed) return;

  if (cell.mine) {
    cell.revealed = true;
    paintCell(r, c);
    endGameLose();
    return;
  }

  if (cell.value === 0) floodRevealFromZero(r, c);
  else revealSingleCell(r, c);

  checkWin();
}

function checkWin() {
  if (revealedCells === ROWS * COLS - NUM_MINES) {
    gameOver = true;
    setTimeout(() => alert("You Win!"), 10);
  }
}

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
  setTimeout(() => alert("Game Over!"), 10);
}

// =========================
// Pointer + double-tap logic
// =========================
function getRC(e) {
  const el = e.currentTarget;
  return [parseInt(el.dataset.r, 10), parseInt(el.dataset.c, 10)];
}

function onPointerDown(e) {
  if (gameOver) return;

  pressActive = true;
  longPressFired = false;
  pressStartX = e.clientX;
  pressStartY = e.clientY;

  e.currentTarget.setPointerCapture?.(e.pointerId);

  if (e.pointerType !== "mouse") {
    clearTimeout(pressTimer);
    pressTimer = setTimeout(() => {
      if (!pressActive) return;
      longPressFired = true;
      const [r, c] = getRC(e);
      toggleFlag(r, c);
    }, LONG_PRESS_MS);
  }
}

function onPointerMove(e) {
  if (!pressActive) return;
  const dx = e.clientX - pressStartX;
  const dy = e.clientY - pressStartY;
  if (dx * dx + dy * dy > MOVE_CANCEL_PX * MOVE_CANCEL_PX) {
    clearTimeout(pressTimer);
  }
}

function onPointerUp(e) {
  if (!pressActive) return;
  pressActive = false;
  clearTimeout(pressTimer);

  if (longPressFired) return;

  const [r, c] = getRC(e);
  const now = Date.now();

  // ----- DOUBLE TAP / DOUBLE CLICK -----
  if (now - lastTapTime < DOUBLE_TAP_MS && lastTapR === r && lastTapC === c) {
    lastTapTime = 0;

    const cell = board[r][c];

    if (!cell.revealed) {
      toggleFlag(r, c); // double-tap flag
    } else if (cell.value > 0) {
      quickRevealNeighbors(r, c); // double-tap chord
      checkWin();
    }

    return;
  }

  lastTapTime = now;
  lastTapR = r;
  lastTapC = c;

  // ----- SINGLE TAP -----
  revealCell(r, c);
}

function onPointerCancel() {
  pressActive = false;
  clearTimeout(pressTimer);
}

// =========================
// Init
// =========================
function startGame() {
  createBoard();
  buildDOM();
}

startGame();

/*
Expected HTML:

<div id="hud">
  <span id="bomb-count"></span>
</div>
<div id="board"></div>

Minimal CSS idea:

#board { gap: 1px; }
.cell {
  user-select: none;
  display: flex;
  align-items: center;
  justify-content: center;
}
.cell.revealed { background: #ddd; }
.cell.flagged { background: #bbb; }s

*/
