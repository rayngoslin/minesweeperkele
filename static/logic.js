// ===============================
// Minesweeper logic.js (clean)
// - Frontend-only (no Flask)
// - Safe first click (must be 0)
// - Flood reveal
// - Flags + chording (right click on revealed number)
// - Timer + mine counter
// - Telegram/GitHub Pages friendly paths (./static/...)
// ===============================

// ---------- Config ----------
const ROWS = 32;
const COLS = 25;
const NUM_MINES = 100;

// Asset paths (make sure filenames/case match your /static folder!)
const ASSET_BOMB = "./static/bmb1.jpg";     // choose ONE case and stick with it
const ASSET_FLAG = "./static/flag1.jpg";
const LOGO_FRAME_PATH = "./static/logo/frame"; // frame1.jpg ... frame12.jpg
const LOGO_FRAMES = 12;
const LOGO_INTERVAL_MS = 500;

// ---------- State ----------
let board = [];                 // 2D: {mine, value}
let revealed = new Set();       // "r,c"
let flagged = new Set();        // "r,c"
let gameOver = false;
let firstClick = true;

let timerInterval = null;
let startTime = null;

function key(r, c) { return `${r},${c}`; }
function parseKey(k) { const [r, c] = k.split(",").map(Number); return { r, c }; }
function inBounds(r, c) { return r >= 0 && r < ROWS && c >= 0 && c < COLS; }

function neighbors(r, c) {
  const out = [];
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (dr === 0 && dc === 0) continue;
      const nr = r + dr, nc = c + dc;
      if (inBounds(nr, nc)) out.push({ r: nr, c: nc });
    }
  }
  return out;
}

// ---------- Board generation ----------
function createEmptyBoard() {
  return Array.from({ length: ROWS }, () =>
    Array.from({ length: COLS }, () => ({ mine: false, value: 0 }))
  );
}

function sampleUniquePositions(max, count, excludedSet) {
  const picked = new Set();
  while (picked.size < count) {
    const pos = Math.floor(Math.random() * max);
    if (excludedSet && excludedSet.has(pos)) continue;
    picked.add(pos);
  }
  return [...picked];
}

function computeValues(b) {
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (b[r][c].mine) continue;
      let v = 0;
      for (const n of neighbors(r, c)) {
        if (b[n.r][n.c].mine) v++;
      }
      b[r][c].value = v;
    }
  }
}

function generateBoardSafe(firstR, firstC) {
  // Python-like behavior: exclude 3x3 around first click AND require first cell value == 0
  while (true) {
    const b = createEmptyBoard();

    const excluded = new Set();
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        const nr = firstR + dr, nc = firstC + dc;
        if (inBounds(nr, nc)) excluded.add(nr * COLS + nc);
      }
    }

    const mines = sampleUniquePositions(ROWS * COLS, NUM_MINES, excluded);
    for (const pos of mines) {
      const r = Math.floor(pos / COLS);
      const c = pos % COLS;
      b[r][c].mine = true;
    }

    computeValues(b);

    if (b[firstR][firstC].value === 0) return b;
  }
}

function generateBoardInitial() {
  // Placeholder board before first click (no mines needed yet)
  // We'll regenerate on first click to guarantee safety
  const b = createEmptyBoard();
  return b;
}

// ---------- UI helpers ----------
function $(id) { return document.getElementById(id); }

function setVisible(el, show, displayType = "block") {
  if (!el) return;
  el.style.display = show ? displayType : "none";
}

function updateMineCounter() {
  const mineCountEl = $("mine-count");
  if (!mineCountEl) return;

  const remaining = NUM_MINES - flagged.size;
  mineCountEl.innerHTML = `
    <img src="${ASSET_BOMB}" alt="💣"
      style="width: 48px; height: 48px; vertical-align: middle; margin-right: 10px;">
    ${remaining}
  `;
}

function startTimer() {
  const timerEl = $("timer");
  startTime = Date.now();

  if (timerEl) timerEl.textContent = "Time: 0s";
  stopTimer();

  timerInterval = setInterval(() => {
    const s = Math.floor((Date.now() - startTime) / 1000);
    if (timerEl) timerEl.textContent = `Time: ${s}s`;
  }, 1000);
}

function stopTimer() {
  if (timerInterval) clearInterval(timerInterval);
  timerInterval = null;
}

