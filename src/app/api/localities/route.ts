import { NextResponse } from "next/server";
import { getIsraeliLocalities } from "@/lib/israeli-localities";

export const runtime = "nodejs";
export const revalidate = 86400;

export async function GET(request: Request) {
  const query = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  const exact = new URL(request.url).searchParams.get("exact")?.trim() ?? "";
  if (!query && !exact) return NextResponse.json({ localities: [] });
  if ((query || exact).length > 80) return NextResponse.json({ error: "Search query too long" }, { status: 400 });
  try {
    const localities = await getIsraeliLocalities();
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
