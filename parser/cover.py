import requests
from bs4 import BeautifulSoup
from typing import Optional

TIMEOUT = 5
HEADERS = {"User-Agent": "Mozilla/5.0 (compatible; EventsBot/1.0)"}


def fetch_cover_image(url: str) -> Optional[str]:
    """Fetch og:image from event URL. Returns None on any error."""
    try:
        resp = requests.get(url, timeout=TIMEOUT, headers=HEADERS)
        resp.raise_for_status()
        soup = BeautifulSoup(resp.text, "lxml")
        tag = soup.find("meta", property="og:image")
        if tag and tag.get("content"):
            return tag["content"]
        return None
    except Exception:
        return None