function animatePop(td) {
  if (!td) return;
  td.classList.add("cell-pop");
  td.addEventListener("animationend", () => td.classList.remove("cell-pop"), { once: true });
}

// If you have your own corner logic, you can keep calling it.
// We'll only call it if it exists.
function safeApplyCornerClasses() {
  if (typeof applyCornerClasses === "function") applyCornerClasses();
}

// ---------- Rendering ----------
function buildTable() {
  const table = $("board");
  table.innerHTML = "";

  for (let r = 0; r < ROWS; r++) {
    const tr = document.createElement("tr");
    for (let c = 0; c < COLS; c++) {
      const td = document.createElement("td");
      td.dataset.row = String(r);
      td.dataset.col = String(c);

      // keep your wrapper corners if your CSS expects it
      const wrapper = document.createElement("div");
      wrapper.classList.add("cell-wrapper");
      wrapper.innerHTML = `
        <div class="corner tiny-top-left"></div>
        <div class="corner tiny-top-right"></div>
        <div class="corner tiny-bottom-left"></div>
        <div class="corner tiny-bottom-right"></div>
      `;
      td.appendChild(wrapper);

      td.addEventListener("click", () => onLeftClick(r, c, td));
      td.addEventListener("contextmenu", (e) => onRightClick(e, r, c, td));

      tr.appendChild(td);
    }
    table.appendChild(tr);
  }
}

function tdAt(r, c) {
  const table = $("board");
  return table?.rows?.[r]?.cells?.[c] ?? null;
}

function showCell(r, c) {
  const td = tdAt(r, c);
  if (!td) return;

  const k = key(r, c);
  if (revealed.has(k)) return;

  revealed.add(k);
  td.classList.add("revealed", "liquified-cell-text");

  const cell = board[r][c];

  // clear wrapper but keep it simple: overwrite cell content
  // If you want wrapper corners visible, remove the next line.
  // td.innerHTML = "";

  if (cell.mine) {
    td.innerHTML = `<img src="${ASSET_BOMB}" alt="💣" style="height:100%; width:100%;">`;
  } else if (cell.value > 0) {
    td.textContent = String(cell.value);
  } else {
    td.textContent = "";
  }

  animatePop(td);
}

function setFlag(r, c, shouldFlag) {
  const td = tdAt(r, c);
  if (!td) return;

  const k = key(r, c);
  if (revealed.has(k)) return;

  if (shouldFlag) {
    flagged.add(k);
    td.classList.add("flagged");
    td.innerHTML = `<img src="${ASSET_FLAG}" alt="Flag" style="height:100%; width:100%;">`;
  } else {
    flagged.delete(k);
    td.classList.remove("flagged");
    td.textContent = "";
    // restore wrapper corners if you want them always present:
    // td.innerHTML = `<div class="cell-wrapper">...</div>`; // optional
  }

  animatePop(td);
  updateMineCounter();
  safeApplyCornerClasses();
}

// ---------- Gameplay ----------
function floodReveal(startR, startC) {
  const q = [{ r: startR, c: startC }];

  while (q.length) {
    const { r, c } = q.shift();
    const k = key(r, c);

    if (revealed.has(k)) continue;
    if (flagged.has(k)) continue;

    showCell(r, c);

    const cell = board[r][c];
    if (cell.value === 0) {
      for (const n of neighbors(r, c)) {
        const nk = key(n.r, n.c);
        if (!revealed.has(nk) && !flagged.has(nk)) q.push(n);
      }
    }
  }
}

function revealAllMines() {
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (board[r][c].mine) {
        const td = tdAt(r, c);
        if (!td) continue;
        td.classList.add("revealed", "liquified-cell-text");
        td.innerHTML = `<img src="${ASSET_BOMB}" alt="💣" style="height:100%; width:100%;">`;
      }
    }
  }
}

function checkWin() {
  // Win = all non-mine cells revealed
  let revealedSafe = 0;
  const totalSafe = ROWS * COLS - NUM_MINES;

  for (const k of revealed) {
    const { r, c } = parseKey(k);
    if (!board[r][c].mine) revealedSafe++;
  }

  if (revealedSafe >= totalSafe) {
    gameOver = true;
    stopTimer();
    revealAllMines();
    // Telegram webview: alerts are meh, but keep it simple for now
    setTimeout(() => alert("Congratulations! You win!"), 50);
    setTimeout(resetToStart, 1500);
  }
}

