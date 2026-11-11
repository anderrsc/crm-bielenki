// Smoke test do CRM Bielenki.
// Faz login via Supabase Auth, visita todas as rotas do menu na URL informada
// e falha (exit code 1) se encontrar status != 200 ou um dos textos de erro conhecidos.
//
// Variaveis de ambiente necessarias:
//   SMOKE_TEST_BASE_URL          - ex: https://crm-bielenki.vercel.app
//   SMOKE_TEST_SUPABASE_URL      - URL do projeto Supabase (NEXT_PUBLIC_SUPABASE_URL)
//   SMOKE_TEST_SUPABASE_ANON_KEY - chave anonima (NEXT_PUBLIC_SUPABASE_ANON_KEY)
//   SMOKE_TEST_EMAIL             - e-mail de um usuario de teste ja cadastrado no Supabase Auth
//   SMOKE_TEST_PASSWORD          - senha desse usuario
//
// Uso local:
//   node scripts/smoke-test.mjs

import { createServerClient } from "@supabase/ssr";
import { pathToFileURL } from "node:url";

import inventory from "./route-inventory.json" with { type: "json" };
export const ROUTES = inventory.routes;
export const ERROR_SIGNATURES = inventory.errorSignatures;

export async function login(env = process.env) {
  // Let the installed SSR client encode and chunk the auth cookies. The old
  // access/refresh token array is incompatible with current @supabase/ssr.
  const jar = new Map();
  const db = createServerClient(env.SMOKE_TEST_SUPABASE_URL, env.SMOKE_TEST_SUPABASE_ANON_KEY, {
    cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: values => values.forEach(({ name, value }) => jar.set(name, value)),
    },
  });
  // Secrets pasted into GitHub often carry a trailing space or newline, which
  // Supabase rejects as invalid_credentials.
  const { error } = await db.auth.signInWithPassword({ email: env.SMOKE_TEST_EMAIL.trim(), password: env.SMOKE_TEST_PASSWORD });
  if (error) throw new Error(`Falha ao autenticar no Supabase: ${error.message}`);
  return [...jar].map(([name, value]) => `${name}=${encodeURIComponent(value)}`).join("; ");
}

export async function checkRoute(cookie, path, baseUrl = process.env.SMOKE_TEST_BASE_URL, fetcher = fetch) {
    const url = `${baseUrl}${path}`;
    let response;
    try {
          response = await fetcher(url, {
                  headers: { Cookie: cookie },
                  redirect: "manual",
                  signal: AbortSignal.timeout(20000),
          });
    } catch (err) {
          return { path, ok: false, reason: `Erro de rede: ${err.message}` };
    }

  if (response.status !== 200) {
    return { path, ok: false, reason: `Status HTTP ${response.status}; destino: ${response.headers.get("location") ?? "—"}` };
  }

  const body = await response.text();
    const matchedSignature = ERROR_SIGNATURES.find((signature) => body.includes(signature));
    if (matchedSignature) {
          return { path, ok: false, reason: `Texto de erro encontrado na pagina: "${matchedSignature}"` };
    }

  return { path, ok: true };
}

export async function main() {
    for (const key of ["SMOKE_TEST_BASE_URL","SMOKE_TEST_SUPABASE_URL","SMOKE_TEST_SUPABASE_ANON_KEY","SMOKE_TEST_EMAIL","SMOKE_TEST_PASSWORD"]) {
      if (!process.env[key]) throw new Error(`Faltou configurar ${key}`);
    }
    console.log(`Smoke test iniciando contra ${process.env.SMOKE_TEST_BASE_URL}`);
    const cookie = await login();

  const results = [];
    for (const path of ROUTES) {
          const result = await checkRoute(cookie, path);
          results.push(result);
          console.log(`${result.ok ? "OK  " : "FAIL"} ${path}${result.ok ? "" : ` - ${result.reason}`}`);
    }

  const failures = results.filter((result) => !result.ok);
    console.log("");
    console.log(`${results.length - failures.length}/${results.length} rotas OK.`);

  if (failures.length > 0) {
        console.error(`\n${failures.length} rota(s) com falha:`);
        failures.forEach((failure) => console.error(`  - ${failure.path}: ${failure.reason}`));
        process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch((err) => {
    console.error("Smoke test falhou com erro inesperado:", err);
    process.exit(1);
});
