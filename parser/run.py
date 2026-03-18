import os
import logging
from dotenv import load_dotenv
from supabase import create_client
from parser.base import EventData
from parser.timepad import TimepadParser
from parser.afisha import AfishaParser
from parser.yandex_afisha import YandexAfishaParser
from parser.telegram_channels import TelegramChannelsParser

load_dotenv()
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger(__name__)

AUTO_APPROVE_SOURCES = {"timepad"}


def event_to_row(event: EventData) -> dict:
    return {
        "title": event.title,
        "description": event.description,
        "category": event.category,
        "format": event.format,
        "price_type": event.price_type,
        "price_amount": event.price_amount,
        "price_currency": "RUB",
        "event_date": event.event_date.isoformat(),
        "speakers": event.speakers,
        "url": event.url,
        "cover_image_url": event.cover_image_url,
        "source": event.source,
        "source_event_id": event.source_event_id,
        "is_approved": event.source in AUTO_APPROVE_SOURCES,
    }


def run():
    supabase = create_client(
        os.environ["SUPABASE_URL"],
        os.environ["SUPABASE_SERVICE_KEY"],
    )

    parsers = [
        ("Timepad", TimepadParser()),
        ("Afisha", AfishaParser()),
        ("Yandex Afisha", YandexAfishaParser()),
        ("Telegram", TelegramChannelsParser()),
    ]

    total_inserted = 0
    for name, parser in parsers:
        try:
            events = parser.fetch()
            log.info(f"{name}: fetched {len(events)} events")
            if not events:
                continue
            rows = [event_to_row(e) for e in events]
            result = supabase.table("events").upsert(
                rows,
                on_conflict="source,source_event_id",
                ignore_duplicates=True
            ).execute()
            inserted = len(result.data) if result.data else 0
            log.info(f"{name}: inserted {inserted} new events")
            total_inserted += inserted
        except Exception as e:
            log.error(f"{name}: failed — {e}")

    log.info(f"Done. Total new events: {total_inserted}")


if __name__ == "__main__":
    run()
