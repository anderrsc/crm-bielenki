// Gateway minimo que imita a API do Supabase para os testes de ponta a ponta:
//   /rest/v1/*    -> PostgREST de verdade (mesmo motor do Supabase)
//   /auth/v1/*    -> login por senha, getUser, logout, admin.createUser
//   /storage/v1/* -> upload/download de objetos em memoria
// Os JWTs sao HS256 assinados com JWT_SECRET (o mesmo configurado no PostgREST).
import http from "node:http";
import crypto from "node:crypto";
import pg from "pg";

export const JWT_SECRET = "crm-bielenki-test-secret-com-pelo-menos-32-caracteres";

const b64url = (buf) => Buffer.from(buf).toString("base64url");

export function signJwt(payload) {
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = b64url(JSON.stringify(payload));
  const sig = crypto.createHmac("sha256", JWT_SECRET).update(`${header}.${body}`).digest("base64url");
  return `${header}.${body}.${sig}`;
}

export function verifyJwt(token) {
  const [h, b, s] = String(token || "").split(".");
  if (!h || !b || !s) return null;
  const expected = crypto.createHmac("sha256", JWT_SECRET).update(`${h}.${b}`).digest("base64url");
  if (expected !== s) return null;
  const payload = JSON.parse(Buffer.from(b, "base64url").toString());
  if (payload.exp && payload.exp < Date.now() / 1000) return null;
  return payload;
}

const far = () => Math.floor(Date.now() / 1000) + 10 * 365 * 24 * 3600;
export const ANON_KEY = signJwt({ role: "anon", iss: "supabase", exp: far() });
export const SERVICE_ROLE_KEY = signJwt({ role: "service_role", iss: "supabase", exp: far() });

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
  });
}

function json(res, status, data) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(data));
}

