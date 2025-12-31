import os
import time
import random
import uuid
import aiohttp
from telegram import InlineKeyboardButton, InlineKeyboardMarkup, Update
from telegram.ext import ApplicationBuilder, CommandHandler, CallbackQueryHandler, ContextTypes

# small mobile defaults
DEFAULT_ROWS, DEFAULT_COLS, DEFAULT_MINES = 12, 16, 25

WEBAPP_BASE = os.getenv("WEBAPP_BASE_URL", "http://localhost:5000")  # set to your ngrok/public URL in production

GAMES = {}  # optional local fallback if webapp unreachable

# Minimal GameState fallback (kept short — use your full logic if needed)
class GameState:
    def __init__(self, rows=DEFAULT_ROWS, cols=DEFAULT_COLS, mines=DEFAULT_MINES):
        self.rows = rows; self.cols = cols; self.mines = mines
        self.board = None; self.revealed = [[False]*cols for _ in range(rows)]
        self.flagged = [[False]*cols for _ in range(rows)]
        self.is_first_click = True; self.start_time = None; self.ended = False; self.result = None

async def start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await update.message.reply_text("Send /newgame to start. The bot will create a web session and send a link to open the full web app.")

async def newgame_cmd(update: Update, context: ContextTypes.DEFAULT_TYPE):
    chat_id = update.effective_chat.id
    args = context.args
    rows = DEFAULT_ROWS; cols = DEFAULT_COLS; mines = DEFAULT_MINES
    if len(args) >= 3:
        try:
            rows = int(args[0]); cols = int(args[1]); mines = int(args[2])
        except:
            pass

    # Try to create a session on your web app
    create_url = f"{WEBAPP_BASE}/create-session?rows={rows}&cols={cols}&mines={mines}"
    try:
        async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=5)) as sess:
            async with sess.get(create_url) as resp:
                if resp.status == 200:
                    data = await resp.json()
                    play_url = data.get("play_url")
                    sid = data.get("session_id")
                    btn = InlineKeyboardButton("Open web app", url=play_url)
                    kb = InlineKeyboardMarkup([[btn]])
                    await update.message.reply_text(f"Session created. Open the full web game:", reply_markup=kb)
                    return
                else:
                    # fallthrough to local fallback
                    await update.message.reply_text("Web app did not respond, falling back to in-chat mode.")
    except Exception:
        # network/webapp not reachable -> fallback
        await update.message.reply_text("Could not reach web app. Make sure WEBAPP_BASE_URL is set and reachable (ngrok or deployed). Falling back to in-chat mode.")

    # Optional fallback: create local minimal game state so user still has something (server-side only)
    GAMES[chat_id] = GameState(rows=rows, cols=cols, mines=mines)
    await update.message.reply_text("Local game started (fallback). Use /newgame again when webapp is available.")

async def button(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    await query.edit_message_text("Inline controls are not enabled in this version. Open the web app link sent earlier to play the full UI.")

def main():
    token = os.getenv("BOT_TOKEN")
    if not token:
        print("Set BOT_TOKEN environment variable")
        return
    app = ApplicationBuilder().token(token).build()
    app.add_handler(CommandHandler("start", start))
    app.add_handler(CommandHandler("newgame", newgame_cmd))
    app.add_handler(CallbackQueryHandler(button))
    print("Bot started")
    app.run_polling()

if __name__ == "__main__":
    main()