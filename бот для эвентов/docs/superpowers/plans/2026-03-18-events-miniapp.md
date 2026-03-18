# Events Mini App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Telegram Mini App that aggregates Moscow professional events from Timepad, Afisha, Yandex Afisha, and Telegram channels, with filtering, saved events, and cover images.

**Architecture:** Python bot serves Mini App link. HTML/JS frontend calls Supabase REST API directly. Python parsers run on GitHub Actions cron, writing to Supabase. Supabase Edge Function verifies Telegram initData and issues JWT.

**Tech Stack:** Python 3.11, python-telegram-bot 20.x, requests, BeautifulSoup4, Telethon, Supabase (PostgreSQL + REST API + Edge Functions), Deno (Edge Function runtime), HTML/Vanilla JS/CSS, Telegram Web App SDK, GitHub Actions.

---

## File Structure

```
бот для эвентов/
├── .env.example
├── .gitignore
├── requirements.txt
├── bot.py                            # Telegram bot — отдаёт ссылку на Mini App
├── parser/
│   ├── __init__.py
│   ├── base.py                       # BaseParser + EventData dataclass
│   ├── cover.py                      # Scrapes og:image from event URL
│   ├── timepad.py                    # Timepad REST API parser
│   ├── afisha.py                     # Afisha.ru HTML parser
│   ├── yandex_afisha.py              # Yandex Afisha HTML parser
│   ├── telegram_channels.py          # Telethon MTProto parser
│   └── run.py                        # Entry point: runs all parsers
├── supabase/
│   ├── migrations/
│   │   └── 001_initial_schema.sql    # Tables, enums, RLS policies
│   └── functions/
│       └── verify-telegram/
│           └── index.ts              # Edge Function: initData → JWT
├── miniapp/
│   ├── index.html                    # App shell + bottom tab bar
│   ├── style.css                     # Telegram dark theme styles
│   ├── api.js                        # All Supabase calls
│   ├── card.js                       # Event card HTML builder
│   ├── filters.js                    # Filter bottom sheet logic
│   ├── detail.js                     # Event detail bottom sheet
│   └── app.js                        # Main wiring: state, routing, init
├── tests/
│   ├── fixtures/
│   │   ├── afisha_listing.html       # Snapshot for offline tests
│   │   └── yandex_listing.html
│   ├── test_cover.py
│   ├── test_timepad.py
│   ├── test_afisha.py
│   └── test_yandex_afisha.py
└── .github/
    └── workflows/
        ├── parser.yml                # Cron: daily 04:00 UTC
        └── cleanup.yml               # Cron: weekly cleanup
```

---

## Task 1: Project Setup

**Files:**
- Create: `.gitignore`
- Create: `.env.example`
- Create: `requirements.txt`

- [ ] **Step 1: Create .gitignore**

```
.env
*.session
*.session-journal
__pycache__/
*.pyc
.pytest_cache/
node_modules/
.superpowers/
```

- [ ] **Step 2: Create .env.example**

```
TELEGRAM_BOT_TOKEN=your_bot_token_here
MINIAPP_URL=https://your-project.github.io/bot-events/miniapp/
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_SERVICE_KEY=your_service_role_key
SUPABASE_ANON_KEY=your_anon_key
TIMEPAD_CLIENT_ID=your_timepad_client_id
TELETHON_APP_ID=your_app_id
TELETHON_APP_HASH=your_app_hash
TELETHON_SESSION=base64_encoded_session
TELEGRAM_CHANNELS=@channel1,@channel2,@channel3
GH_PAT=your_github_personal_access_token
GITHUB_REPO=owner/repo
```

- [ ] **Step 3: Create requirements.txt**

```
python-telegram-bot==20.7
requests==2.31.0
beautifulsoup4==4.12.3
lxml==5.1.0
telethon==1.36.0
supabase==2.3.4
python-dotenv==1.0.1
pytest==8.0.2
pytest-asyncio==0.23.5
responses==0.25.0
```

- [ ] **Step 4: Commit**

```bash
git add .gitignore .env.example requirements.txt
git commit -m "chore: project setup"
```

---

## Task 2: Supabase Schema

**Files:**
- Create: `supabase/migrations/001_initial_schema.sql`

- [ ] **Step 1: Write migration SQL**

```sql
-- supabase/migrations/001_initial_schema.sql

-- Enums
CREATE TYPE event_category AS ENUM ('marketing','sales','analytics','ai','culture','other');
CREATE TYPE event_format AS ENUM ('online','offline','hybrid');
CREATE TYPE price_type AS ENUM ('free','paid');

-- Events table
CREATE TABLE events (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title            text NOT NULL,
  description      text,
  category         event_category NOT NULL,
  format           event_format NOT NULL,
  price_type       price_type NOT NULL DEFAULT 'free',
  price_amount     int CHECK (price_amount IS NULL OR price_amount >= 0),
  price_currency   text NOT NULL DEFAULT 'RUB' CHECK (price_currency = 'RUB'),
  event_date       timestamptz NOT NULL,
  speakers         text[] DEFAULT '{}',
  url              text NOT NULL,
  cover_image_url  text,
  source           text NOT NULL,
  source_event_id  text NOT NULL,
  is_approved      boolean NOT NULL DEFAULT false,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source, source_event_id)
);

-- Index for keyset pagination
CREATE INDEX events_date_id_idx ON events (event_date ASC, id ASC)
  WHERE is_approved = true;

-- Saved events
CREATE TABLE saved_events (
  user_id   bigint NOT NULL,
  event_id  uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  saved_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, event_id)
);

-- Enable RLS
ALTER TABLE events ENABLE ROW LEVEL SECURITY;
ALTER TABLE saved_events ENABLE ROW LEVEL SECURITY;

-- events: anyone can read approved future events
CREATE POLICY "events_select" ON events
  FOR SELECT USING (is_approved = true AND event_date >= now());

-- saved_events: user sees/modifies only their own rows
CREATE POLICY "saved_events_select" ON saved_events
  FOR SELECT USING (
    user_id = (current_setting('request.jwt.claims', true)::json->>'user_id')::bigint
  );
CREATE POLICY "saved_events_insert" ON saved_events
  FOR INSERT WITH CHECK (
    user_id = (current_setting('request.jwt.claims', true)::json->>'user_id')::bigint
  );
CREATE POLICY "saved_events_delete" ON saved_events
  FOR DELETE USING (
    user_id = (current_setting('request.jwt.claims', true)::json->>'user_id')::bigint
  );
```

- [ ] **Step 2: Apply migration**

Go to Supabase Dashboard → SQL Editor → paste the SQL → Run.

Verify in Table Editor: tables `events` and `saved_events` exist.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/001_initial_schema.sql
git commit -m "feat: add database schema and RLS policies"
```

---

## Task 3: Supabase Edge Function — initData Verification

**Files:**
- Create: `supabase/functions/verify-telegram/index.ts`

The Edge Function runs on Deno (Supabase runtime). It receives `initData` from the Mini App, verifies the Telegram HMAC signature, and returns a Supabase JWT with the user's Telegram ID embedded in claims.

- [ ] **Step 1: Write the Edge Function**

```typescript
// supabase/functions/verify-telegram/index.ts
// Signs a JWT directly using SUPABASE_JWT_SECRET — more reliable than magic-link flow.
// JWT secret is in: Supabase Dashboard → Settings → API → JWT Secret
import { create } from "https://deno.land/x/djwt@v3.0.1/mod.ts";

const BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
const JWT_SECRET = Deno.env.get("SUPABASE_JWT_SECRET")!;
const MAX_AGE_SECONDS = 86400; // 24 hours

async function getJwtKey(secret: string): Promise<CryptoKey> {
  return await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]
  );
}

async function verifyInitData(initData: string): Promise<Record<string, string> | null> {
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) return null;

  params.delete("hash");
  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");

  const encoder = new TextEncoder();
  const secretKey = await crypto.subtle.importKey(
    "raw", encoder.encode("WebAppData"),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const keyBytes = await crypto.subtle.sign("HMAC", secretKey, encoder.encode(BOT_TOKEN));
  const hmacKey = await crypto.subtle.importKey(
    "raw", keyBytes,
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", hmacKey, encoder.encode(dataCheckString));
  const expectedHash = Array.from(new Uint8Array(signature))
    .map(b => b.toString(16).padStart(2, "0")).join("");

  if (expectedHash !== hash) return null;

  const authDate = parseInt(params.get("auth_date") ?? "0");
  if (Date.now() / 1000 - authDate > MAX_AGE_SECONDS) return null;

  return Object.fromEntries(params.entries());
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type",
      }
    });
  }

  const { initData } = await req.json();
  const data = await verifyInitData(initData);
  if (!data) {
    return new Response(JSON.stringify({ error: "invalid initData" }), { status: 401 });
  }

  const user = JSON.parse(data.user ?? "{}");
  const userId = user.id;
  if (!userId) {
    return new Response(JSON.stringify({ error: "no user id" }), { status: 401 });
  }

  // Mint JWT directly with user_id in claims — picked up by RLS via request.jwt.claims
  const now = Math.floor(Date.now() / 1000);
  const key = await getJwtKey(JWT_SECRET);
  const token = await create(
    { alg: "HS256", typ: "JWT" },
    {
      sub: `tg_${userId}`,
      role: "authenticated",
      user_id: userId,          // used by RLS: request.jwt.claims->>'user_id'
      iat: now,
      exp: now + MAX_AGE_SECONDS,
    },
    key
  );

  return new Response(JSON.stringify({ access_token: token, user_id: userId }), {
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*"
    }
  });
});
```

- [ ] **Step 2: Deploy Edge Function**

```bash
# Install Supabase CLI if needed: brew install supabase/tap/supabase
supabase login
supabase link --project-ref YOUR_PROJECT_REF
supabase functions deploy verify-telegram --no-verify-jwt
```

Set secrets in Supabase Dashboard → Edge Functions → Secrets:
- `TELEGRAM_BOT_TOKEN` = your bot token
- `SUPABASE_JWT_SECRET` = from Supabase Dashboard → Settings → API → JWT Secret

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/verify-telegram/index.ts
git commit -m "feat: add telegram initData verification edge function"
```

---

## Task 4: Telegram Bot

**Files:**
- Create: `bot.py`

The bot has one job: when a user sends `/start`, it replies with a button that opens the Mini App.

- [ ] **Step 1: Write bot.py**

```python
# bot.py
import os
from dotenv import load_dotenv
from telegram import Update, InlineKeyboardMarkup, InlineKeyboardButton, WebAppInfo
from telegram.ext import Application, CommandHandler, ContextTypes

load_dotenv()

MINIAPP_URL = os.environ["MINIAPP_URL"]
BOT_TOKEN = os.environ["TELEGRAM_BOT_TOKEN"]


async def start(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    keyboard = InlineKeyboardMarkup([[
        InlineKeyboardButton(
            "🗓 Открыть события",
            web_app=WebAppInfo(url=MINIAPP_URL)
        )
    ]])
    await update.message.reply_text(
        "Привет! Здесь все актуальные профессиональные мероприятия Москвы.",
        reply_markup=keyboard
    )


def main() -> None:
    app = Application.builder().token(BOT_TOKEN).build()
    app.add_handler(CommandHandler("start", start))
    app.run_polling()


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Test locally**

```bash
pip install -r requirements.txt
cp .env.example .env   # fill in real values
python bot.py
```

Send `/start` to your bot in Telegram. Expect: a message with "Открыть события" button.

- [ ] **Step 3: Commit**

```bash
git add bot.py
git commit -m "feat: add telegram bot with mini app button"
```

---

## Task 5: Parser Base + Cover Scraper

**Files:**
- Create: `parser/__init__.py`
- Create: `parser/base.py`
- Create: `parser/cover.py`
- Create: `tests/test_cover.py`

- [ ] **Step 1: Write failing test for cover scraper**

```python
# tests/test_cover.py
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
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pytest tests/test_cover.py -v
```

Expected: `ImportError` or `ModuleNotFoundError`

- [ ] **Step 3: Write base.py and cover.py**

```python
# parser/__init__.py
```

```python
# parser/base.py
from dataclasses import dataclass, field
from datetime import datetime
from typing import Optional

@dataclass
class EventData:
    title: str
    url: str
    event_date: datetime
    category: str          # one of: marketing, sales, analytics, ai, culture, other
    format: str            # online, offline, hybrid
    price_type: str        # free, paid
    source: str
    source_event_id: str
    description: str = ""
    speakers: list[str] = field(default_factory=list)
    price_amount: Optional[int] = None
    cover_image_url: Optional[str] = None
```

```python
# parser/cover.py
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
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pytest tests/test_cover.py -v
```

Expected: 3 PASSED

- [ ] **Step 5: Commit**

```bash
git add parser/ tests/test_cover.py
git commit -m "feat: add parser base and og:image cover scraper"
```

---

## Task 6: Timepad Parser

**Files:**
- Create: `parser/timepad.py`
- Create: `tests/test_timepad.py`

Timepad API docs: https://dev.timepad.ru/api/events/ — free, no auth needed for public events.

- [ ] **Step 1: Write failing tests**

```python
# tests/test_timepad.py
import responses
import json
import pytest
from datetime import datetime, timezone
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
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pytest tests/test_timepad.py -v
```

Expected: ImportError

- [ ] **Step 3: Write timepad.py**

```python
# parser/timepad.py
import requests
from datetime import datetime
from typing import Optional
from parser.base import EventData

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
        params = {
            "fields": "id,name,description_short,starts_at,url,location,ticket_types,categories,poster_image",
            "cities": "Москва",
            "limit": 100,
            "skip": 0,
        }
        try:
            resp = requests.get(TIMEPAD_API, params=params, headers=HEADERS, timeout=10)
            resp.raise_for_status()
            data = resp.json()
        except Exception:
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
            if poster.get("uploadcare_url"):
                cover = poster["uploadcare_url"]

            return EventData(
                title=item["name"],
                description=item.get("description_short", ""),
                url=item["url"],
                event_date=datetime.fromisoformat(item["starts_at"]),
                category=category,
                format="offline",  # Timepad doesn't reliably expose this; default offline
                price_type=price_type,
                price_amount=min_price if price_type == "paid" else None,
                source="timepad",
                source_event_id=str(item["id"]),
                cover_image_url=cover,
            )
        except (KeyError, ValueError):
            return None
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pytest tests/test_timepad.py -v
```

Expected: 3 PASSED

- [ ] **Step 5: Commit**

```bash
git add parser/timepad.py tests/test_timepad.py
git commit -m "feat: add Timepad parser"
```

---

## Task 7: Afisha.ru Parser

**Files:**
- Create: `parser/afisha.py`
- Create: `tests/fixtures/afisha_listing.html`
- Create: `tests/test_afisha.py`

- [ ] **Step 1: Capture a real HTML fixture**

```bash
curl -s -A "Mozilla/5.0" "https://www.afisha.ru/msk/schedule_other/?type=2" \
  -o tests/fixtures/afisha_listing.html
