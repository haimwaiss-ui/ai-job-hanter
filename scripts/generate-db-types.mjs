import { loadEnvConfig } from "@next/env";
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

loadEnvConfig(process.cwd());

function projectRefFromEnvironment() {
  if (process.env.SUPABASE_PROJECT_ID?.trim()) return process.env.SUPABASE_PROJECT_ID.trim();
  const rawUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!rawUrl) return null;
  try {
    const host = new URL(rawUrl).hostname;
    return host.endsWith(".supabase.co") ? host.split(".")[0] : null;
  } catch {
    return null;
  }
}

const projectRef = projectRefFromEnvironment();
if (!projectRef || !/^[a-z0-9]{20}$/i.test(projectRef)) {
  console.error("Set SUPABASE_PROJECT_ID or a standard NEXT_PUBLIC_SUPABASE_URL before generating database types.");
  process.exit(1);
}

const command = process.platform === "win32" ? "npx.cmd" : "npx";
const result = spawnSync(
  command,
  ["--yes", "supabase", "gen", "types", "typescript", "--project-id", projectRef, "--schema", "public"],
  { encoding: "utf8", maxBuffer: 20 * 1024 * 1024, shell: process.platform === "win32" },
);

if (result.error || result.status !== 0 || !result.stdout?.includes("export type Database")) {
  if (result.stderr) process.stderr.write(result.stderr);
  console.error("Supabase type generation failed. Authenticate with supabase login or SUPABASE_ACCESS_TOKEN, then retry.");
  process.exit(1);
}

writeFileSync(resolve("src/lib/supabase/database.types.ts"), result.stdout, "utf8");
console.info("Updated src/lib/supabase/database.types.ts from the selected Supabase project.");
