// Initialize Telegram Web App
const tg = window.Telegram.WebApp;

// Set up the game
tg.expand(); // Expand the game to full screen
tg.MainButton.text = 'Restart';
tg.MainButton.onClick(() => {
  revealedCells = 0;
  createBoard();
  renderBoard();
});