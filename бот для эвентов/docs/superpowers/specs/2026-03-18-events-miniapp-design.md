# Telegram Mini App — События Москвы

**Дата:** 2026-03-18
**Статус:** Approved

---

## Обзор

Telegram Mini App для профессиональной аудитории Москвы (маркетологи, аналитики, продажники, AI-специалисты). Агрегирует актуальные мероприятия — конференции, нетворкинги, вебинары, воркшопы — из нескольких источников. Пользователь открывает приложение сам (pull-модель), фильтрует по интересам и сохраняет понравившиеся события.

**Только Москва. MVP.**

---

## Архитектура

```
[Telegram Bot + Mini App]
        ↓
[Telegram Web App SDK] → фронт (HTML/JS/CSS)
        ↓
[Supabase REST API + Edge Functions] ← авторизованные запросы
        ↓
[PostgreSQL в Supabase + RLS]
        ↑
[Python парсер] — запускается раз в день (GitHub Actions cron, 04:00 UTC = 07:00 МСК)
        ↑
[Supabase Studio] — ручная модерация и добавление событий
```

**Компоненты:**
- `bot.py` — Telegram бот, выдаёт ссылку на Mini App
- `parser/` — Python скрипты парсинга по источникам
- `miniapp/` — фронт: HTML + Vanilla JS + Telegram Web App SDK
- `supabase/functions/` — Edge Function для верификации Telegram initData
- Supabase — управляемый PostgreSQL + REST API + Studio

---

## Безопасность и аутентификация

### Верификация пользователя (initData)

Telegram Mini App передаёт `window.Telegram.WebApp.initData` — подписанную строку с данными пользователя (user_id, username, hash). Перед любым write-запросом фронтенд отправляет `initData` в Supabase Edge Function, которая:

1. Верифицирует HMAC-SHA256 подпись (ключ = `TELEGRAM_BOT_TOKEN`)
2. Проверяет `auth_date` — не старше 24 часов
3. Возвращает JWT-токен Supabase с `user_id` в claims

Все дальнейшие запросы к API идут с этим JWT.

### Row Level Security (RLS)

```sql
-- saved_events: пользователь видит и изменяет только свои записи
CREATE POLICY "user own saved_events" ON saved_events
  USING (user_id = (current_setting('request.jwt.claims')::json->>'user_id')::bigint);

-- events: читают все (anon key), пишет только сервис (service_role key)
CREATE POLICY "events readable by all" ON events
  FOR SELECT USING (is_approved = true AND event_date >= now());
```

### Секреты и сессии

Все ключи хранятся в GitHub Actions Secrets и Supabase Vault:
- `TELEGRAM_BOT_TOKEN` — бот токен
- `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` — для парсера
- `SUPABASE_ANON_KEY` — для фронтенда (публичный)
- `TELETHON_APP_ID`, `TELETHON_APP_HASH` — для MTProto парсера

**Telethon сессия:** файл сессии сохраняется как base64 в GitHub Actions Secret (`TELETHON_SESSION`). При старте парсера — восстанавливается из секрета, при завершении — обновляется обратно через GitHub API. Это предотвращает потерю сессии между запусками и необходимость интерактивного входа.

### Replay-атаки (принятый риск MVP)

JWT-токен действителен 24 часа без защиты от повторного использования (nonce не реализован). Для MVP это принятый риск — в v2 добавить short-lived tokens (1 час) или nonce.

---

## Модель данных

### Таблица `events`

| Поле | Тип | Описание |
|------|-----|----------|
| `id` | uuid | PK |
| `title` | text | Название события |
| `description` | text | Краткое описание |
| `category` | enum | `marketing`, `sales`, `analytics`, `ai`, `culture`, `other` |
| `format` | enum | `online`, `offline`, `hybrid` |
| `price_type` | enum | `free`, `paid` |
| `price_amount` | int | Цена в рублях; NULL если `price_type = free` |
| `price_currency` | text | Валюта (default: `'RUB'`; CHECK currency = 'RUB' для MVP) |
| `event_date` | timestamptz | Дата и время начала (МСК) |
| `speakers` | text[] | Список имён: `["Иван Иванов", "Мария Петрова"]` |
| `url` | text | Ссылка на регистрацию |
| `cover_image_url` | text | og:image; NULL если не найдено → фронт показывает заглушку |
| `source` | text | `timepad`, `afisha`, `yandex_afisha`, `telegram`, `manual` |
| `source_event_id` | text | ID события в источнике (для дедупликации) |
| `is_approved` | bool | Прошло модерацию (default: `false`) |
| `created_at` | timestamptz | Дата добавления |

**Дедупликация:** уникальный constraint `(source, source_event_id)`. При повторном парсинге — `ON CONFLICT DO NOTHING`.

