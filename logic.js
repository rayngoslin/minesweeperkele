// logic.js (stable input + mode toggle preserved)

const ROWS = 25;
const COLS = 50;
const NUM_MINES = Math.floor(ROWS * COLS * 0.15);

let board = [];
let revealedCells = 0;
let mode = "reveal";       // keep your toggle
let firstRevealDone = false; // mines placed on FIRST REVEAL action only
let gameOver = false;

// UI
const boardElement = document.getElementById("board");
const bombCountElement = document.getElementById("bomb-count");
const restartBtn = document.getElementById("restart-btn");
const toggleModeBtn = document.getElementById("toggle-mode");

// double tap handling (deterministic)
const DOUBLE_MS = 240;
let pendingSingleTimer = null;
let pendingTap = null; // {r,c,time}

// neighbors
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

function countFlaggedNeighbors(r,c){
  let n=0;
  forEachNeighbor(r,c,(nr,nc)=>{ if (board[nr][nc].flagged) n++; });
  return n;
}

function hiddenUnflaggedNeighbors(r,c){
  const out=[];
  forEachNeighbor(r,c,(nr,nc)=>{
    const cell=board[nr][nc];
    if (!cell.revealed && !cell.flagged) out.push([nr,nc]);
  });
  return out;
}

// ===== Board =====
function createBoard(){
  board = Array.from({length: ROWS}, () =>
    Array.from({length: COLS}, () => ({
      mine:false, revealed:false, flagged:false, value:0
    }))
  );
  revealedCells = 0;
  firstRevealDone = false;
  gameOver = false;
}

function placeMinesSafe(sr, sc){
  const safe = new Set();
  for (let r=sr-1;r<=sr+1;r++){
    for (let c=sc-1;c<=sc+1;c++){
      if (inBounds(r,c)) safe.add(`${r},${c}`);
    }
  }

  let placed=0;
  while (placed<NUM_MINES){
    const r=(Math.random()*ROWS)|0;
    const c=(Math.random()*COLS)|0;
    if (safe.has(`${r},${c}`)) continue;
    if (board[r][c].mine) continue;
    board[r][c].mine=true;
    placed++;
  }
}

function calculateValues(){
  for (let r=0;r<ROWS;r++){
    for (let c=0;c<COLS;c++){
      if (board[r][c].mine) continue;
      let v=0;
      forEachNeighbor(r,c,(nr,nc)=>{ if (board[nr][nc].mine) v++; });
      board[r][c].value=v;
    }
  }
}

// ===== Render =====
function updateBombCount(){
  let flagged=0;
  for (let r=0;r<ROWS;r++){
    for (let c=0;c<COLS;c++){
      if (board[r][c].flagged) flagged++;
    }
  }
  bombCountElement.textContent = `Bombs: ${NUM_MINES - flagged}`;
}

function renderBoard(){
  boardElement.innerHTML = "";
  for (let r=0;r<ROWS;r++){
    for (let c=0;c<COLS;c++){
      const cell=board[r][c];
      const el=document.createElement("div");
      el.className="cell";
      el.dataset.r=String(r);
      el.dataset.c=String(c);

      if (cell.revealed){
        el.classList.add("revealed");
        el.textContent = cell.mine ? "💣" : (cell.value || "");
      } else if (cell.flagged){
        el.textContent="🚩";
      }

      // pointerup for mobile + desktop
      el.addEventListener("pointerup", onCellPointerUp);

      // right-click flag (doesn't change mode)
      el.addEventListener("contextmenu",(e)=>{
        e.preventDefault();
        if (gameOver) return;
        toggleFlag(r,c);
        renderBoard();
      });

      boardElement.appendChild(el);
    }
  }
  updateBombCount();
}

// ===== Game end =====
function revealAllMines(){
  for (let r=0;r<ROWS;r++){
    for (let c=0;c<COLS;c++){
      if (board[r][c].mine) board[r][c].revealed=true;
    }
  }
}

function loseGame(){
  gameOver=true;
  revealAllMines();
  renderBoard();
  setTimeout(()=>alert("Game Over!"),10);
}

function winCheck(){
  if (revealedCells === ROWS*COLS - NUM_MINES){
    gameOver=true;
    renderBoard();
    setTimeout(()=>alert("You Win!"),10);
  }
}

