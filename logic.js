// ===== Minesweeper (fresh, stable, mobile+desktop) =====

const ROWS = 25;
const COLS = 50;
const NUM_MINES = Math.floor(ROWS * COLS * 0.15);

let board;
let revealedCount;
let mode = "reveal";      // "reveal" or "flag"
let minesPlaced = false;  // place mines on first REVEAL action
let gameOver = false;

// UI
const boardEl = document.getElementById("board");
const bombEl = document.getElementById("bomb-count");
const toggleBtn = document.getElementById("toggle-mode");
const restartBtn = document.getElementById("restart-btn");

// Double-tap handling (prevents single firing twice on mobile)
const DOUBLE_MS = 240;
let pendingTap = null;     // { r, c, t }
let pendingTimer = null;

const DIR8 = [
  [-1,-1], [-1,0], [-1,1],
  [ 0,-1],         [ 0,1],
  [ 1,-1], [ 1,0], [ 1,1],
];

function inBounds(r,c){ return r>=0 && r<ROWS && c>=0 && c<COLS; }

function forEachNeighbor(r,c,fn){
  for (const [dr,dc] of DIR8){
    const nr=r+dr, nc=c+dc;
    if (inBounds(nr,nc)) fn(nr,nc);
  }
}

function createBoard(){
  board = Array.from({length: ROWS}, () =>
    Array.from({length: COLS}, () => ({
      mine:false,
      revealed:false,
      flagged:false,
      value:0,
    }))
  );
  revealedCount = 0;
  minesPlaced = false;
  gameOver = false;
}

function placeMinesSafe(sr, sc){
  // Safe zone 3x3
  const safe = new Set();
  for (let r=sr-1;r<=sr+1;r++){
    for (let c=sc-1;c<=sc+1;c++){
      if (inBounds(r,c)) safe.add(`${r},${c}`);
    }
  }

  let placed = 0;
  while (placed < NUM_MINES){
    const r = (Math.random() * ROWS) | 0;
    const c = (Math.random() * COLS) | 0;
    if (safe.has(`${r},${c}`)) continue;
    if (board[r][c].mine) continue;
    board[r][c].mine = true;
    placed++;
  }
}

function calcValues(){
  for (let r=0;r<ROWS;r++){
    for (let c=0;c<COLS;c++){
      if (board[r][c].mine) continue;
      let v=0;
      forEachNeighbor(r,c,(nr,nc)=>{ if (board[nr][nc].mine) v++; });
      board[r][c].value = v;
    }
  }
}

function countFlags(){
  let f=0;
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

function buildGrid(){
  boardEl.style.gridTemplateColumns = `repeat(${COLS}, var(--cell))`;
  boardEl.innerHTML = "";

  const frag = document.createDocumentFragment();
  for (let r=0;r<ROWS;r++){
    for (let c=0;c<COLS;c++){
      const d = document.createElement("div");
      d.className = "cell";
      d.dataset.r = String(r);
      d.dataset.c = String(c);

      // Desktop right click: flag (doesn't change mode)
      d.addEventListener("contextmenu", (e)=>{
        e.preventDefault();
        if (gameOver) return;
        toggleFlag(r,c);
        renderCell(d, r, c);
        updateBombHud();
      });

      // Pointer up: unified input (mouse/touch)
      d.addEventListener("pointerup", onPointerUp);

      frag.appendChild(d);
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
  let i=0;
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

function reveal(r,c){
  const cell = board[r][c];
  if (cell.revealed || cell.flagged) return;

  if (!minesPlaced){
    minesPlaced = true;
    placeMinesSafe(r,c);
    calcValues();
  }

  if (cell.mine){
    cell.revealed = true;
    lose();
    return;
  }

  if (cell.value === 0){
    floodReveal(r,c);
  } else {
    cell.revealed = true;
    revealedCount++;
  }

  winCheck();
}

function flaggedNeighbors(r,c){
  let f=0;
  forEachNeighbor(r,c,(nr,nc)=>{ if (board[nr][nc].flagged) f++; });
  return f;
}

function hiddenUnflaggedNeighbors(r,c){
  const out=[];
  forEachNeighbor(r,c,(nr,nc)=>{
    const n = board[nr][nc];
    if (!n.revealed && !n.flagged) out.push([nr,nc]);
  });
  return out;
}

// Reveal mode double: chord reveal
function chordReveal(r,c){
  const cell = board[r][c];
  if (!cell.revealed || cell.value <= 0) return;

  const f = flaggedNeighbors(r,c);
  if (f !== cell.value) return;

  const targets = hiddenUnflaggedNeighbors(r,c);
  for (const [nr,nc] of targets){
    const n = board[nr][nc];
    if (n.mine){
      n.revealed = true;
      lose();
      return;
    }
    if (n.value === 0) floodReveal(nr,nc);
    else if (!n.revealed){
      n.revealed = true;
      revealedCount++;
    }
    if (gameOver) return;
  }
  winCheck();
}

// Flag mode double: chord flag when forced
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

// ===== Input: single vs double (stable on mobile) =====
function onPointerUp(e){
  if (gameOver) return;

  const el = e.currentTarget;
  const r = parseInt(el.dataset.r, 10);
  const c = parseInt(el.dataset.c, 10);
  const now = Date.now();

  // if same cell tapped twice quickly -> DOUBLE
  if (pendingTap && pendingTap.r === r && pendingTap.c === c && (now - pendingTap.t) <= DOUBLE_MS){
    clearTimeout(pendingTimer);
    pendingTimer = null;
    pendingTap = null;

    // DOUBLE action (only on revealed numbers)
    if (mode === "reveal") chordReveal(r,c);
    else chordFlag(r,c);

    renderAll();
    return;
  }

  // otherwise schedule SINGLE after window (so it doesn't also fire on double)
  pendingTap = { r, c, t: now };
  clearTimeout(pendingTimer);
  pendingTimer = setTimeout(()=>{
    const { r:sr, c:sc } = pendingTap;
    pendingTap = null;
    pendingTimer = null;

    if (mode === "flag") toggleFlag(sr,sc);
    else reveal(sr,sc);

    renderAll();
  }, DOUBLE_MS);
}

// ===== UI =====
toggleBtn.addEventListener("click", ()=>{
  mode = (mode === "reveal") ? "flag" : "reveal";
  toggleBtn.textContent = (mode === "reveal") ? "Switch to Flag Mode" : "Switch to Reveal Mode";
});

restartBtn.addEventListener("click", ()=>{
  createBoard();
  buildGrid();
  renderAll();
});

// Init
createBoard();
buildGrid();
toggleBtn.textContent = "Switch to Flag Mode";
renderAll();