**Устаревшие события:** RLS-политика фильтрует `event_date >= now()` (UTC, Supabase). События мгновенно исчезают из ленты после наступления времени — это ожидаемое поведение, не ошибка. GitHub Actions раз в неделю физически удаляет строки где `event_date < now() - interval '7 days'`.

### Таблица `saved_events`

| Поле | Тип | Описание |
|------|-----|----------|
| `user_id` | bigint | Telegram user ID (из верифицированного JWT) |
| `event_id` | uuid | FK → events.id |
| `saved_at` | timestamptz | Дата сохранения |

PK: `(user_id, event_id)`.

---

## UI/UX

### Главный экран — лента с обложками

- **Шапка:** "События Москвы" + кнопка "Фильтры" (открывает bottom sheet)
- **Чипы категорий:** горизонтальный скролл (Все / 🤖 ИИ / 📈 Маркетинг / 💼 Продажи / 📊 Аналитика / 🎭 Культура / Другое)
- **Карточки событий** (вертикальная лента, постраничная загрузка):
  - Обложка (og:image, ~140px высота) с градиентом снизу; при отсутствии — серая заглушка с иконкой категории
  - Бейджи на картинке: категория + цена / "Бесплатно"
  - Название, описание (2 строки, обрезается), спикеры
  - Дата, время, формат
  - Кнопка "Перейти" (открывает url) + иконка закладки
- **Пагинация:** 20 карточек за раз, keyset по `(event_date ASC, id ASC)`, подгрузка при 80% скролла. Keyset исключает дубли при изменении датасета между запросами.
- **Нижний таб-бар:** 🗓 События | 🔖 Сохранённые

**Пустое состояние (лента):** "Пока нет событий по этим фильтрам — попробуй изменить параметры"

### Фильтры (bottom sheet)

Открывается свайпом вверх или кнопкой. Секции:
- **Категория** (мультиселект чипы): Все, ИИ, Маркетинг, Продажи, Аналитика, Культура, Другое
- **Формат:** Любой / Онлайн / Офлайн / Гибрид
- **Цена:** Любая / Бесплатно / Платно
- **Дата:** Эта неделя / Этот месяц / Выбрать диапазон (макс. 3 месяца вперёд)
- Кнопки: "Сбросить" / "Показать N событий"

### Экран сохранённых

Та же карточная лента, фильтрованная по `saved_events` текущего пользователя.

**Пустое состояние:** "Ещё ничего не сохранено — найди что-то интересное 👆"

### Детальный экран (bottom sheet по тапу на карточку)

Полное описание, список спикеров, дата/время, адрес (если офлайн), цена, кнопка "Зарегистрироваться".

---

## Источники данных и парсинг

| Источник | Метод | Стабильность | Примечание |
|----------|-------|--------------|-----------|
| **Timepad** | REST API (бесплатный) | ✅ Высокая | Основной источник |
| **Афиша** (afisha.ru) | Парсинг HTML (BeautifulSoup) | 🟡 Средняя | |
| **Яндекс Афиша** | Парсинг HTML (BeautifulSoup) | 🟡 Средняя | |
| **Telegram-каналы** | MTProto через Telethon (app_id + app_hash) | ✅ Высокая | Читаем публичные каналы без членства |
| **Instagram** | **Исключён из MVP** | — | Слишком нестабилен, добавим в v2 |

**Расписание:** GitHub Actions cron `0 4 * * *` (= 07:00 МСК, UTC+3).

**Обложки:** парсер вытаскивает `og:image` из URL события при добавлении. При ошибке (403, timeout) — сохраняет `NULL`, фронт показывает заглушку.

**Модерация:**
- Timepad: `is_approved = true` автоматически (доверенный источник).
- Остальные: `is_approved = false`, администратор одобряет в Supabase Studio в течение 24 часов.
- Если не одобрено за 48 часов — событие удаляется GitHub Actions cron.

---

## Стек технологий

| Слой | Технология |
|------|-----------|
| Фронтенд | HTML, Vanilla JS, CSS + Telegram Web App SDK |
| База данных | PostgreSQL (Supabase) + RLS |
| API | Supabase REST API + Edge Functions (верификация) |
| Бот | Python, python-telegram-bot |
| Парсер | Python, requests, BeautifulSoup, Telethon |
| CI/CD | GitHub Actions (cron парсера + архивация) |
| Хостинг | Supabase (free tier → upgrade по мере роста), GitHub Actions |

**Supabase free tier:** 500 MB БД, проект не паузится при ежедневной активности (cron держит его живым).

---

## Что не входит в MVP

- Push-уведомления о новых событиях
- Регистрация организаторов / самостоятельная подача событий
- Рейтинги и отзывы
- Карта событий
- Текстовый поиск
- Рекомендации на основе истории
- Instagram-парсинг (слишком нестабилен, v2)
- GDPR/удаление данных пользователя (v2)
- Rate limiting на Edge Functions (v2; MVP — принятый риск)
- Nonce/replay-защита для JWT (v2)
