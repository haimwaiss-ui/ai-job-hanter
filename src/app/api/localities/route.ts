import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const revalidate = 86400;

type Locality = { name: string; code: string; district?: string };

async function loadLocalities(): Promise<Locality[]> {
  const packageResponse = await fetch("https://data.gov.il/api/3/action/package_show?id=citiesandsettelments", { next: { revalidate: 86400 } });
  if (!packageResponse.ok) throw new Error("localities_source_unavailable");
  const packageJson = await packageResponse.json();
  const resources = packageJson?.result?.resources ?? [];
  const resource = resources.find((x: any) => x.datastore_active && /english|כותרות באנגלית/i.test(String(x.name ?? x.description ?? "")))
    ?? resources.find((x: any) => x.datastore_active);
  if (!resource?.id) throw new Error("localities_resource_missing");
  const dataResponse = await fetch(`https://data.gov.il/api/3/action/datastore_search?resource_id=${encodeURIComponent(resource.id)}&limit=5000`, { next: { revalidate: 86400 } });
  if (!dataResponse.ok) throw new Error("localities_data_unavailable");
  const data = await dataResponse.json();
  const records = data?.result?.records ?? [];
  return records.map((row: any) => ({
    name: String(row.city_name_he ?? row.Name_Hebrew ?? row["שם_ישוב"] ?? row["שם יישוב"] ?? row.name ?? "").trim(),
    code: String(row.city_code ?? row.Code ?? row["סמל_ישוב"] ?? row._id ?? "").trim(),
    district: String(row.region_name ?? row.District ?? row["שם מחוז"] ?? row["שם_נפה"] ?? "").trim(),
  })).filter((x: Locality) => x.name && x.code);
}

export async function GET(request: Request) {
  const query = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  const exact = new URL(request.url).searchParams.get("exact")?.trim() ?? "";
  if (!query && !exact) return NextResponse.json({ localities: [] });
  if ((query || exact).length > 80) return NextResponse.json({ error: "Search query too long" }, { status: 400 });
  try {
    const localities = await loadLocalities();
    if (exact) {
      const found = localities.find(x => x.name === exact);
      return NextResponse.json({ valid: Boolean(found), locality: found ?? null });
    }
    const normalized = query.toLocaleLowerCase("he");
    const matches = localities.filter(x => x.name.toLocaleLowerCase("he").includes(normalized)).slice(0, 30);
    return NextResponse.json({ localities: matches });
  } catch {
    return NextResponse.json({ error: "לא ניתן לטעון כרגע את מאגר היישובים הרשמי" }, { status: 503 });
  }
}
