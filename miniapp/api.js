// Replace these with your actual Supabase project values before deploy
// SUPABASE_ANON_KEY is intentionally public-safe (read-only, RLS enforced)
const SUPABASE_URL = "https://vluxrkshzonvpsushqhz.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZsdXhya3Noem9udnBzdXNocWh6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM4MzExNzgsImV4cCI6MjA4OTQwNzE3OH0.-lTFMchrf6R28G54Fp2u_vBg01dPd4fxfTjNubgq_mY";
const VERIFY_URL = `${SUPABASE_URL}/functions/v1/verify-telegram`;

let _accessToken = null;
let _userId = null;

export async function authenticate() {
  const initData = window.Telegram?.WebApp?.initData;
  if (!initData) return null;
  try {
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
  } catch {
    return null;
  }
}

export function getUserId() { return _userId; }

function authHeaders() {
  const h = { "apikey": SUPABASE_ANON_KEY, "Content-Type": "application/json" };
  if (_accessToken) h["Authorization"] = `Bearer ${_accessToken}`;
  return h;
}

export async function fetchEvents({
  categories = [], format = null, priceType = null,
  dateFrom = null, dateTo = null, cursor = null, limit = 20
} = {}) {
  let url = `${SUPABASE_URL}/rest/v1/events?select=*&is_approved=eq.true&order=event_date.asc,id.asc&limit=${limit}`;
  if (cursor) {
    url += `&or=(event_date.gt.${cursor.event_date},and(event_date.eq.${cursor.event_date},id.gt.${cursor.id}))`;
  }
  if (categories.length > 0) url += `&category=in.(${categories.join(",")})`;
  if (format) url += `&format=eq.${format}`;
  if (priceType) url += `&price_type=eq.${priceType}`;
  if (dateFrom) url += `&event_date=gte.${dateFrom}`;
  if (dateTo) url += `&event_date=lte.${dateTo}`;
  try {
    const resp = await fetch(url, { headers: authHeaders() });
    if (!resp.ok) return [];
    return resp.json();
  } catch { return []; }
}

export async function fetchSavedIds() {
  if (!_userId) return new Set();
  const url = `${SUPABASE_URL}/rest/v1/saved_events?select=event_id&user_id=eq.${_userId}`;
  try {
    const resp = await fetch(url, { headers: authHeaders() });
    if (!resp.ok) return new Set();
    const rows = await resp.json();
    return new Set(rows.map(r => r.event_id));
  } catch { return new Set(); }
}

export async function fetchSavedEvents() {
  if (!_userId) return [];
  const url = `${SUPABASE_URL}/rest/v1/saved_events?select=event_id,events(*)&user_id=eq.${_userId}&order=saved_at.desc`;
  try {
    const resp = await fetch(url, { headers: authHeaders() });
    if (!resp.ok) return [];
    const rows = await resp.json();
    return rows.map(r => r.events).filter(Boolean);
  } catch { return []; }
}

export async function saveEvent(eventId) {
  if (!_userId) return;
  await fetch(`${SUPABASE_URL}/rest/v1/saved_events`, {
    method: "POST",
    headers: { ...authHeaders(), "Prefer": "resolution=ignore-duplicates" },
    body: JSON.stringify({ user_id: _userId, event_id: eventId }),
  });
}

export async function unsaveEvent(eventId) {
  if (!_userId) return;
  await fetch(`${SUPABASE_URL}/rest/v1/saved_events?user_id=eq.${_userId}&event_id=eq.${eventId}`, {
    method: "DELETE",
    headers: authHeaders(),
  });
}

export async function countEvents({
  categories = [], format = null, priceType = null, dateFrom = null, dateTo = null
} = {}) {
  let url = `${SUPABASE_URL}/rest/v1/events?select=id&is_approved=eq.true`;
  if (categories.length > 0) url += `&category=in.(${categories.join(",")})`;
  if (format) url += `&format=eq.${format}`;
  if (priceType) url += `&price_type=eq.${priceType}`;
  if (dateFrom) url += `&event_date=gte.${dateFrom}`;
  if (dateTo) url += `&event_date=lte.${dateTo}`;
  try {
    const resp = await fetch(url, {
      headers: { ...authHeaders(), "Prefer": "count=exact", "Range-Unit": "items", "Range": "0-0" }
    });
    const countHeader = resp.headers.get("Content-Range");
    return countHeader ? parseInt(countHeader.split("/")[1]) : 0;
  } catch { return 0; }
}

export { SUPABASE_URL, SUPABASE_ANON_KEY };
