import { createDecipheriv } from "node:crypto";
import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { hasJsonContentType, isSameOriginMutation } from "@/lib/http/request-guards";

export const runtime = "nodejs";
export const maxDuration = 30;

type GmailHeader = { name: string; value: string };
type GmailMessage = { id: string; snippet?: string; payload?: { headers?: GmailHeader[] } };

export async function POST(request: Request) {
  if (!isSameOriginMutation(request) || !hasJsonContentType(request)) return NextResponse.json({ error: "Invalid request" }, { status: 403 });
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { data: connection } = await supabase.from("gmail_connections").select("*").eq("user_id", user.id).maybeSingle();
  if (!connection) return NextResponse.json({ error: "עדיין לא חיברת Gmail. לחץ על 'חיבור Gmail' ואשר הרשאת קריאה בלבד." }, { status: 409 });
  const encryptionKey = Buffer.from(process.env.GMAIL_TOKEN_ENCRYPTION_KEY ?? "", "base64");
  if (encryptionKey.length !== 32) return NextResponse.json({ error: "מפתח הצפנת Gmail חסר או לא תקין בשרת." }, { status: 503 });
  let refreshToken = "";
  try {
    const decipher = createDecipheriv("aes-256-gcm", encryptionKey, Buffer.from(connection.refresh_token_iv, "base64"));
    decipher.setAuthTag(Buffer.from(connection.refresh_token_tag, "base64"));
    refreshToken = Buffer.concat([decipher.update(Buffer.from(connection.refresh_token_ciphertext, "base64")), decipher.final()]).toString("utf8");
  } catch {
    return NextResponse.json({ error: "לא ניתן לפענח את הרשאת Gmail. יש לחבר את החשבון מחדש." }, { status: 500 });
  }
  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: process.env.GOOGLE_CLIENT_ID ?? "", client_secret: process.env.GOOGLE_CLIENT_SECRET ?? "", refresh_token: refreshToken, grant_type: "refresh_token" }),
    cache: "no-store",
  });
  if (!tokenResponse.ok) return NextResponse.json({ error: "הרשאת Gmail פגה. חבר מחדש את החשבון." }, { status: 401 });
  const tokenData = await tokenResponse.json();
  const accessToken = tokenData.access_token as string;
  const listResponse = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=30&q=" + encodeURIComponent("newer_than:60d {job jobs משרה דרושים interview application מועמדות ראיון}"), { headers: { Authorization: "Bearer " + accessToken }, cache: "no-store" });
  if (!listResponse.ok) return NextResponse.json({ error: "Google לא אפשרה לקרוא את הודעות Gmail." }, { status: 502 });
  const list = await listResponse.json();
  const ids: string[] = (list.messages ?? []).map((x: { id: string }) => x.id);
  const { data: profile } = await supabase.from("profiles").select("location").eq("user_id", user.id).maybeSingle();
  const matches: Array<{ user_id: string; source: string; source_url: string; application_url: string; company_name: string; title: string; description: string; location: string | null; raw_metadata: Record<string, unknown> }> = [];
  for (const id of ids.slice(0, 30)) {
    const response = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/" + encodeURIComponent(id) + "?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date", { headers: { Authorization: "Bearer " + accessToken }, cache: "no-store" });
    if (!response.ok) continue;
    const message = await response.json() as GmailMessage;
    const headers = message.payload?.headers ?? [];
    const subject = headers.find(x => x.name.toLowerCase() === "subject")?.value ?? "הודעה בנושא משרה";
    const from = headers.find(x => x.name.toLowerCase() === "from")?.value ?? "מקור אימייל";
    const snippet = message.snippet ?? "";
    if (!/(job|jobs|career|position|application|interview|hiring|משרה|דרושים|מועמדות|ראיון|גיוס)/i.test(subject + " " + snippet)) continue;
    const known = "https://mail.google.com/mail/u/0/#all/" + id;
    matches.push({ user_id: user.id, source: "gmail", source_url: known, application_url: known, company_name: from.slice(0, 180), title: subject.slice(0, 180), description: snippet.slice(0, 4000), location: profile?.location ?? null, raw_metadata: { gmail_message_id: id, imported_from_email: true } });
  }
  if (!matches.length) return NextResponse.json({ found: 0, inserted: 0, message: "לא נמצאו הודעות שנראות קשורות למשרות ב-60 הימים האחרונים." });
  const urls = matches.map(x => x.source_url);
  const { data: existing } = await supabase.from("jobs").select("source_url").eq("user_id", user.id).in("source_url", urls);
  const known = new Set((existing ?? []).map(x => x.source_url));
  const fresh = matches.filter(x => !known.has(x.source_url));
  if (fresh.length) {
    const { error } = await supabase.from("jobs").insert(fresh);
    if (error) return NextResponse.json({ error: "נמצאו הודעות אך שמירתן נכשלה." }, { status: 500 });
  }
  return NextResponse.json({ found: matches.length, inserted: fresh.length, message: `נמצאו ${matches.length} הודעות רלוונטיות; ${fresh.length} חדשות נוספו למעקב.` });
}
