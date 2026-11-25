"use client";

import { useEffect } from "react";

// Depois de uma publicação nova, uma aba que ficou aberta ainda pede arquivos da versão
// anterior (que não existem mais no servidor) e mostra "Não foi possível carregar esta página".
// Detecta esse caso e recarrega a página uma vez, já na versão nova.
const KEY = "crm-stale-build-reload";

export function isStaleBuildError(value: unknown): boolean {
  const text = value instanceof Error ? `${value.name} ${value.message}` : String(value ?? "");
  return /ChunkLoadError|Loading chunk [\w-]+ failed|Loading CSS chunk|UnrecognizedActionError|Server Action ".*" was not found|Failed to find Server Action/i.test(text);
}

export function reloadOnceForNewBuild(): boolean {
  try {
    const last = Number(sessionStorage.getItem(KEY) || 0);
    if (Date.now() - last < 60_000) return false; // já recarregou há pouco: não entra em laço
    sessionStorage.setItem(KEY, String(Date.now()));
  } catch { /* sem storage: recarrega mesmo assim */ }
  window.location.reload();
  return true;
}

export function StaleBuildReload() {
  useEffect(() => {
    const onError = (e: ErrorEvent) => { if (isStaleBuildError(e.error ?? e.message)) reloadOnceForNewBuild(); };
    const onRejection = (e: PromiseRejectionEvent) => { if (isStaleBuildError(e.reason)) reloadOnceForNewBuild(); };
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => { window.removeEventListener("error", onError); window.removeEventListener("unhandledrejection", onRejection); };
  }, []);
  return null;
}