```

Open the file, find a few event entries. Identify the CSS selectors for: title, date, URL, cover image.

Typical Afisha selectors (verify against captured HTML):
- Event card: `article[data-testid="event-card"]` or `div.b-event-item`
- Title: `h2` or `a[data-testid="event-title"]`
- Date: `time` tag or `span.date`
- URL: `a[href]` on card

Adjust selectors in the parser below to match what you see in the fixture.

- [ ] **Step 2: Write failing test**

```python
# tests/test_afisha.py
from pathlib import Path
import pytest
from unittest.mock import patch, MagicMock
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
    assert e.category in ("marketing","sales","analytics","ai","culture","other")

def test_fetch_returns_empty_on_error():
    parser = AfishaParser()
    with patch("parser.afisha.requests.get") as mock_get:
        mock_get.side_effect = Exception("network error")
        assert parser.fetch() == []
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
pytest tests/test_afisha.py -v
```

Expected: ImportError

- [ ] **Step 4: Write afisha.py**

```python
# parser/afisha.py
import requests
from bs4 import BeautifulSoup
from datetime import datetime
from typing import Optional
from parser.base import EventData
from parser.cover import fetch_cover_image

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
        # NOTE: selectors must be verified against live site / fixture
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

            # Try to find a date
            time_tag = card.find("time")
            if time_tag and time_tag.get("datetime"):
                event_date = datetime.fromisoformat(time_tag["datetime"])
            else:
                # Skip events without parseable dates
                return None

            # Cover image from og:image (fetched at insert time by run.py if needed)
            img_tag = card.find("img")
            cover = img_tag["src"] if img_tag and img_tag.get("src") else None

            source_event_id = url.rstrip("/").split("/")[-1]

            return EventData(
                title=title,
                url=url,
                event_date=event_date,
                category="culture",  # Afisha is mostly culture; admin can reclassify
                format="offline",
                price_type="paid",
                source="afisha",
                source_event_id=source_event_id,
                cover_image_url=cover,
            )
        except Exception:
            return None
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
pytest tests/test_afisha.py -v
```

Expected: 2 PASSED. If `test_parse_html_returns_events` fails due to selector mismatch, inspect the fixture and adjust selectors in `_parse_html` / `_parse_card`.

- [ ] **Step 6: Commit**

```bash
git add parser/afisha.py tests/test_afisha.py tests/fixtures/afisha_listing.html
git commit -m "feat: add Afisha.ru parser"
```

---

## Task 8: Yandex Afisha Parser

**Files:**
- Create: `parser/yandex_afisha.py`
- Create: `tests/fixtures/yandex_listing.html`
- Create: `tests/test_yandex_afisha.py`

Same pattern as Afisha. Yandex Afisha URL: `https://afisha.yandex.ru/moscow`

- [ ] **Step 1: Capture fixture**

```bash
curl -s -A "Mozilla/5.0" "https://afisha.yandex.ru/moscow" \
  -o tests/fixtures/yandex_listing.html
```

Inspect the HTML for event card selectors.

- [ ] **Step 2: Write failing test**

```python
# tests/test_yandex_afisha.py
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

def test_fetch_returns_empty_on_error():
    parser = YandexAfishaParser()
    with patch("parser.yandex_afisha.requests.get") as mock_get:
        mock_get.side_effect = Exception("error")
        assert parser.fetch() == []
```

- [ ] **Step 3: Run test to verify failure**

```bash
pytest tests/test_yandex_afisha.py -v
```

- [ ] **Step 4: Write yandex_afisha.py**

```python
# parser/yandex_afisha.py
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
        # NOTE: Yandex Afisha is heavily JS-rendered; inspect fixture and
        # adjust selectors. May need to look for JSON-LD script tags instead.
        for script in soup.find_all("script", type="application/ld+json"):
            event = self._parse_jsonld(script.string)
            if event:
                events.append(event)
        # Fallback: try card selectors
        if not events:
            for card in soup.select("article, [class*='event-card'], [class*='EventCard']")[:30]:
                event = self._parse_card(card)
                if event:
                    events.append(event)
        return events

    def _parse_jsonld(self, text: str) -> Optional[EventData]:
        if not text:
            return None
        import json
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
                event_date=datetime.now(),  # best effort
                category="culture",
                format="offline",
                price_type="paid",
                source="yandex_afisha",
                source_event_id=url.rstrip("/").split("/")[-1],
            )
        except Exception:
            return None
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
pytest tests/test_yandex_afisha.py -v
```

Expected: 2 PASSED.

- [ ] **Step 6: Commit**

```bash
git add parser/yandex_afisha.py tests/test_yandex_afisha.py tests/fixtures/yandex_listing.html
git commit -m "feat: add Yandex Afisha parser"
```

---

## Task 9: Telegram Channels Parser

**Files:**
- Create: `parser/telegram_channels.py`

This parser uses Telethon (MTProto) to read messages from public Telegram channels. It does NOT run unit tests against live Telegram — manual verification is sufficient.

- [ ] **Step 1: One-time: Authenticate and create session**

Run this interactively ONCE locally to create a `.session` file:

```python
# run once: python parser/telegram_channels.py --auth
import asyncio, os, base64
from telethon import TelegramClient
from dotenv import load_dotenv
load_dotenv()

async def auth():
    client = TelegramClient("events_session",
        int(os.environ["TELETHON_APP_ID"]),
        os.environ["TELETHON_APP_HASH"])
    await client.start()
    print("Session created: events_session.session")
    session_bytes = open("events_session.session", "rb").read()
    print("Base64 for GitHub Secret:")
    print(base64.b64encode(session_bytes).decode())

asyncio.run(auth())
```

Copy the base64 output → add as `TELETHON_SESSION` in GitHub Actions Secrets.

- [ ] **Step 2: Write telegram_channels.py**

```python
# parser/telegram_channels.py
import asyncio
import base64
import os
import re
from datetime import datetime, timezone
from typing import Optional
from telethon import TelegramClient
from telethon.sessions import StringSession
from parser.base import EventData

# Channels to monitor — expand this list over time
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

        self.app_id = int(os.environ["TELETHON_APP_ID"])
        self.app_hash = os.environ["TELETHON_APP_HASH"]
        channels_env = os.environ.get("TELEGRAM_CHANNELS", "")
        self.channels = [c.strip() for c in channels_env.split(",") if c.strip()] or DEFAULT_CHANNELS

    def fetch(self) -> list[EventData]:
        return asyncio.run(self._fetch_async())

    async def _fetch_async(self) -> list[EventData]:
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
                    continue  # skip broken channels silently
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
```

- [ ] **Step 3: Manual test**

```bash
python -c "
from parser.telegram_channels import TelegramChannelsParser
p = TelegramChannelsParser()
events = p.fetch()
print(f'Got {len(events)} events')
for e in events[:3]:
    print(e.title, e.url)
"
```

Expected: prints event titles from the channels.

- [ ] **Step 4: Commit**

```bash
git add parser/telegram_channels.py
git commit -m "feat: add Telegram channels parser via Telethon"
```

---

## Task 10: Parser Entry Point + Supabase Writer

**Files:**
- Create: `parser/run.py`

This is the script run by GitHub Actions. It calls all parsers, deduplicates, writes to Supabase.

