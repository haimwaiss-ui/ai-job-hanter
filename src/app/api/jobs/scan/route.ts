import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { hasJsonContentType, isSameOriginMutation, contentLengthExceeds, MAX_JSON_BODY_BYTES } from "@/lib/http/request-guards";

export const runtime = "nodejs";
export const maxDuration = 30;

type SearchResult = { title?: string; url?: string; content?: string; score?: number; published_date?: string };

export async function POST(request: Request) {
  if (!isSameOriginMutation(request)) return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  if (!hasJsonContentType(request)) return NextResponse.json({ error: "Expected application/json" }, { status: 415 });
  if (contentLengthExceeds(request, MAX_JSON_BODY_BYTES)) return NextResponse.json({ error: "Request body too large" }, { status: 413 });

  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "מנוע חיפוש המשרות עדיין לא חובר. נדרש להגדיר TAVILY_API_KEY בסביבת Vercel לפני הפעלת סריקה חיה." }, { status: 503 });

  const { data: profile } = await supabase.from("profiles").select("headline,location,skills").eq("user_id", user.id).maybeSingle();
  const body = await request.json().catch(() => ({})) as { query?: string };
  const query = [body.query, profile?.headline, ...(profile?.skills ?? []), profile?.location, "משרות דרושים jobs hiring"].filter(Boolean).join(" ").slice(0, 500);
  if (!query.trim()) return NextResponse.json({ error: "השלם תפקיד מבוקש או מיומנויות בפרופיל לפני סריקה." }, { status: 422 });

  const searchResponse = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: apiKey,
      query,
      search_depth: "advanced",
      topic: "general",
      max_results: 20,
      include_answer: false,
      include_raw_content: false,
      include_domains: ["alljobs.co.il", "drushim.co.il", "jobmaster.co.il", "linkedin.com/jobs", "glassdoor.com", "indeed.com"],
    }),
    cache: "no-store",
  });
  if (!searchResponse.ok) {
    console.error("job_search_provider_failed", searchResponse.status);
    return NextResponse.json({ error: "ספק חיפוש המשרות החזיר שגיאה. בדוק את מפתח החיפוש וההרשאות." }, { status: 502 });
  }
  const searchData = await searchResponse.json();
  const results: SearchResult[] = (searchData.results ?? []).filter((x: SearchResult) => x.url && x.title);
  if (!results.length) return NextResponse.json({ jobs: [], found: 0, inserted: 0, message: "לא נמצאו תוצאות רלוונטיות בחיפוש הזה." });

  const urls = results.map(x => x.url as string);
  const { data: existing } = await supabase.from("jobs").select("source_url").eq("user_id", user.id).in("source_url", urls);
  const known = new Set((existing ?? []).map(x => x.source_url));
  const fresh = results.filter(x => x.url && !known.has(x.url));
  const rows = fresh.map(x => {
    let company = "מעסיק לא מזוהה";
    try { company = new URL(x.url as string).hostname.replace(/^www\./, ""); } catch {}
    return {
      user_id: user.id,
      source: "web_search",
      source_url: x.url as string,
      application_url: x.url as string,
      company_name: company,
      title: (x.title ?? "משרה").slice(0, 180),
      description: (x.content ?? "").slice(0, 5000),
      location: profile?.location ?? null,
      raw_metadata: { search_provider: "tavily", relevance_score: x.score ?? null, published_date: x.published_date ?? null },
      scraped_at: new Date().toISOString(),
    };
  });
  let inserted: any[] = [];
  if (rows.length) {
    const { data, error } = await supabase.from("jobs").insert(rows).select("*");
    if (error) {
      console.error("job_search_save_failed", error.code);
      return NextResponse.json({ error: "החיפוש הצליח אך שמירת התוצאות נכשלה." }, { status: 500 });
    }
    inserted = data ?? [];
  }
  const { error: eventError } = await supabase.from("user_activity_events").insert({ user_id: user.id, event_type: "scan_requested", payload: { provider: "tavily", found: results.length, inserted: inserted.length } });
  if (eventError) console.warn("job_scan_event_write_failed");
  return NextResponse.json({ jobs: inserted, found: results.length, inserted: inserted.length, message: `נמצאו ${results.length} תוצאות; ${inserted.length} משרות חדשות נשמרו.` });
}
