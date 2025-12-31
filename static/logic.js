// ======= Global Variables =======
let gameOver = false;
let globalBoard = [];
let totalMines = 100;
let currentFlags = 0;

const gameState = {
  isFirstClick: true,
  timerInterval: null,
  startTime: null
};



// ======= Start a New Game =======
async function startGame(presetBoard = null, resetFirstClick = true) {
  if (resetFirstClick) {
    updateTitle()
    updateBestTimesTable(); // Add this after the game starts to show best times

    gameState.isFirstClick = true;
    stopTimer();
    const timerEl = document.getElementById('timer');
    if (timerEl) timerEl.textContent = 'Time: 0s';
  }
  document.addEventListener("DOMContentLoaded", () => {
    const nicknameInput = document.getElementById("nickname-input");
  
    nicknameInput.addEventListener("keypress", function (e) {
      if (e.key === "Enter") {
        const nickname = nicknameInput.value.trim().toUpperCase();
  
        if (nickname.length === 3) {
          nicknameInput.style.display = "none";
          startGame();
        } else {
          alert("Please enter a 3-letter nickname.");
        }
      }
    });
  });
  
// ======= Board Generation (JS replacement for Flask /new-game) =======
const ROWS = 32;
const COLS = 25;
const NUM_MINES = 100;

function createEmptyBoard() {
  return Array.from({ length: ROWS }, () =>
    Array.from({ length: COLS }, () => ({ mine: false, value: 0, revealed: false }))
  );
}

function inBounds(r, c) {
  return r >= 0 && r < ROWS && c >= 0 && c < COLS;
}

function computeValues(board) {
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (board[r][c].mine) continue;
      let value = 0;
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (dr === 0 && dc === 0) continue;
          const nr = r + dr, nc = c + dc;
          if (inBounds(nr, nc) && board[nr][nc].mine) value++;
        }
      }
      board[r][c].value = value;
    }
  }
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