- [ ] **Step 1: Write run.py**

```python
# parser/run.py
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
            # ON CONFLICT DO NOTHING via upsert with ignoreDuplicates
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
```

- [ ] **Step 2: Test locally**

```bash
python -m parser.run
```

Expected: logs like `Timepad: fetched 45 events`, `Timepad: inserted 45 new events`.

Check Supabase Studio → Table Editor → events: rows should appear.

- [ ] **Step 3: Commit**

```bash
git add parser/run.py
git commit -m "feat: add parser entry point with Supabase writer"
```

---

## Task 11: Mini App — HTML Shell + CSS

**Files:**
- Create: `miniapp/index.html`
- Create: `miniapp/style.css`

- [ ] **Step 1: Write index.html**

```html
<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0">
  <title>События Москвы</title>
  <script src="https://telegram.org/js/telegram-web-app.js"></script>
  <link rel="stylesheet" href="style.css">
</head>
<body>
  <!-- Header -->
  <header class="header">
    <div class="header-title">
      <h1>События Москвы</h1>
      <span id="events-count" class="events-count"></span>
    </div>
    <button class="btn-filters" id="btn-filters">⚙ Фильтры</button>
  </header>

  <!-- Category chips -->
  <div class="chips-container" id="chips-container">
    <button class="chip active" data-category="all">Все</button>
    <button class="chip" data-category="ai">🤖 ИИ</button>
    <button class="chip" data-category="marketing">📈 Маркетинг</button>
    <button class="chip" data-category="sales">💼 Продажи</button>
    <button class="chip" data-category="analytics">📊 Аналитика</button>
    <button class="chip" data-category="culture">🎭 Культура</button>
    <button class="chip" data-category="other">Другое</button>
  </div>

  <!-- Tab bar -->
  <nav class="tab-bar">
    <button class="tab active" data-tab="feed" id="tab-feed">🗓 События</button>
    <button class="tab" data-tab="saved" id="tab-saved">🔖 Сохранённые</button>
  </nav>

  <!-- Feed -->
  <main class="feed" id="feed"></main>

  <!-- Empty state -->
  <div class="empty-state" id="empty-state" hidden>
    <p id="empty-text">Пока нет событий по этим фильтрам — попробуй изменить параметры</p>
  </div>

  <!-- Loader -->
  <div class="loader" id="loader" hidden>
    <div class="spinner"></div>
  </div>

  <!-- Filters bottom sheet -->
  <div class="sheet-overlay" id="filters-overlay" hidden></div>
  <div class="bottom-sheet" id="filters-sheet" hidden>
    <div class="sheet-handle"></div>
    <div id="filters-content"></div>
  </div>

  <!-- Detail bottom sheet -->
  <div class="sheet-overlay" id="detail-overlay" hidden></div>
  <div class="bottom-sheet" id="detail-sheet" hidden>
    <div class="sheet-handle"></div>
    <div id="detail-content"></div>
  </div>

  <script type="module" src="api.js"></script>
  <script type="module" src="card.js"></script>
  <script type="module" src="filters.js"></script>
  <script type="module" src="detail.js"></script>
  <script type="module" src="app.js"></script>
</body>
</html>
```

- [ ] **Step 2: Write style.css**

```css
/* miniapp/style.css */
:root {
  --bg: var(--tg-theme-bg-color, #111827);
  --bg2: var(--tg-theme-secondary-bg-color, #1f2937);
  --text: var(--tg-theme-text-color, #ffffff);
  --hint: var(--tg-theme-hint-color, #9ca3af);
  --accent: var(--tg-theme-button-color, #6366f1);
  --accent-text: var(--tg-theme-button-text-color, #ffffff);
  --radius: 14px;
}

* { box-sizing: border-box; margin: 0; padding: 0; }

body {
  background: var(--bg);
  color: var(--text);
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  font-size: 14px;
  overflow-x: hidden;
  padding-bottom: 60px; /* tab bar height */
}

/* Header */
.header {
  position: sticky; top: 0; z-index: 10;
  background: var(--bg);
  padding: 14px 16px 10px;
  display: flex; align-items: center; justify-content: space-between;
  border-bottom: 1px solid rgba(255,255,255,0.06);
}
.header h1 { font-size: 18px; font-weight: 700; }
.events-count { font-size: 12px; color: var(--hint); margin-left: 6px; }
.btn-filters {
  background: var(--bg2); border: none; color: var(--hint);
  padding: 7px 12px; border-radius: 8px; font-size: 12px; cursor: pointer;
}

/* Chips */
.chips-container {
  display: flex; gap: 8px; padding: 10px 16px;
  overflow-x: auto; scrollbar-width: none;
}
.chips-container::-webkit-scrollbar { display: none; }
.chip {
  background: var(--bg2); border: none; color: var(--hint);
  padding: 6px 14px; border-radius: 20px; font-size: 12px;
  white-space: nowrap; cursor: pointer; transition: all 0.15s;
}
.chip.active { background: var(--accent); color: var(--accent-text); }

/* Tab bar */
.tab-bar {
  position: fixed; bottom: 0; left: 0; right: 0; z-index: 10;
  display: flex; background: var(--bg);
  border-top: 1px solid rgba(255,255,255,0.08);
  padding-bottom: env(safe-area-inset-bottom);
}
.tab {
  flex: 1; background: none; border: none; color: var(--hint);
  padding: 10px; font-size: 12px; cursor: pointer;
}
.tab.active { color: var(--accent); font-weight: 600; }

/* Feed */
.feed { padding: 4px 12px 12px; }

/* Card */
.card {
  background: var(--bg2); border-radius: var(--radius);
  overflow: hidden; margin-bottom: 12px; cursor: pointer;
}
.card-cover {
  position: relative; height: 140px; overflow: hidden;
  background: #374151;
}
.card-cover img {
  width: 100%; height: 100%; object-fit: cover; display: block;
}
.card-cover-gradient {
  position: absolute; bottom: 0; left: 0; right: 0; height: 60px;
  background: linear-gradient(to bottom, transparent, var(--bg2));
}
.card-cover-placeholder {
  width: 100%; height: 100%;
  display: flex; align-items: center; justify-content: center;
  font-size: 40px;
}
.badge {
  position: absolute; top: 10px;
  background: rgba(0,0,0,0.55); backdrop-filter: blur(4px);
  padding: 3px 9px; border-radius: 20px; font-size: 10px; font-weight: 600;
}
.badge-category { left: 10px; color: #a5b4fc; }
.badge-price-free { right: 10px; color: #86efac; }
.badge-price-paid { right: 10px; color: #fca5a5; }
.card-body { padding: 12px 14px 14px; }
.card-title { font-size: 14px; font-weight: 700; margin-bottom: 4px; }
.card-desc {
  font-size: 12px; color: var(--hint); margin-bottom: 8px;
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
  overflow: hidden;
}
.card-meta { font-size: 11px; color: var(--hint); margin-bottom: 10px; }
.card-meta .date { color: var(--text); }
.card-actions { display: flex; gap: 8px; align-items: center; justify-content: space-between; }
.btn-go {
  background: var(--accent); color: var(--accent-text);
  border: none; padding: 7px 14px; border-radius: 8px;
  font-size: 12px; font-weight: 600; cursor: pointer;
}
.btn-save {
  background: #374151; border: none; color: var(--text);
  padding: 7px 10px; border-radius: 8px; font-size: 13px; cursor: pointer;
}
.btn-save.saved { color: #f59e0b; }

/* Bottom sheet */
.sheet-overlay {
  position: fixed; inset: 0; background: rgba(0,0,0,0.5); z-index: 20;
}
.bottom-sheet {
  position: fixed; bottom: 0; left: 0; right: 0; z-index: 21;
  background: var(--bg2); border-radius: 16px 16px 0 0;
  padding: 12px 16px 32px; max-height: 85vh; overflow-y: auto;
}
.sheet-handle {
  width: 36px; height: 4px; background: #4b5563;
  border-radius: 2px; margin: 0 auto 16px;
}

/* Empty state */
.empty-state {
  padding: 60px 32px; text-align: center; color: var(--hint);
}

/* Loader */
.loader {
  padding: 40px; display: flex; justify-content: center;
}
.spinner {
  width: 28px; height: 28px; border: 3px solid var(--bg2);
  border-top-color: var(--accent); border-radius: 50%;
  animation: spin 0.8s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }

/* Filter sheet */
.filter-section { margin-bottom: 20px; }
.filter-label { font-size: 11px; color: var(--hint); text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 8px; }
.filter-chips { display: flex; flex-wrap: wrap; gap: 8px; }
.filter-chip {
  background: #374151; border: 1.5px solid transparent; color: var(--text);
  padding: 6px 14px; border-radius: 20px; font-size: 12px; cursor: pointer;
}
.filter-chip.active { border-color: var(--accent); color: var(--accent); }
.sheet-actions { display: flex; gap: 10px; margin-top: 20px; }
.btn-reset {
  flex: 1; background: #374151; border: none; color: var(--hint);
  padding: 12px; border-radius: 10px; font-size: 14px; cursor: pointer;
}
.btn-apply {
  flex: 2; background: var(--accent); border: none; color: var(--accent-text);
  padding: 12px; border-radius: 10px; font-size: 14px; font-weight: 600; cursor: pointer;
}

/* Detail sheet */
.detail-cover { width: 100%; height: 200px; object-fit: cover; border-radius: 10px; margin-bottom: 14px; }
.detail-title { font-size: 18px; font-weight: 700; margin-bottom: 8px; }
.detail-meta { font-size: 13px; color: var(--hint); margin-bottom: 12px; line-height: 1.6; }
.detail-desc { font-size: 14px; color: var(--text); line-height: 1.6; margin-bottom: 14px; }
.detail-speakers { font-size: 13px; color: var(--hint); margin-bottom: 16px; }
.btn-register {
  width: 100%; background: var(--accent); color: var(--accent-text);
  border: none; padding: 14px; border-radius: 12px;
  font-size: 15px; font-weight: 600; cursor: pointer;
}
```

