# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Telegram Mini App for Moscow professional events (AI, Marketing, Sales, Analytics, Culture). Three moving parts:

1. **Python parsers** — scrape Timepad API, Afisha.ru, Yandex Afisha, Telegram channels → write to Supabase
2. **Telegram bot** (`bot.py`) — sends a Web App button to open the Mini App
3. **Mini App** (`miniapp/`) — Vanilla JS, served via GitHub Pages, reads from Supabase REST API

## Commands

```bash
# Run tests
python3 -m pytest tests/ -v

# Run a single test file
python3 -m pytest tests/test_timepad.py -v

# Run parsers manually (requires .env)
python3 -m parser.run

# Run bot (requires .env)
TELEGRAM_BOT_TOKEN=... MINIAPP_URL=... python3 bot.py

# Deploy Edge Function
~/bin/supabase functions deploy verify-telegram --no-verify-jwt

# Apply DB migration
~/bin/supabase db push --password '...'
```

## Architecture

### Auth flow
The Mini App cannot use Supabase Auth directly. Instead:
1. `miniapp/api.js` → `authenticate()` sends Telegram `initData` to the `verify-telegram` Edge Function
2. Edge Function verifies HMAC-SHA256 signature using `BOT_TOKEN`, then mints a JWT using `SUPABASE_JWT_SECRET`
3. JWT has custom claim `user_id` (Telegram user ID) used by RLS policies
4. All subsequent REST calls use `Authorization: Bearer <token>`

### RLS policies
- `events`: SELECT allowed for `is_approved=true` AND `event_date >= now()`
- `saved_events`: SELECT/INSERT/DELETE scoped to `request.jwt.claims->>'user_id'`
- Parsers bypass RLS using the `service_role` key

### Parsers
Each parser in `parser/` implements `BaseParser.fetch() → list[EventData]`. Key behaviors:
- **Timepad** (`timepad.py`): REST API, auto-approved (`AUTO_APPROVE_SOURCES = {"timepad"}` in `run.py`)
- **Afisha** (`afisha.py`) and **Yandex Afisha** (`yandex_afisha.py`): both are JS-rendered — tests use hand-crafted HTML fixtures in `tests/fixtures/`, not live scraping
- **Telegram** (`telegram_channels.py`): Telethon MTProto; requires `TELETHON_SESSION` env (base64-encoded session file); skips silently if no credentials
- **Cover images** (`cover.py`): `fetch_cover_image(url)` scrapes `og:image`; always returns `None` on any error (never raises)

### Mini App frontend
No build step — plain ES modules loaded directly in the browser.
- `api.js` — all Supabase REST calls; keyset pagination via `cursor={event_date, id}`
- `app.js` — main state machine: `{tab, category, filters, cursor, loading, hasMore, events, savedIds}`
- `card.js`, `detail.js`, `filters.js` — pure HTML string renderers / bottom sheet classes

### Deduplication
Events are deduplicated via `UNIQUE(source, source_event_id)` + `ON CONFLICT DO NOTHING` in upserts.

### GitHub Actions
- `parser.yml` — cron 04:00 UTC (07:00 Moscow), runs `python -m parser.run`; saves updated Telethon session back to `TELETHON_SESSION` secret via `gh secret set`
- `cleanup.yml` — Monday 03:00 UTC; deletes events older than 7 days and unapproved events older than 48h

## Infrastructure

| Service | Purpose |
|---------|---------|
| Supabase | PostgreSQL + REST API + Edge Functions |
| GitHub Pages | Hosts `miniapp/` at `https://typicalmila.github.io/bot-events/miniapp/` |
| GitHub Actions | Cron parsers + cleanup |

## Required Secrets

**Supabase Edge Function secrets** (set via `supabase secrets set`):
- `TELEGRAM_BOT_TOKEN`, `JWT_SECRET` — `SUPABASE_JWT_SECRET` is injected automatically

**GitHub Actions secrets**:
- `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `SUPABASE_ANON_KEY`
- `TELEGRAM_BOT_TOKEN`
- `TELETHON_APP_ID`, `TELETHON_APP_HASH`, `TELETHON_SESSION`, `TELEGRAM_CHANNELS`
- `GH_PAT` — needs `repo` + `workflow` + `secrets:write` scopes
