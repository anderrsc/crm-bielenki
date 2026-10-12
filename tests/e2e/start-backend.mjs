// Sobe o fake Supabase e cria o usuario administrador de teste com empresa.
// Uso: DATABASE_URL=... POSTGREST_URL=... node tests/e2e/start-backend.mjs
import { startFakeSupabase, ANON_KEY, SERVICE_ROLE_KEY } from "./fake-supabase.mjs";

export const ADMIN = { email: "admin@teste.local", password: "senha-de-teste-123", name: "Admin Teste" };

export async function startBackend({ port = 54321 } = {}) {
  const sb = await startFakeSupabase({
    port,
    databaseUrl: process.env.DATABASE_URL ?? "postgres://postgres@localhost:5499/crm",
    postgrestUrl: process.env.POSTGREST_URL ?? "http://localhost:54330",
  });
  const existing = (await sb.pool.query("select id from auth.users where email=$1", [ADMIN.email])).rows[0];
  if (!existing) {
    const user = await sb.createUser({ email: ADMIN.email, password: ADMIN.password, user_metadata: { full_name: ADMIN.name } });
    const client = await sb.pool.connect();
    try {
      await client.query("begin");
      await client.query("select set_config('request.jwt.claim.sub',$1,true)", [user.id]);
      await client.query("select public.bootstrap_company('Empresa Teste','00.000.000/0001-00',$1)", [user.id]);
      await client.query("commit");
    } finally { client.release(); }
  }
  return { sb, anonKey: ANON_KEY, serviceRoleKey: SERVICE_ROLE_KEY };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { sb } = await startBackend();
  console.log(`fake supabase em ${sb.url}`);
  console.log(`ANON_KEY=${ANON_KEY}`);
  console.log(`SERVICE_ROLE_KEY=${SERVICE_ROLE_KEY}`);
}
