// Baixa uma imagem no servidor e devolve como data: URI, para que a folha de
// impressao ja venha com as imagens embutidas no HTML (o Chromium que gera o
// PDF nao precisa fazer nenhuma requisicao extra). Falha -> null.
export async function imageDataUri(url: string | null | undefined, timeoutMs = 4000): Promise<string | null> {
  if (!url) return null;
  try {
    const res = await fetch(url, { cache: "force-cache", signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return null;
    const type = res.headers.get("content-type") ?? "image/png";
    const buf = Buffer.from(await res.arrayBuffer());
    return `data:${type};base64,${buf.toString("base64")}`;
  } catch {
    return null;
  }
}
