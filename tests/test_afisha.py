from pathlib import Path
import pytest
from unittest.mock import patch
from parser.afisha import AfishaParser

FIXTURE = (Path(__file__).parent / "fixtures" / "afisha_listing.html").read_text(encoding="utf-8")


def test_parse_html_returns_events():
    parser = AfishaParser()
    events = parser._parse_html(FIXTURE)
    assert len(events) > 0
    e = events[0]
    assert e.title
    assert e.url.startswith("http")
    assert e.source == "afisha"
    assert e.category in ("marketing", "sales", "analytics", "ai", "culture", "other")


def test_parse_html_skips_cards_without_date():
    parser = AfishaParser()
    events = parser._parse_html(FIXTURE)
    # The fixture has 3 articles: 2 with time tags, 1 without — only 2 should parse
    assert len(events) == 2


def test_fetch_returns_empty_on_error():
    parser = AfishaParser()
    with patch("parser.afisha.requests.get") as mock_get:
        mock_get.side_effect = Exception("network error")
        assert parser.fetch() == []