// ===== Actions =====
function toggleFlag(r,c){
  const cell=board[r][c];
  if (cell.revealed) return;
  cell.flagged = !cell.flagged;
}

function revealCell(r,c){
  const cell=board[r][c];
  if (cell.revealed || cell.flagged) return;

  // mines only placed on FIRST reveal action
  if (!firstRevealDone){
    firstRevealDone=true;
    placeMinesSafe(r,c);
    calculateValues();
  }

  cell.revealed=true;
  revealedCells++;

  if (cell.mine){
    loseGame();
    return;
  }

  if (cell.value===0){
    floodReveal(r,c);
  }

  winCheck();
}

function floodReveal(sr, sc){
  const stack=[[sr,sc]];
  while (stack.length){
    const [r,c]=stack.pop();
    if (!inBounds(r,c)) continue;
    const cell=board[r][c];
    if (cell.revealed || cell.flagged) continue;
    if (cell.mine) continue;

    cell.revealed=true;
    revealedCells++;

    if (cell.value===0){
      forEachNeighbor(r,c,(nr,nc)=>{
        const n=board[nr][nc];
        if (!n.revealed && !n.flagged) stack.push([nr,nc]);
      });
    }
  }
}

function chordReveal(r,c){
  const cell=board[r][c];
  if (!cell.revealed || cell.value<=0) return;

  const flagged = countFlaggedNeighbors(r,c);
  if (flagged !== cell.value) return;

  const targets = hiddenUnflaggedNeighbors(r,c);
  for (const [nr,nc] of targets){
    const n=board[nr][nc];
    if (n.mine){
      n.revealed=true;
      loseGame();
      return;
    }
    if (n.value===0) floodReveal(nr,nc);
    else {
      if (!n.revealed && !n.flagged){
        n.revealed=true;
        revealedCells++;
      }
    }
  }
  winCheck();
}

function chordFlag(r,c){
  const cell=board[r][c];
  if (!cell.revealed || cell.value<=0) return;

  const flagged = countFlaggedNeighbors(r,c);
  const targets = hiddenUnflaggedNeighbors(r,c);
  const need = cell.value - flagged;

  // only auto-flag when it's logically forced
  if (need > 0 && need === targets.length){
    for (const [nr,nc] of targets){
      board[nr][nc].flagged = true;
    }
  }
}

// ===== Deterministic tap handling =====
function onCellPointerUp(e){
  if (gameOver) return;

  const r = parseInt(e.currentTarget.dataset.r,10);
  const c = parseInt(e.currentTarget.dataset.c,10);
  const now = Date.now();

  // If we already have a pending single tap on same cell within window -> double
  if (pendingTap && pendingTap.r===r && pendingTap.c===c && (now - pendingTap.time) <= DOUBLE_MS){
    clearTimeout(pendingSingleTimer);
    pendingSingleTimer = null;
    pendingTap = null;

    // DOUBLE ACTION
    const cell = board[r][c];
    if (cell.revealed && cell.value>0){
      if (mode === "reveal") chordReveal(r,c);
      else chordFlag(r,c);
    }
    renderBoard();
    return;
  }

  // Otherwise schedule SINGLE action after DOUBLE window
  pendingTap = {r,c,time: now};
  clearTimeout(pendingSingleTimer);
  pendingSingleTimer = setTimeout(()=>{
    const tr = pendingTap.r, tc = pendingTap.c;
    pendingTap = null;
    pendingSingleTimer = null;

    if (mode === "flag"){
      toggleFlag(tr,tc);
    } else {
      revealCell(tr,tc);
    }
    renderBoard();
  }, DOUBLE_MS);
}

// ===== UI =====
restartBtn.addEventListener("click", ()=>{
  createBoard();
  renderBoard();
});

toggleModeBtn.addEventListener("click", ()=>{
  mode = (mode==="reveal") ? "flag" : "reveal";
  toggleModeBtn.textContent = (mode==="reveal") ? "Switch to Flag Mode" : "Switch to Reveal Mode";
});

// init
createBoard();
toggleModeBtn.textContent = "Switch to Flag Mode";
renderBoard();
