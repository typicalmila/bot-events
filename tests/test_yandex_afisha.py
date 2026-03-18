from pathlib import Path
import pytest
from unittest.mock import patch
from parser.yandex_afisha import YandexAfishaParser

FIXTURE = (Path(__file__).parent / "fixtures" / "yandex_listing.html").read_text(encoding="utf-8")


def test_parse_html_returns_events():
    parser = YandexAfishaParser()
    events = parser._parse_html(FIXTURE)
    assert len(events) > 0
    e = events[0]
    assert e.title
    assert e.source == "yandex_afisha"


def test_parse_html_skips_non_event_jsonld():
    parser = YandexAfishaParser()
    events = parser._parse_html(FIXTURE)
    # Fixture has 3 JSON-LD scripts: 2 Event + 1 WebPage — only 2 should parse
    assert len(events) == 2


def test_fetch_returns_empty_on_error():
    parser = YandexAfishaParser()
    with patch("parser.yandex_afisha.requests.get") as mock_get:
        mock_get.side_effect = Exception("error")
        assert parser.fetch() == []