function generateBoard(firstClickRow = null, firstClickCol = null) {
  while (true) {
    const board = createEmptyBoard();

    const excluded = new Set();
    if (firstClickRow !== null && firstClickCol !== null) {
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          const nr = firstClickRow + dr, nc = firstClickCol + dc;
          if (inBounds(nr, nc)) excluded.add(nr * COLS + nc);
        }
      }
    }

    const minePositions = sampleUniquePositions(ROWS * COLS, NUM_MINES, excluded);
    for (const pos of minePositions) {
      const r = Math.floor(pos / COLS);
      const c = pos % COLS;
      board[r][c].mine = true;
    }

    computeValues(board);

    if (firstClickRow !== null && firstClickCol !== null) {
      if (board[firstClickRow][firstClickCol].value === 0) return board;
    } else {
      return board;
    }
  }
}
  document.getElementById('start-btn').style.display = 'none';
  document.getElementById('top-times').style.display = 'none';
  document.getElementById('animated-title').style.display = 'none';
  document.getElementById('mine-count').style.display = 'block';
  document.querySelector('.board-container').classList.add('game-active');
  document.getElementById('board').style.display = 'table';

  let board;
  if (presetBoard) {
    board = presetBoard;
  } else {
    // replaced fetch to use frontend generator
    board = generateBoard(); // no first click yet
  }

  globalBoard = board;
  gameOver = false;
  currentFlags = 0;

  totalMines = 0;
  board.forEach(row => row.forEach(cell => {
    if (cell.mine) totalMines++;
  }));

  const table = document.getElementById('board');
  table.innerHTML = '';

  board.forEach((row, r) => {
    const tr = document.createElement('tr');
    row.forEach((cell, c) => {
      const td = document.createElement('td');
      td.setAttribute('data-row', r);
      td.setAttribute('data-col', c);

      const wrapper = document.createElement('div');
      wrapper.classList.add('cell-wrapper');
      wrapper.innerHTML = `
        <div class="corner tiny-top-left"></div>
        <div class="corner tiny-top-right"></div>
        <div class="corner tiny-bottom-left"></div>
        <div class="corner tiny-bottom-right"></div>
      `;
      td.appendChild(wrapper);

      // ==== Left Click ====
      td.onclick = async () => {
        if (gameOver || td.classList.contains('revealed') || td.classList.contains('flagged')) return;

        const currentCell = globalBoard[r][c];

        if (gameState.isFirstClick) {
          gameState.isFirstClick = false;
          startTimer();

          // replaced server fetch with local generator
          const newBoard = generateBoard(r, c);
          startGame(newBoard, false);
          setTimeout(() => {
            floodReveal(r, c);
            applyCornerClasses();
          }, 50);
          return;
        }

        if (currentCell.mine) {
          const img = document.createElement('img');
          // left-click mine image
          img.src = './static/bmb1.jpg';
          img.alt = '💣';
          td.innerHTML = '';
          td.appendChild(img);
          td.classList.add('revealed');
          td.classList.add('liquified-cell-text');
          animatePop(td);
          alert('Game Over! You clicked a mine!');
          revealAllMines(globalBoard);
          gameOver = true;
          stopTimer();
          setTimeout(resetToStart, 2000);
          return;
        }

        if (currentCell.value === 0) {
          floodReveal(r, c);
        } else {
          td.innerText = currentCell.value;
          td.classList.add('revealed');
          td.classList.add('liquified-cell-text');
          animatePop(td);
          applyCornerClasses(td);
        }

        applyCornerClasses();
        checkWin();
      };

      // ==== Right Click ====
      td.oncontextmenu = (e) => {
        e.preventDefault();
        if (gameOver) return;

        if (td.classList.contains('revealed')) {
          const cellValue = parseInt(td.innerText);
          if (!isNaN(cellValue)) {
            let flagged = 0;
            const unrevealed = [];
            const unflagged = [];

            for (let dr = -1; dr <= 1; dr++) {
              for (let dc = -1; dc <= 1; dc++) {
                if (dr === 0 && dc === 0) continue;
                const nr = r + dr, nc = c + dc;
                if (nr >= 0 && nr < globalBoard.length && nc >= 0 && nc < globalBoard[0].length) {
                  const neighbor = document.querySelector(`td[data-row="${nr}"][data-col="${nc}"]`);
                  if (neighbor.classList.contains('flagged')) flagged++;
                  else if (!neighbor.classList.contains('revealed')) {
                    unrevealed.push({ row: nr, col: nc, element: neighbor });
                    unflagged.push(neighbor);
                  }
                }
              }
            }

            if (unflagged.length === cellValue - flagged) {
              unflagged.forEach(cell => {
                if (!cell.classList.contains('flagged')) {
                  cell.classList.add('flagged');
                  // flags
                  cell.innerHTML = '<img src="./static/flag1.jpg" alt="Flag" style="height: 100%; width: 100%;">';
                  currentFlags++;
                  animatePop(cell);
                }
              });
              updateTitle();
            }

            if (flagged === cellValue) {
              unrevealed.forEach(({ row, col, element }) => {
                const currentCell = globalBoard[row][col];
                if (currentCell.mine) {
                  element.innerHTML = '<img src="./static/bmb1.jpg" alt="💣">';
                  element.classList.add('revealed');
                  element.classList.add('liquified-cell-text');
                  animatePop(element);
                  alert('Game Over! You revealed a mine!');
                  revealAllMines(globalBoard);
                  gameOver = true;
                  stopTimer();
                  setTimeout(resetToStart, 2000);
                } else if (currentCell.value === 0) {
                  floodReveal(row, col);
                } else {
                  element.innerText = currentCell.value;
                  element.classList.add('revealed');
                  element.classList.add('liquified-cell-text');
                  animatePop(element);
                }
              });
            }

            applyCornerClasses();
            checkWin();
          }

          return;
        }

        if (td.classList.contains('flagged')) {
          td.classList.remove('flagged');
          td.innerText = '';
          currentFlags--;
        } else if (!td.classList.contains('revealed')) {
          td.classList.add('flagged');
          // flags
          td.innerHTML = '<img src="./static/flag1.jpg" alt="Flag" style="height: 100%; width: 100%;">';
          currentFlags++;
        }

        animatePop(td);
        updateTitle();
        applyCornerClasses();
        checkWin();
      };

      tr.appendChild(td);
    });
    table.appendChild(tr);
  });
}

// ======= Timer Functions =======
function startTimer() {
  gameState.startTime = Date.now();
  const timerEl = document.getElementById('timer');
  gameState.timerInterval = setInterval(() => {
    const seconds = Math.floor((Date.now() - gameState.startTime) / 1000);
    timerEl.textContent = `Time: ${seconds}s`;
  }, 1000);
}

function stopTimer() {
  clearInterval(gameState.timerInterval);
  gameState.timerInterval = null;
}

