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

const BASE_URL = process.env.SMOKE_TEST_BASE_URL;
const SUPABASE_URL = process.env.SMOKE_TEST_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SMOKE_TEST_SUPABASE_ANON_KEY;
const EMAIL = process.env.SMOKE_TEST_EMAIL;
const PASSWORD = process.env.SMOKE_TEST_PASSWORD;

const REQUIRED_VARS = {
    SMOKE_TEST_BASE_URL: BASE_URL,
    SMOKE_TEST_SUPABASE_URL: SUPABASE_URL,
    SMOKE_TEST_SUPABASE_ANON_KEY: SUPABASE_ANON_KEY,
    SMOKE_TEST_EMAIL: EMAIL,
    SMOKE_TEST_PASSWORD: PASSWORD,
};

for (const [key, value] of Object.entries(REQUIRED_VARS)) {
    if (!value) {
          console.error(`Faltou configurar a variavel de ambiente ${key}.`);
          process.exit(1);
    }
}

// Todas as rotas visiveis no menu principal do CRM.
// Mantenha esta lista alinhada com app/(crm)/layout.tsx sempre que um modulo for adicionado ou removido.
const ROUTES = [
    "/dashboard",
    "/pipeline",
    "/busca",
    "/clientes",
    "/orcamentos",
    "/vendas",
    "/pedidos",
    "/compras",
    "/fornecedores",
    "/estoque",
    "/producao",
    "/producao/materiais-do-pedido",
    "/instalacoes",
    "/financeiro",
    "/automacoes",
    "/relatorios",
    "/configuracoes",
  ];

// Textos que indicam erro mesmo quando o status HTTP retornado e 200
// (Server Components do Next.js podem renderizar paginas de erro com status 200,
// e o catch-all do CRM usa notFound()/mensagens proprias para erros de dados).
const ERROR_SIGNATURES = [
    "Application error",
    "a server-side exception has occurred",
    "invalid input syntax for type uuid",
    "RangeError",
    "Internal Server Error",
  ];

async function login() {
    const response = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
          method: "POST",
          headers: {
                  "Content-Type": "application/json",
                  apikey: SUPABASE_ANON_KEY,
          },
          body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
    });

  if (!response.ok) {
        const body = await response.text();
        throw new Error(`Falha ao autenticar no Supabase (status ${response.status}): ${body}`);
  }

  return response.json();
}

// O CRM usa @supabase/ssr, que guarda a sessao em um cookie chamado
// sb-<project-ref>-auth-token contendo um JSON com o access/refresh token.
function buildAuthCookie(session) {
    const projectRef = new URL(SUPABASE_URL).hostname.split(".")[0];
    const cookieValue = encodeURIComponent(
          JSON.stringify([session.access_token, session.refresh_token, null, null, null])
        );
    return `sb-${projectRef}-auth-token=${cookieValue}`;
}

async function checkRoute(cookie, path) {
    const url = `${BASE_URL}${path}`;
    let response;
    try {
          response = await fetch(url, {
                  headers: { Cookie: cookie },
                  redirect: "manual",
          });
    } catch (err) {
          return { path, ok: false, reason: `Erro de rede: ${err.message}` };
    }

  if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location") ?? "";
        if (location.includes("/login")) {
                return { path, ok: false, reason: "Sessao nao autenticada (redirecionado para /login)" };
        }
  }

  if (response.status >= 400) {
        return { path, ok: false, reason: `Status HTTP ${response.status}` };
  }

  const body = await response.text();
    const matchedSignature = ERROR_SIGNATURES.find((signature) => body.includes(signature));
    if (matchedSignature) {
          return { path, ok: false, reason: `Texto de erro encontrado na pagina: "${matchedSignature}"` };
    }

  return { path, ok: true };
}

async function main() {
    console.log(`Smoke test iniciando contra ${BASE_URL}`);
    const session = await login();
    const cookie = buildAuthCookie(session);

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

main().catch((err) => {
    console.error("Smoke test falhou com erro inesperado:", err);
    process.exit(1);
});
