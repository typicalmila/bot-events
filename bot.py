import os
from dotenv import load_dotenv
from telegram import Update, InlineKeyboardMarkup, InlineKeyboardButton, WebAppInfo
from telegram.ext import Application, CommandHandler, ContextTypes

load_dotenv()

MINIAPP_URL = os.environ["MINIAPP_URL"]
BOT_TOKEN = os.environ["TELEGRAM_BOT_TOKEN"]


async def start(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    keyboard = InlineKeyboardMarkup([[
        InlineKeyboardButton(
            "🗓 Открыть события",
            web_app=WebAppInfo(url=MINIAPP_URL)
        )
    ]])
    await update.message.reply_text(
        "Привет! Здесь все актуальные профессиональные мероприятия Москвы.",
        reply_markup=keyboard
    )


def main() -> None:
    app = Application.builder().token(BOT_TOKEN).build()
    app.add_handler(CommandHandler("start", start))
    app.run_polling()


if __name__ == "__main__":
    main()
