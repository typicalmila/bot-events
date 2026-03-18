import responses
import pytest
from parser.timepad import TimepadParser

MOCK_RESPONSE = {
    "total": 1,
    "values": [{
        "id": 12345,
        "name": "AI Conference Moscow",
        "description_short": "Best AI conf",
        "starts_at": "2026-04-01T18:00:00+03:00",
        "url": "https://timepad.ru/event/12345/",
        "location": {"city": "Москва"},
        "ticket_types": [{"price": {"value": 0}}],
        "categories": [{"name": "Технологии"}],
        "poster_image": {"uploadcare_url": "https://cdn.timepad.ru/img.jpg"}
    }]
}

@responses.activate
def test_parse_returns_event_list():
    responses.add(
        responses.GET,
        "https://api.timepad.ru/v1/events",
        json=MOCK_RESPONSE, status=200
    )
    parser = TimepadParser()
    events = parser.fetch()
    assert len(events) == 1
    e = events[0]
    assert e.title == "AI Conference Moscow"
    assert e.source == "timepad"
    assert e.source_event_id == "12345"
    assert e.price_type == "free"
    assert e.cover_image_url == "https://cdn.timepad.ru/img.jpg"

@responses.activate
def test_skips_non_moscow_events():
    data = dict(MOCK_RESPONSE)
    data["values"] = [{**MOCK_RESPONSE["values"][0], "location": {"city": "Санкт-Петербург"}}]
    responses.add(responses.GET, "https://api.timepad.ru/v1/events", json=data)
    parser = TimepadParser()
    assert parser.fetch() == []

@responses.activate
def test_returns_empty_on_api_error():
    responses.add(responses.GET, "https://api.timepad.ru/v1/events", status=500)
    parser = TimepadParser()
    assert parser.fetch() == []
