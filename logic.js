// logic.js — keeps your mode toggle (reveal/flag) exactly as in your HTML
// Adds:
// - Proper flood reveal (fixed)
// - Safe first click (3x3 safe zone)
// - Quick mapping (double-click / double-tap) on a REVEALED number cell in REVEAL mode:
//     If flaggedNeighbors == number => reveal all other hidden neighbors (classic chord)
// - Quick flagging (double-click / double-tap) on a REVEALED number cell in FLAG mode:
//     If (number - flaggedNeighbors) == hiddenUnflaggedNeighborsCount => flag them all (deterministic)
// - Mobile: double-tap supported via Pointer Events
// - Still supports right-click to toggle flag regardless of mode (optional but nice on desktop)

const MULTIPLIER = 5; // (kept, in case your CSS uses it)

const ROWS = 25;
const COLS = 50;
const NUM_MINES = Math.floor(ROWS * COLS * 0.15);

let board = [];
let revealedCells = 0;
let mode = "reveal"; // <-- YOUR MODE SYSTEM
let firstClick = true;
let gameOver = false;

// UI
const boardElement = document.getElementById("board");
const bombCountElement = document.getElementById("bomb-count");
const restartBtn = document.getElementById("restart-btn");
const toggleModeBtn = document.getElementById("toggle-mode");

// Double tap/click
const DOUBLE_TAP_MS = 280;
let lastTapTime = 0;
let lastTapR = -1;
let lastTapC = -1;

// Neighbors
const DIR8 = [
  [-1, -1], [-1, 0], [-1, 1],
  [ 0, -1],          [ 0, 1],
  [ 1, -1], [ 1, 0], [ 1, 1],
];

function inBounds(r, c) {
  return r >= 0 && r < ROWS && c >= 0 && c < COLS;
}

function forEachNeighbor(r, c, fn) {
  for (const [dr, dc] of DIR8) {
    const nr = r + dr, nc = c + dc;
    if (inBounds(nr, nc)) fn(nr, nc);
  }
}

function countFlaggedNeighbors(r, c) {
  let n = 0;
  forEachNeighbor(r, c, (nr, nc) => {
    if (board[nr][nc].flagged) n++;
  });
  return n;
}

function listHiddenUnflaggedNeighbors(r, c) {
  const out = [];
  forEachNeighbor(r, c, (nr, nc) => {
    const cell = board[nr][nc];
    if (!cell.revealed && !cell.flagged) out.push([nr, nc]);
  });
  return out;
}

// ======= Board setup =======
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
  // 3x3 safe zone around first click (feels like real Minesweeper)
  const safe = new Set();
  for (let r = firstRow - 1; r <= firstRow + 1; r++) {
    for (let c = firstCol - 1; c <= firstCol + 1; c++) {
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
      const cell = board[r][c];
      if (cell.mine) continue;

      let v = 0;
      forEachNeighbor(r, c, (nr, nc) => {
        if (board[nr][nc].mine) v++;
      });
      cell.value = v;
    }
  }
}

// ======= Rendering =======
function updateBombCount() {
  const flagged = board.flat().reduce((acc, cell) => acc + (cell.flagged ? 1 : 0), 0);
  bombCountElement.textContent = `Bombs: ${NUM_MINES - flagged}`;
}

function renderBoard() {
  boardElement.innerHTML = "";

  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const cell = board[r][c];
      const el = document.createElement("div");
      el.classList.add("cell");
      el.dataset.r = String(r);
      el.dataset.c = String(c);

      if (cell.revealed) {
        el.classList.add("revealed");
        el.textContent = cell.mine ? "💣" : (cell.value || "");
      } else if (cell.flagged) {
        el.textContent = "🚩";
      }

      // Pointer-based click (touch + mouse)
      el.addEventListener("pointerup", onCellPointerUp);

      // Desktop right click: toggle flag (doesn't interfere with your mode)
      el.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        if (gameOver) return;
        toggleFlag(r, c);
        renderBoard();
      });

      boardElement.appendChild(el);
    }
  }

  updateBombCount();
}

// ======= Game logic =======
function revealAllMines() {
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (board[r][c].mine) board[r][c].revealed = true;
    }
  }
}

function loseGame() {
  gameOver = true;
  revealAllMines();
  renderBoard();
  setTimeout(() => alert("Game Over!"), 10);
}

function winCheck() {
  if (revealedCells === ROWS * COLS - NUM_MINES) {
    gameOver = true;
    renderBoard();
    setTimeout(() => alert("You Win!"), 10);
  }
}

