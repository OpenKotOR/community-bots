#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const projectRoot = process.cwd();
const envPath = path.join(projectRoot, ".env");

const PROVIDERS = [
  {
    name: "google",
    vars: [
      "PAZAAK_OAUTH_GOOGLE_CLIENT_ID",
      "PAZAAK_OAUTH_GOOGLE_CLIENT_SECRET",
      "PAZAAK_OAUTH_GOOGLE_CALLBACK_URL",
    ],
  },
  {
    name: "discord",
    vars: [
      "PAZAAK_OAUTH_DISCORD_CLIENT_ID",
      "PAZAAK_OAUTH_DISCORD_CLIENT_SECRET",
      "PAZAAK_OAUTH_DISCORD_CALLBACK_URL",
    ],
    fallbackVars: {
      PAZAAK_OAUTH_DISCORD_CLIENT_ID: ["PAZAAK_DISCORD_APP_ID"],
      PAZAAK_OAUTH_DISCORD_CLIENT_SECRET: ["PAZAAK_DISCORD_CLIENT_SECRET"],
    },
  },
  {
    name: "github",
    vars: [
      "PAZAAK_OAUTH_GITHUB_CLIENT_ID",
      "PAZAAK_OAUTH_GITHUB_CLIENT_SECRET",
      "PAZAAK_OAUTH_GITHUB_CALLBACK_URL",
    ],
  },
];

const parseDotEnv = (content) => {
  const out = new Map();
  for (const rawLine of content.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const eq = line.indexOf("=");
    if (eq <= 0) {
      continue;
    }

    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();

    if (
      (value.startsWith("\"") && value.endsWith("\""))
      || (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    out.set(key, value);
  }
  return out;
};

const readEnv = () => {
  if (!fs.existsSync(envPath)) {
    return new Map();
  }

  const content = fs.readFileSync(envPath, "utf8");
  return parseDotEnv(content);
};

const hasValue = (vars, key) => {
  const fromProcess = process.env[key];
  if (typeof fromProcess === "string" && fromProcess.trim().length > 0) {
    return true;
  }
  const fromEnvFile = vars.get(key);
  return typeof fromEnvFile === "string" && fromEnvFile.trim().length > 0;
};

const callbackLooksLocal = (vars, key, provider) => {
  const fallback = `http://localhost:4001/api/auth/oauth/${provider}/callback`;
  const fromProcess = process.env[key]?.trim();
  const value = (fromProcess && fromProcess.length > 0 ? fromProcess : vars.get(key) || "").trim();
  return value.length > 0 && value === fallback;
};

const checkProviderVars = (provider, vars) => {
  const missing = [];

  for (const key of provider.vars) {
    let ok = hasValue(vars, key);
    if (!ok && provider.fallbackVars?.[key]) {
      ok = provider.fallbackVars[key].some((fallback) => hasValue(vars, fallback));
    }
    if (!ok) {
      missing.push(key);
    }
  }

  return {
    missing,
    callbackLocal: callbackLooksLocal(vars, provider.vars[2], provider.name),
  };
};

const fetchProviderStatus = async () => {
  try {
    const res = await fetch("http://localhost:4001/api/auth/oauth/providers");
    if (!res.ok) {
      return { ok: false, reason: `HTTP ${res.status}` };
    }
    const json = await res.json();
    return { ok: true, data: json };
  } catch (error) {
    return { ok: false, reason: String(error) };
  }
};

const print = (line = "") => {
  process.stdout.write(`${line}\n`);
};

const main = async () => {
  const envVars = readEnv();

  print("Pazaak OAuth readiness check");
  print("===========================");
  print(`.env path: ${envPath}`);
  if (!fs.existsSync(envPath)) {
    print("WARNING: .env file not found. Only process environment variables will be checked.");
  }
  print("");

  for (const provider of PROVIDERS) {
    const { missing, callbackLocal } = checkProviderVars(provider, envVars);
    print(`[${provider.name}]`);
    print(`  required vars present: ${missing.length === 0 ? "yes" : "no"}`);
    if (missing.length > 0) {
      print(`  missing: ${missing.join(", ")}`);
    }
    print(`  callback is localhost default: ${callbackLocal ? "yes" : "no"}`);
    print("");
  }

  const status = await fetchProviderStatus();
  print("Live API status (/api/auth/oauth/providers)");
  print("-------------------------------------------");
  if (!status.ok) {
    print(`could not query local API: ${status.reason}`);
    print("Make sure corepack pnpm dev:pazaak is running and listening on http://localhost:4001");
    process.exitCode = 1;
    return;
  }

  const providers = Array.isArray(status.data?.providers) ? status.data.providers : [];
  for (const provider of providers) {
    print(`  ${provider.provider}: ${provider.enabled ? "ENABLED" : "DISABLED"}`);
  }

  const allEnabled = providers.length > 0 && providers.every((provider) => provider.enabled);
  print("");
  print(allEnabled ? "RESULT: all configured providers are enabled." : "RESULT: one or more providers are still disabled.");

  if (!allEnabled) {
    print("Next steps:");
    print("  1. Fill any missing env vars shown above");
    print("  2. Restart corepack pnpm dev:pazaak");
    print("  3. Re-run this checker");
    process.exitCode = 2;
  }
};

await main();
