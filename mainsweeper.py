from flask import Flask, render_template, jsonify, request
import random

app = Flask(__name__, static_url_path='/static', static_folder='static')  # Only one initialization is needed

ROWS, COLS, NUM_MINES = 32, 25, 100

def generate_board(first_click_row=None, first_click_col=None):
    while True:
        board = [[{'mine': False, 'value': 0, 'revealed': False}
                  for _ in range(COLS)] for _ in range(ROWS)]

        # Determine excluded positions (first click + neighbors)
        excluded_positions = set()
        if first_click_row is not None and first_click_col is not None:
            for dr in [-1, 0, 1]:
                for dc in [-1, 0, 1]:
                    nr, nc = first_click_row + dr, first_click_col + dc
                    if 0 <= nr < ROWS and 0 <= nc < COLS:
                        excluded_positions.add(nr * COLS + nc)

        # Generate valid mine positions (excluding first click zone)
        all_positions = [i for i in range(ROWS * COLS) if i not in excluded_positions]
        mine_positions = random.sample(all_positions, NUM_MINES)

        for pos in mine_positions:
            r, c = divmod(pos, COLS)
            board[r][c]['mine'] = True

        # Calculate values for all cells
        for r in range(ROWS):
            for c in range(COLS):
                if board[r][c]['mine']:
                    continue
                value = 0
                for dr in [-1, 0, 1]:
                    for dc in [-1, 0, 1]:
                        nr, nc = r + dr, c + dc
                        if 0 <= nr < ROWS and 0 <= nc < COLS:
                            if board[nr][nc]['mine']:
                                value += 1
                board[r][c]['value'] = value

        # ✅ Ensure first click is on a zero-valued cell
        if first_click_row is not None and first_click_col is not None:
            if board[first_click_row][first_click_col]['value'] == 0:
                return board
        else:
            return board



@app.route('/')
def index():
    return render_template('index.html')

@app.route('/new-game')
def new_game():
    r = request.args.get('r', default=None, type=int)
    c = request.args.get('c', default=None, type=int)
    board = generate_board(r, c)
    return jsonify(board)

if __name__ == '__main__':
    app.run(debug=True)