- [ ] **Step 3: Commit**

```bash
git add miniapp/index.html miniapp/style.css
git commit -m "feat: add mini app HTML shell and Telegram-themed CSS"
```

---

## Task 12: Mini App — API Layer

**Files:**
- Create: `miniapp/api.js`

- [ ] **Step 1: Write api.js**

```javascript
// miniapp/api.js
const SUPABASE_URL = "YOUR_SUPABASE_URL"; // replace at deploy
const SUPABASE_ANON_KEY = "YOUR_SUPABASE_ANON_KEY"; // replace at deploy
const VERIFY_URL = `${SUPABASE_URL}/functions/v1/verify-telegram`;

let _accessToken = null;
let _userId = null;

// Verify initData and get JWT
export async function authenticate() {
  const initData = window.Telegram?.WebApp?.initData;
  if (!initData) return null; // dev fallback: proceed without auth
  const resp = await fetch(VERIFY_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ initData }),
  });
  if (!resp.ok) return null;
  const data = await resp.json();
  _accessToken = data.access_token;
  _userId = data.user_id;
  return _userId;
}

export function getUserId() { return _userId; }

function authHeaders() {
  const h = { "apikey": SUPABASE_ANON_KEY, "Content-Type": "application/json" };
  if (_accessToken) h["Authorization"] = `Bearer ${_accessToken}`;
  return h;
}

// Fetch events page (keyset pagination)
export async function fetchEvents({ categories = [], format = null, priceType = null, dateFrom = null, dateTo = null, cursor = null, limit = 20 } = {}) {
  let url = `${SUPABASE_URL}/rest/v1/events?select=*&is_approved=eq.true&order=event_date.asc,id.asc&limit=${limit}`;

  if (cursor) {
    // cursor = { event_date, id }
    url += `&or=(event_date.gt.${cursor.event_date},and(event_date.eq.${cursor.event_date},id.gt.${cursor.id}))`;
  }
  if (categories.length > 0) {
    url += `&category=in.(${categories.join(",")})`;
  }
  if (format) url += `&format=eq.${format}`;
  if (priceType) url += `&price_type=eq.${priceType}`;
  if (dateFrom) url += `&event_date=gte.${dateFrom}`;
  if (dateTo) url += `&event_date=lte.${dateTo}`;

  const resp = await fetch(url, { headers: authHeaders() });
  if (!resp.ok) return [];
  return resp.json();
}

// Fetch saved event IDs for current user
export async function fetchSavedIds() {
  if (!_userId) return new Set();
  const url = `${SUPABASE_URL}/rest/v1/saved_events?select=event_id&user_id=eq.${_userId}`;
  const resp = await fetch(url, { headers: authHeaders() });
  if (!resp.ok) return new Set();
  const rows = await resp.json();
  return new Set(rows.map(r => r.event_id));
}

// Fetch full saved events (with event data)
export async function fetchSavedEvents() {
  if (!_userId) return [];
  const url = `${SUPABASE_URL}/rest/v1/saved_events?select=event_id,events(*)&user_id=eq.${_userId}&order=saved_at.desc`;
  const resp = await fetch(url, { headers: authHeaders() });
  if (!resp.ok) return [];
  const rows = await resp.json();
  return rows.map(r => r.events).filter(Boolean);
}

// Save event
export async function saveEvent(eventId) {
  if (!_userId) return;
  await fetch(`${SUPABASE_URL}/rest/v1/saved_events`, {
    method: "POST",
    headers: { ...authHeaders(), "Prefer": "resolution=ignore-duplicates" },
    body: JSON.stringify({ user_id: _userId, event_id: eventId }),
  });
}

// Unsave event
export async function unsaveEvent(eventId) {
  if (!_userId) return;
  await fetch(`${SUPABASE_URL}/rest/v1/saved_events?user_id=eq.${_userId}&event_id=eq.${eventId}`, {
    method: "DELETE",
    headers: authHeaders(),
  });
}

// Count events matching current filters (for filter sheet)
export async function countEvents({ categories = [], format = null, priceType = null, dateFrom = null, dateTo = null } = {}) {
  let url = `${SUPABASE_URL}/rest/v1/events?select=id&is_approved=eq.true`;
  if (categories.length > 0) url += `&category=in.(${categories.join(",")})`;
  if (format) url += `&format=eq.${format}`;
  if (priceType) url += `&price_type=eq.${priceType}`;
  if (dateFrom) url += `&event_date=gte.${dateFrom}`;
  if (dateTo) url += `&event_date=lte.${dateTo}`;
  const resp = await fetch(url, {
    headers: { ...authHeaders(), "Prefer": "count=exact", "Range-Unit": "items", "Range": "0-0" }
  });
  const countHeader = resp.headers.get("Content-Range");
  return countHeader ? parseInt(countHeader.split("/")[1]) : 0;
}

export { SUPABASE_URL, SUPABASE_ANON_KEY };
```

