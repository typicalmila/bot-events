import json
import requests
from bs4 import BeautifulSoup
from datetime import datetime
from typing import Optional
from parser.base import EventData

YANDEX_URL = "https://afisha.yandex.ru/moscow"
HEADERS = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"}


class YandexAfishaParser:
    def fetch(self) -> list[EventData]:
        try:
            resp = requests.get(YANDEX_URL, headers=HEADERS, timeout=10)
            resp.raise_for_status()
            return self._parse_html(resp.text)
        except Exception:
            return []

    def _parse_html(self, html: str) -> list[EventData]:
        soup = BeautifulSoup(html, "lxml")
        events = []
        for script in soup.find_all("script", type="application/ld+json"):
            event = self._parse_jsonld(script.string)
            if event:
                events.append(event)
        # Fallback: card selectors (for future live-site changes)
        if not events:
            for card in soup.select("article, [class*='event-card'], [class*='EventCard']")[:30]:
                event = self._parse_card(card)
                if event:
                    events.append(event)
        return events

    def _parse_jsonld(self, text: str) -> Optional[EventData]:
        if not text:
            return None
        try:
            data = json.loads(text)
            if data.get("@type") != "Event":
                return None
            url = data.get("url", "")
            return EventData(
                title=data["name"],
                url=url,
                event_date=datetime.fromisoformat(data["startDate"]),
                category="culture",
                format="offline",
                price_type="paid",
                source="yandex_afisha",
                source_event_id=url.rstrip("/").split("/")[-1],
                description=data.get("description", ""),
                cover_image_url=data.get("image"),
            )
        except Exception:
            return None

    def _parse_card(self, card) -> Optional[EventData]:
        try:
            title_tag = card.find(["h2", "h3"])
            link_tag = card.find("a", href=True)
            if not title_tag or not link_tag:
                return None
            url = link_tag["href"]
            if not url.startswith("http"):
                url = "https://afisha.yandex.ru" + url
            return EventData(
                title=title_tag.get_text(strip=True),
                url=url,
                event_date=datetime.now(),
                category="culture",
                format="offline",
                price_type="paid",
                source="yandex_afisha",
                source_event_id=url.rstrip("/").split("/")[-1],
            )
        except Exception:
            return None