function chordReveal(r, c) {
  // If cell is revealed and number of flagged neighbors matches value, reveal remaining neighbors
  const td = tdAt(r, c);
  if (!td) return;

  const k = key(r, c);
  if (!revealed.has(k)) return;

  const val = board[r][c].value;
  if (!val || val <= 0) return;

  let flaggedCount = 0;
  const toReveal = [];

  for (const n of neighbors(r, c)) {
    const nk = key(n.r, n.c);
    if (flagged.has(nk)) flaggedCount++;
    else if (!revealed.has(nk)) toReveal.push(n);
  }

  if (flaggedCount === val) {
    for (const n of toReveal) {
      if (board[n.r][n.c].mine) {
        // player messed up flags
        gameOver = true;
        stopTimer();
        revealAllMines();
        setTimeout(() => alert("Game Over! You revealed a mine!"), 50);
        setTimeout(resetToStart, 1500);
        return;
      }
      if (board[n.r][n.c].value === 0) floodReveal(n.r, n.c);
      else showCell(n.r, n.c);
    }
    safeApplyCornerClasses();
    checkWin();
  }
}

// ---------- Click handlers ----------
function onLeftClick(r, c, td) {
  if (gameOver) return;
  const k = key(r, c);
  if (revealed.has(k)) return;
  if (flagged.has(k)) return;

  // First click: generate a safe board and keep click cell as 0
  if (firstClick) {
    firstClick = false;
    board = generateBoardSafe(r, c);
    startTimer();
    // Rebuild table to reset any DOM text/flags from placeholder
    buildTable();
    updateMineCounter();
    // Now reveal
    floodReveal(r, c);
    safeApplyCornerClasses();
    checkWin();
    return;
  }

  const cell = board[r][c];
  if (cell.mine) {
    gameOver = true;
    stopTimer();
    td.innerHTML = `<img src="${ASSET_BOMB}" alt="💣" style="height:100%; width:100%;">`;
    td.classList.add("revealed", "liquified-cell-text");
    animatePop(td);
    revealAllMines();
    setTimeout(() => alert("Game Over! You clicked a mine!"), 50);
    setTimeout(resetToStart, 1500);
    return;
  }

  if (cell.value === 0) floodReveal(r, c);
  else showCell(r, c);

  safeApplyCornerClasses();
  checkWin();
}

function onRightClick(e, r, c, td) {
  e.preventDefault();
  if (gameOver) return;

  const k = key(r, c);

  // If revealed: chord behavior
  if (revealed.has(k)) {
    chordReveal(r, c);
    return;
  }

  // Toggle flag
  setFlag(r, c, !flagged.has(k));
}

// ---------- Start/Reset ----------
function startGame() {
  gameOver = false;
  firstClick = true;
  revealed = new Set();
  flagged = new Set();
  stopTimer();

  // UI (keep your existing elements; only hide/show what exists)
  setVisible($("start-btn"), false);
  setVisible($("animated-title"), false);
  setVisible($("mine-count"), true, "block");
  setVisible($("board"), true, "table");

  document.querySelector(".board-container")?.classList?.add("game-active");

  board = generateBoardInitial();
  buildTable();
  updateMineCounter();
  safeApplyCornerClasses();

  const timerEl = $("timer");
  if (timerEl) timerEl.textContent = "Time: 0s";
}

function resetToStart() {
  gameOver = false;
  firstClick = true;
  stopTimer();

  setVisible($("board"), false);
  setVisible($("mine-count"), false);
  setVisible($("start-btn"), true, "block");
  setVisible($("animated-title"), true, "block");

  document.querySelector(".board-container")?.classList?.remove("game-active");
}

// ---------- Animated title ----------
let currentFrame = 1;
function animateTitle() {
  const img = $("animated-title");
  if (!img) return;
  currentFrame = (currentFrame % LOGO_FRAMES) + 1;
  img.src = `${LOGO_FRAME_PATH}${currentFrame}.jpg`;
}
setInterval(animateTitle, LOGO_INTERVAL_MS);

// ---------- Boot ----------
window.addEventListener("load", () => {
  const startBtn = $("start-btn");
  if (startBtn) startBtn.addEventListener("click", startGame);

  // initial UI state
  setVisible($("board"), false);
  setVisible($("mine-count"), false);
  setVisible($("animated-title"), true, "block");
  setVisible($("start-btn"), true, "block");

  // If you want the board pre-built for faster first start:
  // board = generateBoardInitial(); buildTable();
});
