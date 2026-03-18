import os
import logging
import requests
from datetime import datetime
from typing import Optional
from parser.base import EventData

log = logging.getLogger(__name__)

TIMEPAD_API = "https://api.timepad.ru/v1/events"
HEADERS = {"User-Agent": "Mozilla/5.0 (compatible; EventsBot/1.0)"}

CATEGORY_MAP = {
    "Технологии": "ai",
    "IT": "ai",
    "Маркетинг": "marketing",
    "Продажи": "sales",
    "Аналитика": "analytics",
    "Культура": "culture",
    "Искусство": "culture",
    "Театр": "culture",
}


class TimepadParser:
    def fetch(self, days_ahead: int = 90) -> list[EventData]:
        token = os.environ.get("TIMEPAD_TOKEN")
        headers = {**HEADERS}
        if token:
            headers["Authorization"] = f"Bearer {token}"

        params = {
            "fields": "id,name,description_short,starts_at,url,location,ticket_types,categories,poster_image",
            "cities": "Москва",
            "limit": 100,
            "skip": 0,
        }
        try:
            resp = requests.get(TIMEPAD_API, params=params, headers=headers, timeout=10)
            resp.raise_for_status()
            data = resp.json()
        except Exception as e:
            log.warning(f"Timepad fetch failed: {e}")
            return []

        events = []
        for item in data.get("values", []):
            if item.get("location", {}).get("city") != "Москва":
                continue
            event = self._parse_item(item)
            if event:
                events.append(event)
        return events

    def _parse_item(self, item: dict) -> Optional[EventData]:
        try:
            tickets = item.get("ticket_types", [])
            prices = [t["price"]["value"] for t in tickets if "price" in t]
            min_price = min(prices) if prices else 0
            price_type = "free" if min_price == 0 else "paid"

            cats = item.get("categories", [])
            cat_name = cats[0]["name"] if cats else ""
            category = CATEGORY_MAP.get(cat_name, "other")

            cover = None
            poster = item.get("poster_image", {})
            if poster and poster.get("uploadcare_url"):
                cover = poster["uploadcare_url"]

            return EventData(
                title=item["name"],
                description=item.get("description_short", ""),
                url=item["url"],
                event_date=datetime.fromisoformat(item["starts_at"]),
                category=category,
                format="offline",
                price_type=price_type,
                price_amount=min_price if price_type == "paid" else None,
                source="timepad",
                source_event_id=str(item["id"]),
                cover_image_url=cover,
            )
        except (KeyError, ValueError):
            return None
