import asyncio
import base64
import os
import re
from datetime import datetime, timezone
from typing import Optional
from parser.base import EventData

DEFAULT_CHANNELS = [
    "@tenchat_events",
    "@it_events_moscow",
    "@marketing_events_ru",
    "@ai_events_russia",
]

EVENT_KEYWORDS = [
    "конференц", "вебинар", "нетворкинг", "митап", "воркшоп",
    "workshop", "webinar", "meetup", "summit", "форум", "хакатон",
]

CATEGORY_KEYWORDS = {
    "ai": ["ai", "ии", "нейро", "ml", "llm", "gpt", "искусственный интеллект"],
    "marketing": ["маркетинг", "smm", "реклам", "growth"],
    "sales": ["продаж", "sales", "crm"],
    "analytics": ["аналитик", "data", "дата"],
}


def _detect_category(text: str) -> str:
    text_lower = text.lower()
    for cat, keywords in CATEGORY_KEYWORDS.items():
        if any(kw in text_lower for kw in keywords):
            return cat
    return "other"


def _is_event_message(text: str) -> bool:
    text_lower = text.lower()
    return any(kw in text_lower for kw in EVENT_KEYWORDS)


def _extract_url(text: str) -> Optional[str]:
    urls = re.findall(r'https?://\S+', text)
    return urls[0] if urls else None


class TelegramChannelsParser:
    def __init__(self):
        session_b64 = os.environ.get("TELETHON_SESSION", "")
        if session_b64:
            session_bytes = base64.b64decode(session_b64)
            # Write to working directory — consistent with Actions session-update step
            with open("events_session.session", "wb") as f:
                f.write(session_bytes)
        self.session = "events_session"

        self.app_id = int(os.environ.get("TELETHON_APP_ID", "0"))
        self.app_hash = os.environ.get("TELETHON_APP_HASH", "")
        channels_env = os.environ.get("TELEGRAM_CHANNELS", "")
        self.channels = [c.strip() for c in channels_env.split(",") if c.strip()] or DEFAULT_CHANNELS

    def fetch(self) -> list[EventData]:
        if not self.app_id or not self.app_hash:
            return []
        try:
            from telethon import TelegramClient
            return asyncio.run(self._fetch_async())
        except Exception:
            return []

    async def _fetch_async(self) -> list[EventData]:
        from telethon import TelegramClient
        events = []
        async with TelegramClient(self.session, self.app_id, self.app_hash) as client:
            for channel in self.channels:
                try:
                    async for message in client.iter_messages(channel, limit=50):
                        if not message.text:
                            continue
                        if not _is_event_message(message.text):
                            continue
                        event = self._message_to_event(message, channel)
                        if event:
                            events.append(event)
                except Exception:
                    continue
        return events

    def _message_to_event(self, message, channel: str) -> Optional[EventData]:
        try:
            text = message.text
            lines = text.strip().split("\n")
            title = lines[0][:200]
            description = "\n".join(lines[1:5])[:500]
            url = _extract_url(text) or f"https://t.me/{channel.lstrip('@')}/{message.id}"
            category = _detect_category(text)
            return EventData(
                title=title,
                description=description,
                url=url,
                event_date=message.date.replace(tzinfo=timezone.utc),
                category=category,
                format="online",
                price_type="free",
                source="telegram",
                source_event_id=f"{channel}_{message.id}",
            )
        except Exception:
            return None
