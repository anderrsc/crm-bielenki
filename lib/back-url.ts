// Endereco de retorno vindo de formulario: so caminho interno (evita mandar o
// usuario para outro site) e parametros acrescentados com ? ou & conforme o caso.
export function safeBack(raw: unknown, fallback: string): string {
  const s = typeof raw === "string" ? raw.trim() : "";
  return /^\/(?![/\\])[^\s\\]*$/.test(s) ? s : fallback;
}

/** "url?" ou "url&", pronto para acrescentar "erro=...". */
export function q(url: string): string {
  // Tira avisos de um envio anterior (erro=, recebido=…) para nao acumular.
  const [path, query = ""] = url.split("#")[0].split("?");
  const params = new URLSearchParams(query);
  for (const k of ["erro", "ok", "recebido", "salvo", "criado"]) params.delete(k);
  const rest = params.toString();
  return `${path}?${rest ? rest + "&" : ""}`;
}
