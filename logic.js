const ROWS = 10;
const COLS = 10;
const NUM_MINES = 20;

let board = [];
let revealedCells = 0;
let mode = 'reveal'; // Default mode is "Reveal"

function createBoard() {
  board = Array.from({ length: ROWS }, () =>
    Array.from({ length: COLS }, () => ({ mine: false, revealed: false, value: 0 }))
  );

  // Place mines
  let minesPlaced = 0;
  while (minesPlaced < NUM_MINES) {
    const r = Math.floor(Math.random() * ROWS);
    const c = Math.floor(Math.random() * COLS);
    if (!board[r][c].mine) {
      board[r][c].mine = true;
      minesPlaced++;
    }
  }

  // Calculate values
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (board[r][c].mine) continue;
      let value = 0;
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          const nr = r + dr;
          const nc = c + dc;
          if (nr >= 0 && nr < ROWS && nc >= 0 && nc < COLS && board[nr][nc].mine) {
            value++;
          }
        }
      }
      board[r][c].value = value;
    }
  }
}

function renderBoard() {
  const boardEl = document.getElementById('board');
  boardEl.innerHTML = '';
  boardEl.style.gridTemplateColumns = `repeat(${COLS}, 30px)`;

  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const cell = document.createElement('div');
      cell.classList.add('cell');
      cell.dataset.row = r;
      cell.dataset.col = c;

      if (board[r][c].revealed) {
        cell.classList.add('revealed');
        if (board[r][c].mine) {
          cell.textContent = '💣';
        } else if (board[r][c].value > 0) {
          cell.textContent = board[r][c].value;
        }
      }

      cell.addEventListener('click', () => handleCellClick(r, c));
      boardEl.appendChild(cell);
    }
  }
}

// Get the toggle button
const toggleButton = document.getElementById('toggle-mode');

// Add an event listener to toggle between "Flag" and "Reveal"
toggleButton.addEventListener('click', () => {
  if (mode === 'reveal') {
    mode = 'flag';
    toggleButton.textContent = 'Switch to Reveal Mode';
  } else {
    mode = 'reveal';
    toggleButton.textContent = 'Switch to Flag Mode';
  }
});

// Modify the cell click handler to respect the mode
function handleCellClick(r, c) {
  if (board[r][c].revealed) return;

  if (mode === 'reveal') {
    // Reveal the cell
    board[r][c].revealed = true;
    revealedCells++;

    if (board[r][c].mine) {
      alert('Game Over!');
      revealAllMines();
      return;
    }

    if (board[r][c].value === 0) {
      floodReveal(r, c);
    }

    if (revealedCells === ROWS * COLS - NUM_MINES) {
      alert('You Win!');
    }
  } else if (mode === 'flag') {
    // Toggle flag on the cell
    const cell = document.querySelector(`[data-row="${r}"][data-col="${c}"]`);
    if (cell.classList.contains('flagged')) {
      cell.classList.remove('flagged');
      cell.textContent = '';
    } else {
      cell.classList.add('flagged');
      cell.textContent = '🚩';
    }
  }

  renderBoard();
}

function floodReveal(r, c) {
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      const nr = r + dr;
      const nc = c + dc;
      if (nr >= 0 && nr < ROWS && nc >= 0 && nc < COLS && !board[nr][nc].revealed) {
        handleCellClick(nr, nc);
      }
    }
  }
}

function revealAllMines() {
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (board[r][c].mine) {
        board[r][c].revealed = true;
      }
    }
  }
  renderBoard();
}

document.getElementById('restart-btn').addEventListener('click', () => {
  revealedCells = 0;
  createBoard();
  renderBoard();
});

// Initialize the game
createBoard();
renderBoard();