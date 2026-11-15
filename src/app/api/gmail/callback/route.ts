import { createCipheriv, randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const origin = new URL(request.url).origin;
  const fail = (message: string) => NextResponse.redirect(new URL("/?gmail=error&reason=" + encodeURIComponent(message), origin));
  const state = request.nextUrl.searchParams.get("state");
  const code = request.nextUrl.searchParams.get("code");
  if (!state || state !== request.cookies.get("jh-gmail-oauth-state")?.value || !code) return fail("אימות חיבור Gmail נכשל");
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(new URL("/login", origin));
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const encryptionKey = Buffer.from(process.env.GMAIL_TOKEN_ENCRYPTION_KEY ?? "", "base64");
  if (!clientId || !clientSecret || encryptionKey.length !== 32) return fail("חסרות הגדרות OAuth או מפתח הצפנה בשרת");
  const redirectUri = new URL("/api/gmail/callback", request.url).toString();
  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, grant_type: "authorization_code" }),
    cache: "no-store",
  });
  if (!tokenResponse.ok) return fail("Google לא אישרה את החיבור. בדוק את כתובת ה-Redirect ב-Google Cloud.");
  const tokens = await tokenResponse.json();
  if (!tokens.refresh_token) return fail("Google לא החזירה הרשאת רענון. נסה להתחבר מחדש עם אישור גישה.");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey, iv);
  const ciphertext = Buffer.concat([cipher.update(tokens.refresh_token, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  const { error } = await supabase.from("gmail_connections").upsert({
    user_id: user.id,
    refresh_token_ciphertext: ciphertext.toString("base64"),
    refresh_token_iv: iv.toString("base64"),
    refresh_token_tag: tag.toString("base64"),
    scopes: ["https://www.googleapis.com/auth/gmail.readonly"],
    connected_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }, { onConflict: "user_id" });
  if (error) return fail("החיבור אושר אך שמירת ההרשאה נכשלה");
  const response = NextResponse.redirect(new URL("/?gmail=connected", origin));
  response.cookies.delete("jh-gmail-oauth-state");
  return response;
}
