import { isIP } from "node:net";
import {
  tavilySearchResponseSchema,
  type TavilySearchResult,
} from "@/lib/validation/job-hunter";

export type JobSearchGroupId = "job_boards" | "linkedin" | "facebook" | "x" | "web";

export interface JobSearchGroup {
  id: JobSearchGroupId;
  label: string;
  querySuffix: string;
  includeDomains?: string[];
}

export const JOB_SEARCH_GROUPS: JobSearchGroup[] = [
  {
    id: "job_boards",
    label: "אתרי דרושים",
    querySuffix: "משרות דרושים careers jobs hiring",
    includeDomains: [
      "alljobs.co.il", "drushim.co.il", "jobmaster.co.il", "jobnet.co.il",
      "jobinfo.co.il", "jobkarov.com", "comeet.com", "jobs.lever.co",
      "boards.greenhouse.io", "jobs.workable.com",
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

function isPrivateAddress(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  const version = isIP(host);
  if (version === 4) {
    const octets = host.split(".").map(Number);
    const [a, b] = octets;
    return a === 0 || a === 10 || a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127) ||
      a >= 224;
  }
  if (version === 6) {
    return host === "::" || host === "::1" ||
      /^f[cd]/.test(host) || /^fe[89ab]/.test(host) ||
      /^ff/.test(host) || host.startsWith("::ffff:");
  }
  return host === "localhost" || host.endsWith(".localhost") ||
    host.endsWith(".local") || host.endsWith(".internal") ||
    host.endsWith(".home.arpa");
}

/** Normalize provider URLs; external result URLs are data, never fetch instructions. */
export function normalizeJobUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (
      (url.protocol !== "https:" && url.protocol !== "http:") ||
      url.username || url.password || isPrivateAddress(url.hostname)
    ) return null;

    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_|fbclid$|gclid$|mc_cid$|mc_eid$)/i.test(key)) {
        url.searchParams.delete(key);
      }
    }
    return url.toString();
  } catch {
    return null;
  }
}

export async function searchTavilyGroup(
  apiKey: string,
  group: JobSearchGroup,
  baseQuery: string,
  signal?: AbortSignal,
  fetcher: typeof fetch = fetch,
): Promise<{ group: JobSearchGroup; results: TavilySearchResult[]; error?: number }> {
  const timeoutSignal = AbortSignal.timeout(12_000);
  const requestSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
  const response = await fetcher("https://api.tavily.com/search", {
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
    signal: requestSignal,
  });

  if (!response.ok) return { group, results: [], error: response.status };
  const body: unknown = await response.json().catch(() => null);
  const parsed = tavilySearchResponseSchema.safeParse(body);
  if (!parsed.success) return { group, results: [], error: 502 };
  return { group, results: parsed.data.results };
}
