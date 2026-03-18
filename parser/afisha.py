import requests
from bs4 import BeautifulSoup
from datetime import datetime
from typing import Optional
from parser.base import EventData

AFISHA_URL = "https://www.afisha.ru/msk/schedule_other/"
HEADERS = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"}


class AfishaParser:
    def fetch(self) -> list[EventData]:
        try:
            resp = requests.get(AFISHA_URL, headers=HEADERS, timeout=10)
            resp.raise_for_status()
            return self._parse_html(resp.text)
        except Exception:
            return []

    def _parse_html(self, html: str) -> list[EventData]:
        soup = BeautifulSoup(html, "lxml")
        events = []
        for card in soup.select("article")[:50]:
            event = self._parse_card(card)
            if event:
                events.append(event)
        return events

    def _parse_card(self, card) -> Optional[EventData]:
        try:
            title_tag = card.find("h2") or card.find("h3")
            link_tag = card.find("a", href=True)
            if not title_tag or not link_tag:
                return None

            title = title_tag.get_text(strip=True)
            url = link_tag["href"]
            if not url.startswith("http"):
                url = "https://www.afisha.ru" + url

            time_tag = card.find("time")
            if not time_tag or not time_tag.get("datetime"):
                return None
            event_date = datetime.fromisoformat(time_tag["datetime"])

            img_tag = card.find("img")
            cover = img_tag["src"] if img_tag and img_tag.get("src") else None

            source_event_id = url.rstrip("/").split("/")[-1]

            return EventData(
                title=title,
                url=url,
                event_date=event_date,
                category="culture",
                format="offline",
                price_type="paid",
                source="afisha",
                source_event_id=source_event_id,
                cover_image_url=cover,
            )
        except Exception:
            return None
