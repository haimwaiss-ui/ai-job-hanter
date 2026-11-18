import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { hasJsonContentType, isSameOriginMutation, contentLengthExceeds, MAX_JSON_BODY_BYTES } from "@/lib/http/request-guards";

export const runtime = "nodejs";
export const maxDuration = 30;

type SearchResult = {
  title?: string;
  url?: string;
  content?: string;
  score?: number;
  published_date?: string;
};

type SearchGroup = {
  id: "job_boards" | "linkedin" | "facebook" | "x" | "web";
  label: string;
  querySuffix: string;
  includeDomains?: string[];
};

const SEARCH_GROUPS: SearchGroup[] = [
  {
    id: "job_boards",
    label: "אתרי דרושים",
    querySuffix: "משרות דרושים careers jobs hiring",
    includeDomains: [
      "alljobs.co.il",
      "drushim.co.il",
      "jobmaster.co.il",
      "jobnet.co.il",
      "jobinfo.co.il",
      "jobkarov.com",
      "comeet.com",
      "jobs.lever.co",
      "boards.greenhouse.io",
      "jobs.workable.com",
    ],
  },
  {
    id: "linkedin",
    label: "LinkedIn ציבורי",
    querySuffix: "משרה דרושים hiring job opening",
    includeDomains: ["linkedin.com"],
  },
  {
    id: "facebook",
    label: "Facebook ציבורי",
    querySuffix: "משרה דרושים דרושים עובדים hiring job opening",
    includeDomains: ["facebook.com"],
  },
  {
    id: "x",
    label: "X / Twitter ציבורי",
    querySuffix: "משרה דרושים hiring job opening",
    includeDomains: ["x.com", "twitter.com"],
  },
  {
    id: "web",
    label: "חיפוש רשת כללי",
    querySuffix: "משרות דרושים careers job opening hiring",
  },
];

function normalizeUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_|fbclid$|gclid$|mc_cid$|mc_eid$)/i.test(key)) url.searchParams.delete(key);
    }
    return url.toString();
  } catch {
    return null;
  }
}

async function searchGroup(
  apiKey: string,
  group: SearchGroup,
  baseQuery: string,
): Promise<{ group: SearchGroup; results: SearchResult[]; error?: number }> {
  const response = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + apiKey,
    },
    body: JSON.stringify({
      country: "Israel",
      query: [baseQuery, group.querySuffix].filter(Boolean).join(" "),
      search_depth: "advanced",
      topic: "general",
      max_results: group.id === "web" ? 12 : 10,
      include_domains: group.includeDomains,
      include_answer: false,
      include_raw_content: false,
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(12_000),
  });

  if (!response.ok) return { group, results: [], error: response.status };
  const data = await response.json() as { results?: SearchResult[] };
  return {
    group,
    results: (data.results ?? []).filter((item) => item.url && item.title),
  };
}

