export type IsraeliLocality = { name: string; code: string; district?: string };

export async function getIsraeliLocalities(): Promise<IsraeliLocality[]> {
  const packageResponse = await fetch("https://data.gov.il/api/3/action/package_show?id=citiesandsettelments", { next: { revalidate: 86400 } });
  if (!packageResponse.ok) throw new Error("localities_source_unavailable");
  const packageJson = await packageResponse.json();
  const resources = packageJson?.result?.resources ?? [];
  const resource = resources.find((x: any) => x.datastore_active && /english|כותרות באנגלית/i.test(String(x.name ?? x.title ?? x.description ?? "")))
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
  })).filter((x: IsraeliLocality) => x.name && x.code);
}

export async function isIsraeliLocality(name: string): Promise<boolean> {
  if (!name.trim()) return false;
  const localities = await getIsraeliLocalities();
  return localities.some(x => x.name === name.trim());
}
