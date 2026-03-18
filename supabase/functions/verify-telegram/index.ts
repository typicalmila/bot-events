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
