"use client";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";

// Barra fina no topo enquanto a proxima tela carrega: o clique da retorno na hora.
export function NavProgress() {
  const pathname = usePathname();
  const search = useSearchParams();
  const [active, setActive] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as HTMLElement | null)?.closest?.("a");
      if (!a || a.target === "_blank" || a.hasAttribute("download")) return;
      const href = a.getAttribute("href");
      if (!href || href.startsWith("#") || /^(mailto|tel|https?):/i.test(href) && !href.startsWith(window.location.origin)) return;
      const url = new URL(href, window.location.href);
      if (url.origin !== window.location.origin || url.pathname.startsWith("/api/")) return;
      if (url.pathname === window.location.pathname && url.search === window.location.search) return;
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setActive(true), 80);
    };
    const onSubmit = () => { clearTimeout(timer.current); timer.current = setTimeout(() => setActive(true), 150); };
    document.addEventListener("click", onClick, true);
    document.addEventListener("submit", onSubmit, true);
    return () => { document.removeEventListener("click", onClick, true); document.removeEventListener("submit", onSubmit, true); };
  }, []);

  useEffect(() => { clearTimeout(timer.current); setActive(false); }, [pathname, search]);
  // Seguranca: nunca fica presa (ex.: acao que nao muda de tela).
  useEffect(() => { if (!active) return; const t = setTimeout(() => setActive(false), 12000); return () => clearTimeout(t); }, [active]);

  return <div aria-hidden className={`nav-progress${active ? " is-active" : ""}`} />;
}