- [ ] **Step 2: Replace placeholder values**

In `api.js`, replace:
- `YOUR_SUPABASE_URL` → your actual Supabase project URL (e.g. `https://xxxx.supabase.co`)
- `YOUR_SUPABASE_ANON_KEY` → your actual anon key from Supabase Dashboard → Settings → API

- [ ] **Step 3: Commit**

```bash
git add miniapp/api.js
git commit -m "feat: add mini app API layer"
```

---

## Task 13: Mini App — Event Card Component

**Files:**
- Create: `miniapp/card.js`

- [ ] **Step 1: Write card.js**

```javascript
// miniapp/card.js

const CATEGORY_LABELS = {
  ai: "🤖 ИИ", marketing: "📈 Маркетинг",
  sales: "💼 Продажи", analytics: "📊 Аналитика",
  culture: "🎭 Культура", other: "Другое",
};
const CATEGORY_PLACEHOLDERS = {
  ai: "🤖", marketing: "📈", sales: "💼",
  analytics: "📊", culture: "🎭", other: "📅",
};
const FORMAT_LABELS = { online: "Онлайн", offline: "Офлайн", hybrid: "Гибрид" };

export function formatDate(isoString) {
  const d = new Date(isoString);
  return d.toLocaleString("ru-RU", {
    day: "numeric", month: "long", hour: "2-digit", minute: "2-digit",
    timeZone: "Europe/Moscow"
  });
}

export function renderCard(event, isSaved) {
  const priceLabel = event.price_type === "free" ? "Бесплатно" : `${event.price_amount?.toLocaleString("ru")} ₽`;
  const priceBadgeClass = event.price_type === "free" ? "badge-price-free" : "badge-price-paid";
  const coverHtml = event.cover_image_url
    ? `<img src="${event.cover_image_url}" loading="lazy" alt="">`
    : `<div class="card-cover-placeholder">${CATEGORY_PLACEHOLDERS[event.category] ?? "📅"}</div>`;

  const speakersHtml = event.speakers?.length
    ? `<div class="card-speakers" style="font-size:11px;color:var(--hint);margin-bottom:6px">${event.speakers.slice(0, 3).join(", ")}</div>`
    : "";

  return `
    <div class="card" data-id="${event.id}">
      <div class="card-cover">
        ${coverHtml}
        <div class="card-cover-gradient"></div>
        <span class="badge badge-category">${CATEGORY_LABELS[event.category] ?? event.category}</span>
        <span class="badge ${priceBadgeClass}">${priceLabel}</span>
      </div>
      <div class="card-body">
        <div class="card-title">${escapeHtml(event.title)}</div>
        ${event.description ? `<div class="card-desc">${escapeHtml(event.description)}</div>` : ""}
        ${speakersHtml}
        <div class="card-meta">
          <span class="date">${formatDate(event.event_date)}</span>
          · ${FORMAT_LABELS[event.format] ?? event.format}
        </div>
        <div class="card-actions">
          <button class="btn-save ${isSaved ? "saved" : ""}" data-event-id="${event.id}">
            ${isSaved ? "🔖" : "🔖"}
          </button>
          <button class="btn-go" data-url="${event.url}">Перейти</button>
        </div>
      </div>
    </div>`;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
```

- [ ] **Step 2: Commit**

```bash
git add miniapp/card.js
git commit -m "feat: add event card component"
```

---

## Task 14: Mini App — Filter Bottom Sheet

**Files:**
- Create: `miniapp/filters.js`

- [ ] **Step 1: Write filters.js**

```javascript
// miniapp/filters.js
import { countEvents } from "./api.js";

const WEEK_MS = 7 * 24 * 3600 * 1000;
const MONTH_MS = 30 * 24 * 3600 * 1000;

export class FiltersSheet {
  constructor(sheetEl, overlayEl, contentEl, onApply) {
    this.sheet = sheetEl;
    this.overlay = overlayEl;
    this.content = contentEl;
    this.onApply = onApply;
    this.state = { categories: [], format: null, priceType: null, dateFrom: null, dateTo: null };
    this.overlay.addEventListener("click", () => this.close());
  }

  open(currentState) {
    this.state = { ...currentState };
    this._render();
    this.sheet.hidden = false;
    this.overlay.hidden = false;
    requestAnimationFrame(() => this.sheet.classList.add("open"));
  }

  close() {
    this.sheet.hidden = true;
    this.overlay.hidden = true;
  }

  _render() {
    this.content.innerHTML = `
      <h3 style="font-size:16px;font-weight:700;margin-bottom:16px">Фильтры</h3>

      <div class="filter-section">
        <div class="filter-label">Категория</div>
        <div class="filter-chips">
          ${["ai","marketing","sales","analytics","culture","other"].map(c => `
            <button class="filter-chip ${this.state.categories.includes(c) ? "active" : ""}"
              data-filter="category" data-value="${c}">
              ${{"ai":"🤖 ИИ","marketing":"📈 Маркетинг","sales":"💼 Продажи",
                "analytics":"📊 Аналитика","culture":"🎭 Культура","other":"Другое"}[c]}
            </button>`).join("")}
        </div>
      </div>

      <div class="filter-section">
        <div class="filter-label">Формат</div>
        <div class="filter-chips">
          ${[["online","Онлайн"],["offline","Офлайн"],["hybrid","Гибрид"]].map(([v,l]) => `
            <button class="filter-chip ${this.state.format === v ? "active" : ""}"
              data-filter="format" data-value="${v}">${l}</button>`).join("")}
        </div>
      </div>

      <div class="filter-section">
        <div class="filter-label">Цена</div>
        <div class="filter-chips">
          ${[["free","Бесплатно"],["paid","Платно"]].map(([v,l]) => `
            <button class="filter-chip ${this.state.priceType === v ? "active" : ""}"
              data-filter="price" data-value="${v}">${l}</button>`).join("")}
        </div>
      </div>

      <div class="filter-section">
        <div class="filter-label">Дата</div>
        <div class="filter-chips">
          <button class="filter-chip" data-filter="date" data-value="week">Эта неделя</button>
          <button class="filter-chip" data-filter="date" data-value="month">Этот месяц</button>
        </div>
      </div>

      <div class="sheet-actions">
        <button class="btn-reset" id="btn-reset">Сбросить</button>
        <button class="btn-apply" id="btn-apply">Показать события</button>
      </div>`;

    this.content.querySelectorAll(".filter-chip").forEach(btn => {
      btn.addEventListener("click", () => this._toggle(btn));
    });
    this.content.querySelector("#btn-reset").addEventListener("click", () => this._reset());
    this.content.querySelector("#btn-apply").addEventListener("click", () => this._apply());
    this._updateCount();
  }

  _toggle(btn) {
    const filter = btn.dataset.filter;
    const value = btn.dataset.value;
    if (filter === "category") {
      if (this.state.categories.includes(value)) {
        this.state.categories = this.state.categories.filter(c => c !== value);
      } else {
        this.state.categories = [...this.state.categories, value];
      }
    } else if (filter === "format") {
      this.state.format = this.state.format === value ? null : value;
    } else if (filter === "price") {
      this.state.priceType = this.state.priceType === value ? null : value;
    } else if (filter === "date") {
      const now = new Date();
      const ms = value === "week" ? WEEK_MS : MONTH_MS;
      this.state.dateFrom = now.toISOString();
      this.state.dateTo = new Date(now.getTime() + ms).toISOString();
    }
    this._render();
  }

  _reset() {
    this.state = { categories: [], format: null, priceType: null, dateFrom: null, dateTo: null };
    this._render();
  }

  async _apply() {
    this.onApply(this.state);
    this.close();
  }

  async _updateCount() {
    const count = await countEvents(this.state);
    const btn = this.content.querySelector("#btn-apply");
    if (btn) btn.textContent = `Показать ${count} событий`;
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add miniapp/filters.js
git commit -m "feat: add filter bottom sheet"
```

