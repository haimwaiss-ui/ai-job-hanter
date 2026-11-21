import { createCipheriv, randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { googleOAuthCodeResponseSchema } from "@/lib/validation/gmail";

export const runtime = "nodejs";

const GMAIL_READONLY_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";

function fail(origin: string, message: string) {
  const response = NextResponse.redirect(
    new URL("/?gmail=error&reason=" + encodeURIComponent(message), origin),
  );
  response.cookies.delete("jh-gmail-oauth-state");
  return response;
}

export async function GET(request: NextRequest) {
  const origin = new URL(request.url).origin;
  const state = request.nextUrl.searchParams.get("state");
  const code = request.nextUrl.searchParams.get("code");
  const expectedState = request.cookies.get("jh-gmail-oauth-state")?.value;

  if (!state || !/^[0-9a-f]{48}$/i.test(state) || state !== expectedState ||
      !code || code.length > 4096) {
    return fail(origin, "אימות חיבור Gmail נכשל");
  }

  const supabase = await createSupabaseServerClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    const response = NextResponse.redirect(new URL("/login", origin));
    response.cookies.delete("jh-gmail-oauth-state");
    return response;
  }

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const encodedKey = process.env.GMAIL_TOKEN_ENCRYPTION_KEY ?? "";
  const encryptionKey = Buffer.from(encodedKey, "base64");
  if (!clientId || !clientSecret || encryptionKey.length !== 32 ||
      encryptionKey.toString("base64") !== encodedKey) {
    return fail(origin, "חסרות הגדרות OAuth או מפתח הצפנה תקין בשרת");
  }

  const redirectUri = new URL("/api/gmail/callback", request.url).toString();
  let refreshToken: string;
  try {
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    });
    if (!tokenResponse.ok) {
      return fail(origin, "Google לא אישרה את החיבור. בדוק את כתובת ה-Redirect ב-Google Cloud.");
    }

    const tokenBody: unknown = await tokenResponse.json().catch(() => null);
    const parsedTokens = googleOAuthCodeResponseSchema.safeParse(tokenBody);
    if (!parsedTokens.success ||
        (parsedTokens.data.scope !== undefined &&
          !parsedTokens.data.scope.split(/\\s+/).includes(GMAIL_READONLY_SCOPE))) {
      return fail(origin, "Google החזירה הרשאה לא תקינה או ללא הרשאת Gmail לקריאה בלבד.");
    }
    refreshToken = parsedTokens.data.refresh_token;
  } catch {
    return fail(origin, "שירות ההרשאות של Google אינו זמין כרגע.");
  }

  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey, iv);
  const ciphertext = Buffer.concat([cipher.update(refreshToken, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  const { error: saveError } = await supabase.from("gmail_connections").upsert({
    user_id: user.id,
    refresh_token_ciphertext: ciphertext.toString("base64"),
    refresh_token_iv: iv.toString("base64"),
    refresh_token_tag: tag.toString("base64"),
    scopes: [GMAIL_READONLY_SCOPE],
    connected_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }, { onConflict: "user_id" });

  if (saveError) {
    return fail(origin, "החיבור אושר אך שמירת ההרשאה נכשלה");
  }

  const response = NextResponse.redirect(new URL("/?gmail=connected", origin));
  response.cookies.delete("jh-gmail-oauth-state");
  return response;
}
