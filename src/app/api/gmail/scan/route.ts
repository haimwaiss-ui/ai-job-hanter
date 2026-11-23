import { createDecipheriv } from "node:crypto";
import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { parseUserApiRateLimitResult } from "@/lib/http/user-api-rate-limit";
import {
  gmailMessageListSchema,
  gmailMessageSchema,
  gmailScanRequestSchema,
  googleRefreshTokenResponseSchema,
} from "@/lib/validation/gmail";
import {
  contentLengthExceeds,
  hasJsonContentType,
  isSameOriginMutation,
  MAX_JSON_BODY_BYTES,
} from "@/lib/http/request-guards";

export const runtime = "nodejs";
export const maxDuration = 30;

const GOOGLE_TIMEOUT_MS = 5_000;
const MESSAGE_TIMEOUT_MS = 4_000;
const MAX_MESSAGES = 20;
const MESSAGE_BATCH_SIZE = 5;

type GmailMessage = ReturnType<typeof gmailMessageSchema.parse>;

function cleanText(value: string, maxLength: number): string {
  return value
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function headerValue(message: GmailMessage, headerName: string): string | null {
  const header = message.payload?.headers?.find(
    (item) => item.name.toLowerCase() === headerName.toLowerCase(),
  );
  return header ? cleanText(header.value, 500) : null;
}

function jsonError(message: string, status: number, code: string) {
  return NextResponse.json({ error: message, code }, { status });
}

export async function POST(request: Request) {
  if (!isSameOriginMutation(request)) {
    return jsonError("Invalid request origin", 403, "INVALID_ORIGIN");
  }
  if (!hasJsonContentType(request)) {
    return jsonError("Expected application/json", 415, "UNSUPPORTED_MEDIA_TYPE");
  }
  if (contentLengthExceeds(request, MAX_JSON_BODY_BYTES)) {
    return jsonError("Request body too large", 413, "BODY_TOO_LARGE");
  }

  const rawBody = await request.text().catch(() => null);
  if (rawBody === null) {
    return jsonError("Invalid JSON body", 400, "INVALID_JSON");
  }
  if (Buffer.byteLength(rawBody, "utf8") > MAX_JSON_BODY_BYTES) {
    return jsonError("Request body too large", 413, "BODY_TOO_LARGE");
  }
  let body: unknown = {};
  if (rawBody.trim().length > 0) {
    try {
      body = JSON.parse(rawBody);
    } catch {
      return jsonError("Invalid JSON body", 400, "INVALID_JSON");
    }
  }
  const parsedBody = gmailScanRequestSchema.safeParse(body);
  if (!parsedBody.success) {
    return jsonError("Invalid Gmail scan request", 422, "INVALID_REQUEST");
  }

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const encodedKey = process.env.GMAIL_TOKEN_ENCRYPTION_KEY ?? "";
  const encryptionKey = Buffer.from(encodedKey, "base64");
  if (!clientId || !clientSecret || encryptionKey.length !== 32 ||
      encryptionKey.toString("base64") !== encodedKey) {
    return jsonError("Gmail integration is not configured correctly", 503, "GMAIL_NOT_CONFIGURED");
  }

  const supabase = await createSupabaseServerClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return jsonError("Unauthorized", 401, "UNAUTHORIZED");
  }

  const { data: connection, error: connectionError } = await supabase
    .from("gmail_connections")
    .select("refresh_token_ciphertext,refresh_token_iv,refresh_token_tag")
    .eq("user_id", user.id)
    .maybeSingle();

  if (connectionError) {
    return jsonError("Unable to load Gmail connection", 500, "GMAIL_CONNECTION_READ_FAILED");
  }
  if (!connection) {
    return jsonError("עדיין לא חיברת Gmail. לחץ על 'חיבור Gmail' ואשר הרשאת קריאה בלבד.", 409, "GMAIL_NOT_CONNECTED");
  }

  const { data: rateLimitData, error: rateLimitError } = await supabase.rpc(
    "consume_user_api_rate_limit",
    { p_bucket: "gmail_scan" },
  );
  const rateLimit = parseUserApiRateLimitResult(rateLimitData);
  if (rateLimitError || !rateLimit) {
    console.error("gmail_scan_rate_limit_unavailable", rateLimitError?.code ?? "invalid_result");
    return jsonError("Gmail scan rate-limit service is unavailable", 503, "GMAIL_RATE_LIMIT_UNAVAILABLE");
  }
  if (!rateLimit.allowed) {
    return NextResponse.json({
      error: "בוצעו יותר מדי סריקות Gmail בזמן קצר. נסה שוב בעוד מספר שניות.",
      code: "GMAIL_RATE_LIMITED",
      retryAfterSeconds: rateLimit.retry_after_seconds,
    }, {
      status: 429,
      headers: {
        "Retry-After": String(rateLimit.retry_after_seconds),
        "Cache-Control": "no-store",
      },
    });
  }

  let refreshToken: string;
  try {
    const iv = Buffer.from(connection.refresh_token_iv, "base64");
    const tag = Buffer.from(connection.refresh_token_tag, "base64");
    const ciphertext = Buffer.from(connection.refresh_token_ciphertext, "base64");
    if (iv.length !== 12 || tag.length !== 16 || ciphertext.length === 0) {
      throw new Error("Invalid encrypted token envelope");
    }
    const decipher = createDecipheriv("aes-256-gcm", encryptionKey, iv);
    decipher.setAuthTag(tag);
    refreshToken = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]).toString("utf8");
    if (refreshToken.length < 20 || refreshToken.length > 8192) {
      throw new Error("Invalid refresh token");
    }
  } catch {
    return jsonError("לא ניתן לפענח את הרשאת Gmail. יש לחבר את החשבון מחדש.", 500, "GMAIL_TOKEN_DECRYPT_FAILED");
  }

  let accessToken: string;
  try {
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: "refresh_token",
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(GOOGLE_TIMEOUT_MS),
    });
    if (!tokenResponse.ok) {
      return jsonError(
        "הרשאת Gmail פגה או נדחתה. חבר מחדש את החשבון.",
        tokenResponse.status === 401 || tokenResponse.status === 400 ? 401 : 502,
        "GMAIL_TOKEN_REFRESH_FAILED",
      );
    }
    const tokenBody: unknown = await tokenResponse.json().catch(() => null);
    const parsedToken = googleRefreshTokenResponseSchema.safeParse(tokenBody);
    if (!parsedToken.success) {
      return jsonError("Google החזירה תשובת הרשאה לא תקינה.", 502, "GMAIL_TOKEN_RESPONSE_INVALID");
    }
    accessToken = parsedToken.data.access_token;
  } catch {
    return jsonError("שירות ההרשאות של Google אינו זמין כרגע.", 502, "GOOGLE_AUTH_UNAVAILABLE");
  }

  const gmailQuery = "newer_than:60d {job jobs משרה דרושים interview application מועמדות ראיון}";
  let ids: string[];
  try {
    const listUrl = new URL("https://gmail.googleapis.com/gmail/v1/users/me/messages");
    listUrl.searchParams.set("maxResults", String(MAX_MESSAGES));
    listUrl.searchParams.set("q", gmailQuery);
    const listResponse = await fetch(listUrl, {
      headers: { Authorization: "Bearer " + accessToken },
      cache: "no-store",
      signal: AbortSignal.timeout(GOOGLE_TIMEOUT_MS),
    });
    if (!listResponse.ok) {
      return jsonError("Google לא אפשרה לקרוא את הודעות Gmail.", 502, "GMAIL_LIST_FAILED");
    }
    const listBody: unknown = await listResponse.json().catch(() => null);
    const parsedList = gmailMessageListSchema.safeParse(listBody);
    if (!parsedList.success) {
      return jsonError("Google החזירה רשימת הודעות לא תקינה.", 502, "GMAIL_LIST_RESPONSE_INVALID");
    }
    ids = (parsedList.data.messages ?? []).map((message) => message.id);
  } catch {
    return jsonError("שירות Gmail אינו זמין כרגע.", 502, "GMAIL_API_UNAVAILABLE");
  }

  if (ids.length === 0) {
    return NextResponse.json({
      found: 0,
      inserted: 0,
      message: "לא נמצאו הודעות שנראות קשורות למשרות ב-60 הימים האחרונים.",
    });
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("location")
    .eq("user_id", user.id)
    .maybeSingle();
  if (profileError) {
    return jsonError("Unable to load candidate profile", 500, "PROFILE_READ_FAILED");
  }

  const messages: GmailMessage[] = [];
  for (let offset = 0; offset < ids.length; offset += MESSAGE_BATCH_SIZE) {
    const batch = ids.slice(offset, offset + MESSAGE_BATCH_SIZE);
    const settled = await Promise.allSettled(batch.map(async (id) => {
      const url = new URL(
        "https://gmail.googleapis.com/gmail/v1/users/me/messages/" + encodeURIComponent(id),
      );
      url.searchParams.set("format", "metadata");
      url.searchParams.append("metadataHeaders", "Subject");
      url.searchParams.append("metadataHeaders", "From");
      url.searchParams.append("metadataHeaders", "Date");
      const response = await fetch(url, {
        headers: { Authorization: "Bearer " + accessToken },
        cache: "no-store",
        signal: AbortSignal.timeout(MESSAGE_TIMEOUT_MS),
      });
      if (!response.ok) return null;
      const messageBody: unknown = await response.json().catch(() => null);
      const parsedMessage = gmailMessageSchema.safeParse(messageBody);
      return parsedMessage.success && parsedMessage.data.id === id ? parsedMessage.data : null;
    }));
    for (const result of settled) {
      if (result.status === "fulfilled" && result.value) messages.push(result.value);
    }
  }

  if (messages.length === 0) {
    return jsonError("לא ניתן לקרוא את הודעות Gmail כרגע.", 502, "GMAIL_MESSAGES_UNAVAILABLE");
  }

  const matches: Array<{
    user_id: string;
    source: string;
    source_url: string;
    application_url: string;
    company_name: string;
    title: string;
    description: string;
    location: string | null;
    raw_metadata: { gmail_message_id: string; imported_from_email: boolean };
  }> = [];

  for (const message of messages) {
    const subject = headerValue(message, "Subject") ?? "הודעה בנושא משרה";
    const from = headerValue(message, "From") ?? "מקור אימייל";
    const snippet = cleanText(message.snippet ?? "", 4000);
    if (!/(job|jobs|career|position|application|interview|hiring|משרה|דרושים|מועמדות|ראיון|גיוס)/i.test(subject + " " + snippet)) {
      continue;
    }
    const messageUrl = "https://mail.google.com/mail/u/0/#all/" + encodeURIComponent(message.id);
    matches.push({
      user_id: user.id,
      source: "gmail",
      source_url: messageUrl,
      application_url: messageUrl,
      company_name: from.slice(0, 180),
      title: subject.slice(0, 180),
      description: snippet,
      location: profile?.location ?? null,
      raw_metadata: { gmail_message_id: message.id, imported_from_email: true },
    });
  }

  if (!matches.length) {
    return NextResponse.json({
      found: 0,
      inserted: 0,
      message: "לא נמצאו הודעות שנראות קשורות למשרות ב-60 הימים האחרונים.",
    });
  }

  const urls = matches.map((item) => item.source_url);
  const { data: existing, error: existingError } = await supabase
    .from("jobs")
    .select("source_url")
    .eq("user_id", user.id)
    .in("source_url", urls);

  if (existingError) {
    return jsonError("Unable to check existing Gmail jobs", 500, "GMAIL_DEDUPE_FAILED");
  }

  const known = new Set((existing ?? []).map((item) => item.source_url));
  const fresh = matches.filter((item) => !known.has(item.source_url));
  if (fresh.length > 0) {
    const { error: insertError } = await supabase.from("jobs").insert(fresh);
    if (insertError) {
      return jsonError("נמצאו הודעות אך שמירתן נכשלה.", 500, "GMAIL_SAVE_FAILED");
    }
  }

  return NextResponse.json({
    found: matches.length,
    inserted: fresh.length,
    skipped: ids.length - messages.length,
    message: `נמצאו ${matches.length} הודעות רלוונטיות; ${fresh.length} חדשות נוספו למעקב.`,
  });
}