export async function startFakeSupabase({ port, databaseUrl, postgrestUrl }) {
  const pool = new pg.Pool({ connectionString: databaseUrl });
  const refreshTokens = new Map(); // token -> user id
  const objects = new Map(); // "bucket/path" -> { type, body }

  async function loadUser(id) {
    const { rows } = await pool.query("select * from auth.users where id=$1", [id]);
    return rows[0] ? toUser(rows[0]) : null;
  }
  function toUser(row) {
    return {
      id: row.id, aud: "authenticated", role: "authenticated", email: row.email,
      email_confirmed_at: row.created_at, app_metadata: row.raw_app_meta_data, user_metadata: row.raw_user_meta_data,
      created_at: row.created_at, updated_at: row.updated_at,
    };
  }
  function session(user) {
    const expiresIn = 3600;
    const refresh = crypto.randomUUID();
    refreshTokens.set(refresh, user.id);
    return {
      access_token: signJwt({ sub: user.id, role: "authenticated", aud: "authenticated", email: user.email, exp: Math.floor(Date.now() / 1000) + expiresIn }),
      token_type: "bearer", expires_in: expiresIn, expires_at: Math.floor(Date.now() / 1000) + expiresIn,
      refresh_token: refresh, user,
    };
  }

  async function createUser({ email, password, user_metadata = {}, app_metadata = {} }) {
    const { rows } = await pool.query(
      "insert into auth.users(email, encrypted_password, raw_user_meta_data, raw_app_meta_data) values($1,$2,$3,$4) returning *",
      [email, password, user_metadata, app_metadata]
    );
    return toUser(rows[0]);
  }

  function bearer(req) {
    const auth = req.headers.authorization || "";
    return verifyJwt(auth.replace(/^Bearer\s+/i, "")) ?? verifyJwt(req.headers.apikey);
  }

  async function handleAuth(req, res, url, body) {
    const path = url.pathname.replace("/auth/v1", "");
    if (path === "/token") {
      const data = JSON.parse(body.toString() || "{}");
      if (url.searchParams.get("grant_type") === "password") {
        const { rows } = await pool.query("select * from auth.users where email=$1", [data.email]);
        if (!rows[0] || rows[0].encrypted_password !== data.password) {
          return json(res, 400, { code: 400, error_code: "invalid_credentials", msg: "Invalid login credentials" });
        }
        return json(res, 200, session(toUser(rows[0])));
      }
      const id = refreshTokens.get(data.refresh_token);
      const user = id && (await loadUser(id));
      if (!user) return json(res, 400, { code: 400, error_code: "refresh_token_not_found", msg: "Invalid Refresh Token" });
      return json(res, 200, session(user));
    }
    if (path === "/user") {
      const claims = bearer(req);
      const user = claims?.sub && (await loadUser(claims.sub));
      if (!user) return json(res, 401, { code: 401, error_code: "bad_jwt", msg: "invalid JWT" });
      return json(res, 200, user);
    }
    if (path === "/logout") { res.writeHead(204); return res.end(); }
    if (path === "/recover") return json(res, 200, {});
    if (path === "/admin/users" && req.method === "POST") {
      if (bearer(req)?.role !== "service_role") return json(res, 403, { msg: "forbidden" });
      const data = JSON.parse(body.toString() || "{}");
      return json(res, 200, await createUser(data));
    }
    const adminUser = path.match(/^\/admin\/users\/([0-9a-f-]+)$/);
    if (adminUser && req.method === "GET") {
      const user = await loadUser(adminUser[1]);
      return user ? json(res, 200, user) : json(res, 404, { msg: "User not found" });
    }
    return json(res, 404, { msg: `fake auth: rota nao implementada ${req.method} ${path}` });
  }

  function handleStorage(req, res, url, body) {
    const path = decodeURIComponent(url.pathname.replace("/storage/v1", ""));
    const pub = path.match(/^\/object\/public\/(.+)$/);
    const obj = path.match(/^\/object\/(?:authenticated\/)?(.+)$/);
    const key = pub?.[1] ?? obj?.[1];
    if (!key) return json(res, 404, { message: "not found" });
    if (req.method === "GET") {
      const file = objects.get(key);
      if (!file) return json(res, 404, { statusCode: "404", error: "not_found", message: "Object not found" });
      res.writeHead(200, { "content-type": file.type });
      return res.end(file.body);
    }
    if (req.method === "POST" || req.method === "PUT") {
      if (!bearer(req)) return json(res, 403, { message: "unauthorized" });
      objects.set(key, { type: req.headers["content-type"] || "application/octet-stream", body });
      return json(res, 200, { Key: key, Id: crypto.randomUUID() });
    }
    if (req.method === "DELETE") { objects.delete(key); return json(res, 200, {}); }
    return json(res, 404, { message: "not found" });
  }

  async function proxyRest(req, res, url, body) {
    const target = new URL(url.pathname.replace("/rest/v1", "") + url.search, postgrestUrl);
    const headers = { ...req.headers };
    delete headers.host;
    delete headers["content-length"];
    if (!headers.authorization && headers.apikey) headers.authorization = `Bearer ${headers.apikey}`;
    const upstream = await fetch(target, { method: req.method, headers, body: ["GET", "HEAD"].includes(req.method) ? undefined : body });
    const out = Buffer.from(await upstream.arrayBuffer());
    const resHeaders = {};
    upstream.headers.forEach((v, k) => { if (!["content-encoding", "transfer-encoding", "content-length"].includes(k)) resHeaders[k] = v; });
    res.writeHead(upstream.status, resHeaders);
    res.end(out);
  }

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://localhost:${port}`);
      const body = await readBody(req);
      if (url.pathname.startsWith("/rest/v1")) return await proxyRest(req, res, url, body);
      if (url.pathname.startsWith("/auth/v1")) return await handleAuth(req, res, url, body);
      if (url.pathname.startsWith("/storage/v1")) return handleStorage(req, res, url, body);
      json(res, 404, { msg: "fake supabase: rota desconhecida" });
    } catch (err) {
      console.error("fake supabase erro:", err);
      json(res, 500, { msg: String(err) });
    }
  });
  await new Promise((resolve) => server.listen(port, resolve));

  return {
    url: `http://localhost:${port}`,
    pool,
    objects,
    createUser,
    async stop() { server.close(); await pool.end(); },
  };
}