---

## Task 15: Mini App — Detail Sheet

**Files:**
- Create: `miniapp/detail.js`

- [ ] **Step 1: Write detail.js**

```javascript
// miniapp/detail.js
import { formatDate } from "./card.js";
import { saveEvent, unsaveEvent } from "./api.js";

const FORMAT_LABELS = { online: "Онлайн", offline: "Офлайн", hybrid: "Гибрид" };

export class DetailSheet {
  constructor(sheetEl, overlayEl, contentEl, savedIds) {
    this.sheet = sheetEl;
    this.overlay = overlayEl;
    this.content = contentEl;
    this.savedIds = savedIds;
    this.overlay.addEventListener("click", () => this.close());
  }

  open(event) {
    this._render(event);
    this.sheet.hidden = false;
    this.overlay.hidden = false;
  }

  close() {
    this.sheet.hidden = true;
    this.overlay.hidden = true;
  }

  _render(event) {
    const isSaved = this.savedIds.has(event.id);
    const priceText = event.price_type === "free" ? "Бесплатно" : `${event.price_amount?.toLocaleString("ru")} ₽`;
    const speakersText = event.speakers?.length ? `Спикеры: ${event.speakers.join(", ")}` : "";

    this.content.innerHTML = `
      ${event.cover_image_url
        ? `<img class="detail-cover" src="${event.cover_image_url}" alt="">`
        : ""}
      <div class="detail-title">${event.title}</div>
      <div class="detail-meta">
        📅 ${formatDate(event.event_date)}<br>
        🎯 ${FORMAT_LABELS[event.format] ?? event.format} · ${priceText}
        ${event.speakers?.length ? `<br>🎤 ${event.speakers.join(", ")}` : ""}
      </div>
      ${event.description ? `<div class="detail-desc">${event.description}</div>` : ""}
      <button class="btn-save" id="detail-save" data-event-id="${event.id}" style="margin-bottom:10px;width:100%;background:var(--bg);border:1.5px solid var(--accent);color:var(--accent);padding:10px;border-radius:10px;font-size:14px;cursor:pointer">
        ${isSaved ? "🔖 Сохранено" : "🔖 Сохранить"}
      </button>
      <a href="${event.url}" target="_blank" style="text-decoration:none">
        <button class="btn-register">Зарегистрироваться</button>
      </a>`;

    this.content.querySelector("#detail-save").addEventListener("click", async (e) => {
      const btn = e.currentTarget;
      const id = event.id;
      if (this.savedIds.has(id)) {
        await unsaveEvent(id);
        this.savedIds.delete(id);
        btn.textContent = "🔖 Сохранить";
      } else {
        await saveEvent(id);
        this.savedIds.add(id);
        btn.textContent = "🔖 Сохранено";
      }
    });
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add miniapp/detail.js
git commit -m "feat: add event detail bottom sheet"
```

---

## Task 16: Mini App — Main App Wiring

**Files:**
- Create: `miniapp/app.js`

- [ ] **Step 1: Write app.js**

```javascript
// miniapp/app.js
import { authenticate, fetchEvents, fetchSavedIds, fetchSavedEvents, saveEvent, unsaveEvent } from "./api.js";
import { renderCard } from "./card.js";
import { FiltersSheet } from "./filters.js";
import { DetailSheet } from "./detail.js";

const tg = window.Telegram?.WebApp;
tg?.ready();
tg?.expand();

const state = {
  tab: "feed",          // "feed" | "saved"
  category: "all",
  filters: { categories: [], format: null, priceType: null, dateFrom: null, dateTo: null },
  cursor: null,
  loading: false,
  hasMore: true,
  events: [],
  savedIds: new Set(),
};

const feed = document.getElementById("feed");
const loader = document.getElementById("loader");
const emptyState = document.getElementById("empty-state");
const emptyText = document.getElementById("empty-text");

// Init sheets
const filtersSheet = new FiltersSheet(
  document.getElementById("filters-sheet"),
  document.getElementById("filters-overlay"),
  document.getElementById("filters-content"),
  (newFilters) => { state.filters = newFilters; state.category = "all"; resetFeed(); }
);

let detailSheet;

async function init() {
  await authenticate();
  state.savedIds = await fetchSavedIds();
  detailSheet = new DetailSheet(
    document.getElementById("detail-sheet"),
    document.getElementById("detail-overlay"),
    document.getElementById("detail-content"),
    state.savedIds
  );
  bindEvents();
  await loadMore();
}

function bindEvents() {
  // Category chips
  document.getElementById("chips-container").addEventListener("click", (e) => {
    const chip = e.target.closest(".chip");
    if (!chip) return;
    document.querySelectorAll(".chip").forEach(c => c.classList.remove("active"));
    chip.classList.add("active");
    state.category = chip.dataset.category;
    state.filters.categories = state.category === "all" ? [] : [state.category];
    resetFeed();
  });

  // Tabs
  document.querySelectorAll(".tab").forEach(tab => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
      tab.classList.add("active");
      state.tab = tab.dataset.tab;
      resetFeed();
    });
  });

  // Filters button
  document.getElementById("btn-filters").addEventListener("click", () => {
    filtersSheet.open(state.filters);
  });

  // Infinite scroll
  window.addEventListener("scroll", () => {
    const scrolled = window.scrollY + window.innerHeight;
    const total = document.documentElement.scrollHeight;
    if (scrolled / total > 0.8 && !state.loading && state.hasMore && state.tab === "feed") {
      loadMore();
    }
  });

  // Card interactions (delegation)
  feed.addEventListener("click", (e) => {
    const saveBtn = e.target.closest(".btn-save");
    const goBtn = e.target.closest(".btn-go");
    const card = e.target.closest(".card");

    if (saveBtn) {
      e.stopPropagation();
      toggleSave(saveBtn.dataset.eventId, saveBtn);
      return;
    }
    if (goBtn) {
      e.stopPropagation();
      tg?.openLink(goBtn.dataset.url) ?? window.open(goBtn.dataset.url);
      return;
    }
    if (card) {
      const event = state.events.find(ev => ev.id === card.dataset.id);
      if (event) detailSheet?.open(event);
    }
  });
}

function resetFeed() {
  state.cursor = null;
  state.hasMore = true;
  state.events = [];
  feed.innerHTML = "";
  emptyState.hidden = true;
  loadMore();
}

async function loadMore() {
  if (state.loading) return;
  state.loading = true;
  loader.hidden = false;

  try {
    let events;
    if (state.tab === "saved") {
      events = await fetchSavedEvents();
      state.hasMore = false;
    } else {
      const params = {
        ...state.filters,
        cursor: state.cursor,
        limit: 20,
      };
      events = await fetchEvents(params);
      if (events.length > 0) {
        const last = events[events.length - 1];
        state.cursor = { event_date: last.event_date, id: last.id };
      }
      state.hasMore = events.length === 20;
    }

    state.events = [...state.events, ...events];
    renderEvents(events);

    if (state.events.length === 0) {
      emptyState.hidden = false;
      emptyText.textContent = state.tab === "saved"
        ? "Ещё ничего не сохранено — найди что-то интересное 👆"
        : "Пока нет событий по этим фильтрам — попробуй изменить параметры";
    }
  } finally {
    state.loading = false;
    loader.hidden = true;
  }
}

function renderEvents(events) {
  events.forEach(event => {
    feed.insertAdjacentHTML("beforeend", renderCard(event, state.savedIds.has(event.id)));
  });
}

async function toggleSave(eventId, btn) {
  if (state.savedIds.has(eventId)) {
    await unsaveEvent(eventId);
    state.savedIds.delete(eventId);
    btn.classList.remove("saved");
  } else {
    await saveEvent(eventId);
    state.savedIds.add(eventId);
    btn.classList.add("saved");
  }
}

init();
```