// ======= Reveal All Mines When Game Ends =======
function revealAllMines(board) {
  const table = document.getElementById('board');
  board.forEach((row, r) => {
    row.forEach((cell, c) => {
      const td = table.rows[r].cells[c];
      if (cell.mine) {
        const img = document.createElement('img');
        // revealAllMines()
        img.src = './static/Bmb1.jpg';
        img.alt = 'Bomb';
        td.innerHTML = '';
        td.appendChild(img);
        td.classList.add('revealed');
        td.classList.add('liquified-cell-text');
      }
    });
  });
}

// ======= Animate Cell Pop =======
function animatePop(td) {
  td.classList.add('cell-pop');
  td.addEventListener('animationend', () => {
    td.classList.remove('cell-pop');
  }, { once: true });
}

// ======= Flood Reveal for Empty Cells =======
function floodReveal(r, c) {
  const queue = [{ r, c }];
  const rows = document.getElementById('board').rows;

  while (queue.length) {
    const { r, c } = queue.shift();
    const td = rows[r].cells[c];
    const cellData = globalBoard[r][c];

    if (td.classList.contains('revealed') || td.classList.contains('flagged')) continue;

    td.classList.add('revealed');
    td.classList.add('liquified-cell-text');
    td.innerText = cellData.value === 0 ? '' : cellData.value;
    animatePop(td);

    if (cellData.value === 0) {
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          const nr = r + dr, nc = c + dc;
          if (nr >= 0 && nr < rows.length && nc >= 0 && nc < rows[0].cells.length) {
            queue.push({ r: nr, c: nc });
          }
        }
      }
    }
  }
}


// ======= Win Check =======
// ======= Win Check =======
function checkWin() {
  const rows = document.getElementById('board').rows;
  let allRevealed = true;

  for (let r = 0; r < globalBoard.length; r++) {
    for (let c = 0; c < globalBoard[r].length; c++) {
      const cell = globalBoard[r][c];
      const td = rows[r].cells[c];
      if (!cell.mine && !td.classList.contains('revealed')) {
        allRevealed = false;
        break;
      }
    }
  }

  if (allRevealed) {
    gameOver = true;
    stopTimer();
    alert('Congratulations! You win!');
    revealAllMines(globalBoard);

    // Save the best time if it's a new best time
    const finalTime = Math.floor((Date.now() - gameState.startTime) / 1000); // Time in seconds
    const nickname = document.getElementById("nickname-input").value.trim().toUpperCase();

    if (nickname.length === 3) {
      saveBestTime(nickname, finalTime);
    }

    setTimeout(resetToStart, 2000);
  }
}

// ======= Update Best Times Table =======
function updateBestTimesTable() {
  const bestTimesTable = document.getElementById('top-times');
  const bestTimes = JSON.parse(localStorage.getItem('bestTimes')) || [];

  // Clear the current table
  bestTimesTable.innerHTML = '';

  // Add header row
  const headerRow = document.createElement('tr');
  headerRow.innerHTML = `
    <th>Nickname</th>
    <th>Time (s)</th>
  `;
  bestTimesTable.appendChild(headerRow);

  // Add best times rows
  bestTimes.forEach(entry => {
    const row = document.createElement('tr');
    row.innerHTML = `
      <td>${entry.nickname}</td>
      <td>${entry.time}s</td>
    `;
    bestTimesTable.appendChild(row);
  });
}


// ======= Reset to Start Screen =======
function resetToStart() {
  document.getElementById('board').style.display = 'none';
  document.getElementById('mine-count').style.display = 'none';
  document.getElementById('start-btn').style.display = 'block';
  document.getElementById('nickname-input').style.display = 'none'; // <-- Hide nickname input
  document.getElementById('top-times').style.display = 'table';
  document.getElementById('animated-title').style.display = 'block';

  document.querySelector('.board-container').classList.remove('game-active');

  // Optional: clear nickname input
  const nicknameInput = document.getElementById('nickname-input');
  if (nicknameInput) nicknameInput.value = '';
}

function updateMineCount(count) {
  document.getElementById('mine-count').innerHTML = `<img src="bmb1.png" alt="bomb" style="height: 20px; vertical-align: middle;"> ${count}`;
}
// ======= Update Mines Remaining in Title =======
function updateTitle() {
  const title = document.getElementById('mine-count');
  title.innerHTML = `
    <img src="./static/Bmb1.jpg" alt="💣" 
    style="width: 48px; height: 48px; 
    vertical-align: middle; margin-right: 10px;">
    ${totalMines - currentFlags}`;
}
const totalFrames = 12;
let currentFrame = 1;

