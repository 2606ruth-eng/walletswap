import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

function isLegacyServiceRoleKey(value) {
  const parts = value.split(".");
  if (parts.length !== 3) return false;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    return payload.role === "service_role";
  } catch {
    return false;
  }
}

export function validateSupabaseBuildEnvironment(env) {
  const url = String(env.VITE_SUPABASE_URL || "").trim();
  const publishableKey = String(env.VITE_SUPABASE_PUBLISHABLE_KEY || "").trim();
  if (!url) throw new Error("VITE_SUPABASE_URL is missing from the GitHub Actions repository variables.");
  if (!publishableKey) throw new Error("VITE_SUPABASE_PUBLISHABLE_KEY is missing from the GitHub Actions repository variables.");
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("VITE_SUPABASE_URL must be a valid HTTPS URL.");
  }
  if (parsed.protocol !== "https:" || !parsed.hostname) {
    throw new Error("VITE_SUPABASE_URL must be a valid HTTPS URL.");
  }
  if (/^(sb_secret_|service_role)/i.test(publishableKey) || isLegacyServiceRoleKey(publishableKey)) {
    throw new Error("VITE_SUPABASE_PUBLISHABLE_KEY must be a public publishable key, not a server secret.");
  }
  return { url, publishableKey };
}

async function findFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async entry => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return findFiles(path);
    return /\.(?:html|js|mjs)$/.test(entry.name) ? [path] : [];
  }));
  return nested.flat();
}

export async function verifySupabaseBuildAssets(config, directory = "dist") {
  const files = await findFiles(directory);
  const assets = await Promise.all(files.map(path => readFile(path, "utf8")));
  const bundle = assets.join("\n");
  if (!bundle.includes(config.url) || !bundle.includes(config.publishableKey)) {
    throw new Error("The compiled app is missing its required Supabase public configuration.");
  }
  if (!bundle.includes("Ruby Live needs a cloud account")) {
    throw new Error("The compiled app is missing the Ruby experience.");
  }
  if (/sb_secret_[A-Za-z0-9_-]{12,}|service_role["':\s]+[A-Za-z0-9_-]{20,}|OPENAI_API_KEY\s*[:=]\s*["'][^"']{12,}/i.test(bundle)) {
    throw new Error("The compiled app contains a server credential pattern; refusing to package it.");
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const config = validateSupabaseBuildEnvironment(process.env);
    if (process.argv.includes("--verify-assets")) await verifySupabaseBuildAssets(config);
    console.log(process.argv.includes("--verify-assets")
      ? "Supabase client configuration is embedded in the compiled app."
      : "Required Supabase public configuration is present.");
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