- [ ] **Step 2: Commit**

```bash
git add miniapp/app.js
git commit -m "feat: add main app wiring — state, routing, infinite scroll"
```

---

## Task 17: GitHub Actions Workflows

**Files:**
- Create: `.github/workflows/parser.yml`
- Create: `.github/workflows/cleanup.yml`

- [ ] **Step 1: Write parser.yml**

```yaml
# .github/workflows/parser.yml
name: Daily Event Parser

on:
  schedule:
    - cron: "0 4 * * *"   # 07:00 Moscow (UTC+3)
  workflow_dispatch:        # manual trigger for testing

jobs:
  parse:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Set up Python
        uses: actions/setup-python@v5
        with:
          python-version: "3.11"
          cache: "pip"

      - name: Install dependencies
        run: pip install -r requirements.txt

      - name: Restore Telethon session
        run: echo "$TELETHON_SESSION" | base64 -d > events_session.session
        env:
          TELETHON_SESSION: ${{ secrets.TELETHON_SESSION }}

      - name: Run parsers
        env:
          SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
          SUPABASE_SERVICE_KEY: ${{ secrets.SUPABASE_SERVICE_KEY }}
          TELETHON_APP_ID: ${{ secrets.TELETHON_APP_ID }}
          TELETHON_APP_HASH: ${{ secrets.TELETHON_APP_HASH }}
          TELETHON_SESSION: ${{ secrets.TELETHON_SESSION }}
          TELEGRAM_CHANNELS: ${{ secrets.TELEGRAM_CHANNELS }}
        run: python -m parser.run

      - name: Update Telethon session secret
        if: always()
        env:
          GITHUB_TOKEN: ${{ secrets.GH_PAT }}
        run: |
          if [ -f events_session.session ]; then
            NEW_SESSION=$(base64 -w 0 events_session.session)
            gh secret set TELETHON_SESSION --body "$NEW_SESSION" --repo ${{ github.repository }}
          fi
```

- [ ] **Step 2: Write cleanup.yml**

```yaml
# .github/workflows/cleanup.yml
name: Weekly Cleanup

on:
  schedule:
    - cron: "0 3 * * 1"   # Monday 06:00 Moscow
  workflow_dispatch:

jobs:
  cleanup:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Set up Python
        uses: actions/setup-python@v5
        with:
          python-version: "3.11"
          cache: "pip"

      - name: Install dependencies
        run: pip install -r requirements.txt

      - name: Delete stale events
        env:
          SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
          SUPABASE_SERVICE_KEY: ${{ secrets.SUPABASE_SERVICE_KEY }}
        run: |
          python - <<'EOF'
          import os
          from datetime import datetime, timedelta, timezone
          from supabase import create_client
          from dotenv import load_dotenv

          supabase = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_KEY"])
          cutoff = (datetime.now(timezone.utc) - timedelta(days=7)).isoformat()

          # Delete expired events (bypasses RLS via service key)
          result = supabase.table("events").delete().lt("event_date", cutoff).execute()
          print(f"Deleted {len(result.data)} stale events")

          # Delete unapproved events older than 48h
          cutoff_48h = (datetime.now(timezone.utc) - timedelta(hours=48)).isoformat()
          result2 = supabase.table("events").delete() \
              .eq("is_approved", False).lt("created_at", cutoff_48h).execute()
          print(f"Deleted {len(result2.data)} unapproved events")
          EOF
```

- [ ] **Step 3: Add GitHub Secrets**

Go to GitHub repo → Settings → Secrets and variables → Actions → New repository secret. Add:
- `SUPABASE_URL`
- `SUPABASE_SERVICE_KEY`
- `SUPABASE_ANON_KEY`
- `TELEGRAM_BOT_TOKEN`
- `TELETHON_APP_ID`
- `TELETHON_APP_HASH`
- `TELETHON_SESSION` (from Task 9 Step 1)
- `TELEGRAM_CHANNELS` (comma-separated: `@channel1,@channel2`)
- `GH_PAT` (GitHub Personal Access Token with `secrets:write` permission — for updating session)

- [ ] **Step 4: Test parser workflow manually**

GitHub → Actions → "Daily Event Parser" → "Run workflow". Watch logs.

Expected: `Timepad: fetched N events`, `Timepad: inserted N new events`.

- [ ] **Step 5: Commit**

```bash
git add .github/
git commit -m "feat: add GitHub Actions workflows for parser and cleanup"
```

---

## Task 18: Deploy Mini App

- [ ] **Step 1: Enable GitHub Pages**

GitHub repo → Settings → Pages → Source: "Deploy from a branch" → Branch: `main` → Folder: `/miniapp`.

Wait ~2 min. The Mini App URL will be: `https://YOUR_GITHUB_USERNAME.github.io/REPO_NAME/`

- [ ] **Step 2: Update MINIAPP_URL in .env and bot.py**

```python
# bot.py — the WebAppInfo url is read from env
# Just update .env:
MINIAPP_URL=https://YOUR_GITHUB_USERNAME.github.io/REPO_NAME/
```

- [ ] **Step 3: Register Mini App with BotFather**

In Telegram, message @BotFather:
1. `/newapp` → select your bot
2. App title: "События Москвы"
3. App description: "Актуальные профессиональные мероприятия Москвы"
4. App URL: paste your GitHub Pages URL

- [ ] **Step 4: Run bot and test end-to-end**

```bash
python bot.py
```

Open bot in Telegram → `/start` → tap "Открыть события" → Mini App opens.

Verify:
- Events load from Supabase
- Category chips filter events
- Filters bottom sheet opens and works
- Save button saves/unsaves event
- Saved tab shows saved events
- Detail sheet opens on card tap
- "Перейти" / "Зарегистрироваться" opens correct URL

- [ ] **Step 5: Commit final state**

```bash
git add .
git commit -m "feat: MVP complete — events mini app with bot, parsers, and GitHub Actions"
```

---

## Summary

| Task | What it builds |
|------|---------------|
| 1 | Project setup |
| 2 | Supabase schema + RLS |
| 3 | Edge Function (initData → JWT) |
| 4 | Telegram bot |
| 5 | Parser base + og:image scraper |
| 6 | Timepad parser |
| 7 | Afisha.ru parser |
| 8 | Yandex Afisha parser |
| 9 | Telegram channels parser (Telethon) |
| 10 | Parser entry point + Supabase writer |
| 11 | Mini App HTML shell + CSS |
| 12 | Mini App API layer |
| 13 | Event card component |
| 14 | Filter bottom sheet |
| 15 | Detail bottom sheet |
| 16 | App wiring |
| 17 | GitHub Actions (cron + cleanup) |
| 18 | Deploy + end-to-end test |
