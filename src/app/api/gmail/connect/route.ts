import { randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(new URL("/login", request.url));
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const encryptionKey = Buffer.from(process.env.GMAIL_TOKEN_ENCRYPTION_KEY ?? "", "base64");
  if (!clientId || !clientSecret || encryptionKey.length !== 32) return NextResponse.json({ error: "נדרש להגדיר GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET ומפתח הצפנה ב-Vercel" }, { status: 503 });
  const state = randomBytes(24).toString("hex");
  const redirectUri = new URL("/api/gmail/callback", request.url).toString();
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "https://www.googleapis.com/auth/gmail.readonly",
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  });
  const response = NextResponse.redirect("https://accounts.google.com/o/oauth2/v2/auth?" + params.toString());
  response.cookies.set("jh-gmail-oauth-state", state, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/api/gmail/callback", maxAge: 600 });
  return response;
}
