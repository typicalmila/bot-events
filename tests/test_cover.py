import responses
import pytest
from parser.cover import fetch_cover_image

@responses.activate
def test_returns_og_image_url():
    responses.add(
        responses.GET, "https://example.com/event",
        body='<html><head><meta property="og:image" content="https://cdn.example.com/img.jpg"/></head></html>',
        status=200
    )
    result = fetch_cover_image("https://example.com/event")
    assert result == "https://cdn.example.com/img.jpg"

@responses.activate
def test_returns_none_on_missing_og_image():
    responses.add(
        responses.GET, "https://example.com/no-image",
        body="<html><head></head></html>",
        status=200
    )
    result = fetch_cover_image("https://example.com/no-image")
    assert result is None

@responses.activate
def test_returns_none_on_http_error():
    responses.add(responses.GET, "https://example.com/broken", status=403)
    result = fetch_cover_image("https://example.com/broken")
    assert result is None