export async function POST(request: Request) {
  if (!isSameOriginMutation(request)) {
    return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  }
  if (!hasJsonContentType(request)) {
    return NextResponse.json({ error: "Expected application/json" }, { status: 415 });
  }
  if (contentLengthExceeds(request, MAX_JSON_BODY_BYTES)) {
    return NextResponse.json({ error: "Request body too large" }, { status: 413 });
  }

  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) {
    return NextResponse.json({
      error: "מנוע חיפוש המשרות עדיין לא הוגדר. יש להוסיף TAVILY_API_KEY ב-Vercel ולפרוס מחדש.",
      code: "JOB_SEARCH_NOT_CONFIGURED",
    }, { status: 503 });
  }

  const body = await request.json().catch(() => ({})) as { query?: unknown };
  const requestedQuery = typeof body.query === "string" ? body.query.trim().slice(0, 240) : "";
  const { data: profile } = await supabase
    .from("profiles")
    .select("headline,location,skills")
    .eq("user_id", user.id)
    .maybeSingle();

  const roleAndSkills = [
    requestedQuery,
    profile?.headline,
    ...(profile?.skills ?? []),
  ].filter((value): value is string => typeof value === "string" && value.trim().length > 0);
  if (roleAndSkills.length === 0) {
    return NextResponse.json({
      error: "הזן תפקיד או מיומנויות בפרופיל לפני הפעלת הסריקה.",
      code: "JOB_SEARCH_QUERY_REQUIRED",
    }, { status: 422 });
  }

  const baseQuery = [
    ...roleAndSkills,
    profile?.location,
    "Israel",
  ].filter(Boolean).join(" ").slice(0, 500);

  const settled = await Promise.allSettled(
    SEARCH_GROUPS.map((group) => searchGroup(apiKey, group, baseQuery)),
  );
  const completed = settled.flatMap((result) =>
    result.status === "fulfilled" ? [result.value] : [],
  );
  const failedCount = settled.length - completed.length
    + completed.filter((result) => result.error !== undefined).length;

  if (completed.length === 0 || completed.every((result) => result.results.length === 0 && result.error !== undefined)) {
    console.error("job_search_all_sources_failed", failedCount);
    return NextResponse.json({
      error: "לא ניתן לקבל תוצאות מספק החיפוש כרגע. בדוק את מפתח Tavily ואת מכסת השימוש.",
      code: "JOB_SEARCH_PROVIDER_FAILED",
    }, { status: 502 });
  }

  const candidates = completed.flatMap(({ group, results }) =>
    results.map((item) => ({
      item,
      group,
      normalizedUrl: item.url ? normalizeUrl(item.url) : null,
    })),
  ).filter((entry): entry is typeof entry & { normalizedUrl: string } => Boolean(entry.normalizedUrl));

  const unique = new Map<string, (typeof candidates)[number]>();
  for (const candidate of candidates) {
    const current = unique.get(candidate.normalizedUrl);
    if (!current || (candidate.item.score ?? 0) > (current.item.score ?? 0)) {
      unique.set(candidate.normalizedUrl, candidate);
    }
  }

  const urls = [...unique.keys()];
  const { data: existing, error: existingError } = urls.length
    ? await supabase.from("jobs").select("source_url").eq("user_id", user.id).in("source_url", urls)
    : { data: [], error: null };

  if (existingError) {
    console.error("job_search_existing_lookup_failed", existingError.code);
    return NextResponse.json({ error: "לא ניתן לבדוק כפילויות במאגר המשרות." }, { status: 500 });
  }

  const known = new Set((existing ?? []).map((item) => {
    const value = typeof item.source_url === "string" ? normalizeUrl(item.source_url) : null;
    return value;
  }).filter((value): value is string => Boolean(value)));

  const fresh = [...unique.values()].filter((entry) => !known.has(entry.normalizedUrl));
  const rows = fresh.map(({ item, group, normalizedUrl }) => {
    const hostname = new URL(normalizedUrl).hostname.replace(/^www\./, "");
    return {
      user_id: user.id,
      source: "web_search",
      source_url: normalizedUrl,
      application_url: normalizedUrl,
      company_name: hostname,
      title: (item.title ?? "משרה").slice(0, 180),
      description: (item.content ?? "").slice(0, 5000),
      location: profile?.location ?? "ישראל",
      raw_metadata: {
        search_provider: "tavily",
        source_category: group.id,
        source_label: group.label,
        relevance_score: item.score ?? null,
        published_date: item.published_date ?? null,
      },
      scraped_at: new Date().toISOString(),
    };
  });

  let inserted: Array<{ id: string; title: string; company_name: string; location: string | null; application_url: string | null; source_url: string | null; created_at: string }> = [];
  if (rows.length) {
    const { data, error } = await supabase.from("jobs").insert(rows).select("id,title,company_name,location,application_url,source_url,created_at");
    if (error) {
      console.error("job_search_save_failed", error.code);
      return NextResponse.json({
        error: "החיפוש הצליח אך שמירת המשרות נכשלה. בדוק הרשאות וטבלת jobs.",
        code: "JOB_SEARCH_SAVE_FAILED",
      }, { status: 500 });
    }
    inserted = data ?? [];
  }

  const sourceCounts = Object.fromEntries(
    SEARCH_GROUPS.map((group) => [
      group.id,
      completed.find((result) => result.group.id === group.id)?.results.length ?? 0,
    ]),
  );

  const { error: eventError } = await supabase.from("user_activity_events").insert({
    user_id: user.id,
    event_type: "scan_requested",
    payload: {
      provider: "tavily",
      found: unique.size,
      inserted: inserted.length,
      source_counts: sourceCounts,
      failed_sources: failedCount,
    },
  });
  if (eventError) console.warn("job_scan_event_write_failed");

  const found = unique.size;
  return NextResponse.json({
    jobs: inserted,
    found,
    inserted: inserted.length,
    sourceCounts,
    failedSources: failedCount,
    message: `נסרקו אתרי דרושים, LinkedIn, Facebook, X והרשת הכללית: נמצאו ${found} תוצאות ייחודיות, ${inserted.length} משרות חדשות נשמרו.`,
  });
}