function toggleFlag(r, c) {
  const cell = board[r][c];
  if (cell.revealed) return;
  cell.flagged = !cell.flagged;
}

function revealCell(r, c) {
  const cell = board[r][c];
  if (cell.revealed || cell.flagged) return;

  cell.revealed = true;
  revealedCells++;

  if (cell.mine) {
    loseGame();
    return;
  }

  if (cell.value === 0) {
    floodReveal(r, c);
  }

  winCheck();
}

// Proper flood reveal: reveals zero-region + bordering numbers, never mines
function floodReveal(startR, startC) {
  const stack = [[startR, startC]];

  while (stack.length) {
    const [r, c] = stack.pop();
    if (!inBounds(r, c)) continue;

    const cell = board[r][c];
    if (cell.revealed || cell.flagged) continue;
    if (cell.mine) continue;

    cell.revealed = true;
    revealedCells++;

    if (cell.value === 0) {
      forEachNeighbor(r, c, (nr, nc) => {
        const ncell = board[nr][nc];
        if (!ncell.revealed && !ncell.flagged) stack.push([nr, nc]);
      });
    }
  }
}

// ======= Quick mapping / quick flagging on revealed numbers =======
//
// REVEAL mode double-click on revealed number:
//   if flaggedNeighbors == number => reveal all other hidden neighbors
function quickMapReveal(r, c) {
  const cell = board[r][c];
  if (!cell.revealed || cell.value <= 0) return;

  const flagged = countFlaggedNeighbors(r, c);
  if (flagged !== cell.value) return;

  const targets = listHiddenUnflaggedNeighbors(r, c);
  for (const [nr, nc] of targets) {
    const ncell = board[nr][nc];

    // If flags are wrong, you can still hit a mine here (classic behavior)
    if (ncell.mine) {
      ncell.revealed = true;
      loseGame();
      return;
    }

    if (ncell.value === 0) floodReveal(nr, nc);
    else revealCell(nr, nc);
    if (gameOver) return;
  }
}

// FLAG mode double-click on revealed number:
//   if (number - flaggedNeighbors) == hiddenUnflaggedNeighborsCount => flag them all
function quickMapFlag(r, c) {
  const cell = board[r][c];
  if (!cell.revealed || cell.value <= 0) return;

  const flagged = countFlaggedNeighbors(r, c);
  const targets = listHiddenUnflaggedNeighbors(r, c);
  const needFlags = cell.value - flagged;

  if (needFlags <= 0) return;
  if (needFlags !== targets.length) return;

  for (const [nr, nc] of targets) {
    board[nr][nc].flagged = true;
  }
}

// ======= Input handler (single vs double tap/click) =======
function onCellPointerUp(e) {
  if (gameOver) return;

  const el = e.currentTarget;
  const r = parseInt(el.dataset.r, 10);
  const c = parseInt(el.dataset.c, 10);

  const now = Date.now();
  const isDouble =
    (now - lastTapTime) < DOUBLE_TAP_MS &&
    lastTapR === r &&
    lastTapC === c;

  if (isDouble) {
    // consume double
    lastTapTime = 0;
    lastTapR = -1;
    lastTapC = -1;

    // Double-tap behavior depends on MODE and whether this cell is revealed number
    if (mode === "reveal") {
      // Quick mapping/chording on revealed number cells
      quickMapReveal(r, c);
    } else {
      // Flag mode: quick flag mapping on revealed number cells
      quickMapFlag(r, c);
    }

    renderBoard();
    return;
  }

  // store for possible double
  lastTapTime = now;
  lastTapR = r;
  lastTapC = c;

  // Single tap behavior uses YOUR toggle mode
  if (firstClick && mode === "reveal") {
    firstClick = false;
    placeMinesSafe(r, c);
    calculateValues();
  } else if (firstClick && mode === "flag") {
    // If user starts by flagging, don't place mines yet.
    // Mines are placed on first REVEAL click only (keeps rules sane).
  }

  if (mode === "flag") {
    // single tap in flag mode = flag/unflag
    toggleFlag(r, c);
    renderBoard();
    return;
  }

  // reveal mode single tap
  revealCell(r, c);
  renderBoard();
}

// ======= UI buttons =======
restartBtn.addEventListener("click", () => {
  createBoard();
  renderBoard();
});

toggleModeBtn.addEventListener("click", () => {
  mode = (mode === "reveal") ? "flag" : "reveal";
  toggleModeBtn.textContent = (mode === "reveal")
    ? "Switch to Flag Mode"
    : "Switch to Reveal Mode";
});

// ======= Init =======
createBoard();
renderBoard();
toggleModeBtn.textContent = "Switch to Flag Mode";