function animateTitle() {
  const titleImg = document.getElementById('animated-title');
  currentFrame = (currentFrame % totalFrames) + 1;
  // animated logo frames
  titleImg.src = `./static/logo/frame${currentFrame}.jpg`;
  
}

// Start animation at 10 frames per second (100ms per frame)
setInterval(animateTitle, 500);
const startBtn = document.getElementById('start-btn');
const nicknameInput = document.getElementById('nickname-input');

// When the Start button is clicked
startBtn.addEventListener('click', () => {
  startBtn.style.display = 'none';
  nicknameInput.style.display = 'block';
  nicknameInput.focus();
});

nicknameInput.addEventListener('input', () => {
  const name = nicknameInput.value.trim().toUpperCase();

  // Optional: enforce only letters (up to 3 characters)
  if (!/^[A-Z]{0,3}$/.test(name)) {
    nicknameInput.value = name.slice(0, -1);
    return;
  }

  // Automatically submit when nickname is 3 characters long
  if (name.length === 3) {
    if (event.key === 'Enter') {
    nicknameInput.style.display = 'none';

    // Show nickname in top-right corner
    const nicknameDisplay = document.getElementById('nickname-fixed');
    nicknameDisplay.textContent = name;
    nicknameDisplay.style.display = 'block';
 
    startGame(); // Start the game!
  }
}});

// Handle "Enter" key press event
nicknameInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    const name = nicknameInput.value.trim().toUpperCase();
    
    if (name.length === 3) {
      nicknameInput.style.display = 'none';

      // Show nickname in top-right corner
      const nicknameDisplay = document.getElementById('nickname-fixed');
      nicknameDisplay.textContent = name;
      nicknameDisplay.style.display = 'block';

      startGame(); // Start the game!
    } else {
      alert('Please enter a 3-letter nickname.');
    }
  }
});


nicknameInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') {
    const name = nicknameInput.value.trim();
    if (name.length === 3) {
      nicknameInput.style.display = 'none';
      console.log("Nickname:", name);
      startGame(); // Start game here
    } else {
      alert("Please enter a 3-letter nickname.");
    }
  }
});
window.onload = () => {
  const nicknameInput = document.getElementById('nickname-input');
  if (nicknameInput) {
    nicknameInput.value = '';
  }
  updateBestTimesTable();

};
function saveBestTime(nickname, time) {
  const bestTimes = JSON.parse(localStorage.getItem('bestTimes')) || [];

  const existing = bestTimes.find(entry => entry.nickname === nickname);
  if (existing) {
    if (time < existing.time) {
      existing.time = time;
    }
  } else {
    bestTimes.push({ nickname, time });
  }

  bestTimes.sort((a, b) => a.time - b.time);
  bestTimes.splice(10); // Optional: limit to top 10 scores
  localStorage.setItem('bestTimes', JSON.stringify(bestTimes));

  updateBestTimesTable();
}

function updateBestTimesTable() {
  const table = document.getElementById('top-times');
  const bestTimes = JSON.parse(localStorage.getItem('bestTimes')) || [];

  // Clear existing rows
  table.innerHTML = '';

  // Header
  const header = document.createElement('tr');
  header.innerHTML = `<th>Place</th><th>Name</th><th>Time</th>`;
  table.appendChild(header);

  bestTimes.forEach((entry, index) => {
    const row = document.createElement('tr');
    row.innerHTML = `
      <td>${getPlaceText(index + 1)}</td>
      <td>${entry.nickname}</td>
      <td>${formatTime(entry.time)}</td>
    `;
    table.appendChild(row);
  });
}

// Helper function to format place as 1st, 2nd, 3rd, etc.
function getPlaceText(n) {
  if (n === 1) return '1';
  if (n === 2) return '2';
  if (n === 3) return '3';
  if (n === 4) return '4';
  if (n === 5) return '5';
  if (n === 6) return '6';
  if (n === 7) return '7';
  if (n === 8) return '8';
  const suffix = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (suffix[(v - 20) % 10] || suffix[v] || suffix[0]);
}
function formatTime(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}
function triggerCRTEffect(duration = 300) {
  const crt = document.getElementById('crt-screen');
  if (!crt) return;

  // Show the CRT overlay
  crt.style.display = 'block';

  // Hide it after the specified duration
  setTimeout(() => {
    crt.style.display = 'none';
  }, duration);
}
