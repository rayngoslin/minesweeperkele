// Adjust the multiplier to scale the field size
const MULTIPLIER = 5; // Change this value to make the field larger or smaller

// Set the number of rows, columns, and mines
const ROWS = 40; // Taller field
const COLS = 15; // Narrower field
const NUM_MINES = 150; // 15% of the total cells

let board = [];
let revealedCells = 0;
let mode = 'reveal'; // Default mode is "Reveal"
let firstClick = true; // Track if it's the first click

// Create the game board
function createBoard() {
  board = Array.from({ length: ROWS }, () =>
    Array.from({ length: COLS }, () => ({
      mine: false,
      revealed: false,
      flagged: false,
      value: 0,
    }))
  );

  // Place mines after the first click
}

// Render the board
function renderBoard() {
  const boardElement = document.getElementById('board');
  boardElement.innerHTML = '';

  board.forEach((row, r) => {
    row.forEach((cell, c) => {
      const cellElement = document.createElement('div');
      cellElement.classList.add('cell');
      if (cell.revealed) {
        cellElement.classList.add('revealed');
        cellElement.textContent = cell.mine ? '💣' : cell.value || '';
      } else if (cell.flagged) {
        cellElement.textContent = '🚩';
      }

      cellElement.addEventListener('click', () => handleCellClick(r, c));
      cellElement.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        toggleFlag(r, c);
      });

      boardElement.appendChild(cellElement);
    });
  });

  updateBombCount(); // Update the HUD after rendering the board
}

// Update the bomb count in the HUD
function updateBombCount() {
  const bombCountElement = document.getElementById('bomb-count');
  const flaggedCells = board.flat().filter((cell) => cell.flagged).length;
  bombCountElement.textContent = `Bombs: ${NUM_MINES - flaggedCells}`;
}

// Handle cell click
function handleCellClick(r, c) {
  if (board[r][c].revealed || board[r][c].flagged) return;

  if (firstClick) {
    firstClick = false;
    placeMines(r, c); // Ensure the first click is safe
    calculateValues();
  }

  if (mode === 'reveal') {
    revealCell(r, c);
  } else if (mode === 'flag') {
    toggleFlag(r, c);
  }

  renderBoard();
}

// Place mines, avoiding the first clicked cell
function placeMines(firstRow, firstCol) {
  let minesPlaced = 0;

  while (minesPlaced < NUM_MINES) {
    const r = Math.floor(Math.random() * ROWS);
    const c = Math.floor(Math.random() * COLS);

    if (!board[r][c].mine && (r !== firstRow || c !== firstCol)) {
      board[r][c].mine = true;
      minesPlaced++;
    }
  }
}

// Calculate the value of each cell
function calculateValues() {
  const directions = [
    [-1, -1], [-1, 0], [-1, 1],
    [0, -1],         [0, 1],
    [1, -1], [1, 0], [1, 1],
  ];

  board.forEach((row, r) => {
    row.forEach((cell, c) => {
      if (cell.mine) return;

      let value = 0;
      directions.forEach(([dr, dc]) => {
        const nr = r + dr;
        const nc = c + dc;

        if (nr >= 0 && nr < ROWS && nc >= 0 && nc < COLS && board[nr][nc].mine) {
          value++;
        }
      });

      cell.value = value;
    });
  });
}

// Reveal a cell
function revealCell(r, c) {
  if (board[r][c].revealed || board[r][c].flagged) return;

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
}

// Flood reveal for zero-value cells
function floodReveal(r, c) {
  const directions = [
    [-1, -1], [-1, 0], [-1, 1],
    [0, -1],         [0, 1],
    [1, -1], [1, 0], [1, 1],
  ];

  directions.forEach(([dr, dc]) => {
    const nr = r + dr;
    const nc = c + dc;

    if (nr >= 0 && nr < ROWS && nc >= 0 && nc < COLS && !board[nr][nc].revealed) {
      revealCell(nr, nc);
    }
  });
}

// Toggle a flag on a cell
function toggleFlag(r, c) {
  if (board[r][c].revealed) return;

  board[r][c].flagged = !board[r][c].flagged;
  updateBombCount(); // Update the HUD after toggling a flag
}

// Initialize the game
createBoard();
renderBoard();

// Add zooming functionality
let scale = 1; // Initial zoom level
let lastTouchEnd = 0; // For double-tap detection

const gameContainer = document.getElementById('game-container');

// Handle pinch-to-zoom
gameContainer.addEventListener('wheel', (e) => {
  e.preventDefault();
  const zoomSpeed = 0.1;
  scale += e.deltaY < 0 ? zoomSpeed : -zoomSpeed;
  scale = Math.min(Math.max(0.5, scale), 3); // Limit zoom between 0.5x and 3x
  gameContainer.style.transform = `scale(${scale})`;
});

// Handle double-tap to zoom
gameContainer.addEventListener('touchend', (e) => {
  const now = new Date().getTime();
  if (now - lastTouchEnd <= 300) {
    // Double-tap detected
    scale = scale === 1 ? 2 : 1; // Toggle between 1x and 2x zoom
    gameContainer.style.transform = `scale(${scale})`;
  }
  lastTouchEnd = now;
});

// Toggle between "Flag" and "Reveal" modes
document.getElementById('toggle-mode').addEventListener('click', () => {
  mode = mode === 'reveal' ? 'flag' : 'reveal';
  const toggleButton = document.getElementById('toggle-mode');
  toggleButton.textContent = mode === 'reveal' ? 'Switch to Flag Mode' : 'Switch to Reveal Mode';
});