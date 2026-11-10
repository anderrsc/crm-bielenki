"use client";

import { useEffect, useRef, useTransition, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";

/** Server-backed lists keep their filters and search the whole dataset as you type. */
export function LiveSearchForm({ children, className, action, query = "", delay = 300 }: {
  children: ReactNode; className?: string; action?: string; query?: string; delay?: number;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const form = useRef<HTMLFormElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const composing = useRef(false);
  const [pending, startTransition] = useTransition();
  const cancel = () => { if (timer.current !== null) clearTimeout(timer.current); timer.current = null; };

  useEffect(() => {
    // Also handles back/forward without replacing the field while someone types.
    const sync = () => {
      cancel();
      const input = form.current?.elements.namedItem("q") as HTMLInputElement | null;
      if (input) input.value = !action || action === window.location.pathname ? new URLSearchParams(window.location.search).get("q") ?? "" : "";
    };
    window.addEventListener("popstate", sync);
    return () => { cancel(); window.removeEventListener("popstate", sync); };
  }, [pathname, action]);

  useEffect(() => {
    const input = form.current?.elements.namedItem("q") as HTMLInputElement | null;
    if (input && document.activeElement !== input) input.value = query;
  }, [query, pathname]);

  const search = () => {
    cancel();
    if (!form.current || composing.current) return;
    const target = action ?? pathname;
    const params = target === pathname ? new URLSearchParams(window.location.search) : new URLSearchParams();
    for (const [key, value] of new FormData(form.current)) {
      if (typeof value !== "string") continue;
      if (value.trim()) params.set(key, value.trim()); else params.delete(key);
    }
    // A new term starts at the first page, retaining tabs and status filters.
    for (const key of ["pagina", "page", "erro", "salvo", "criado"]) params.delete(key);
    const href = target + (params.size ? `?${params}` : "");
    if (href === window.location.pathname + window.location.search) return;
    startTransition(() => router.replace(href, { scroll: false }));
  };
  const schedule = () => { cancel(); if (!composing.current) timer.current = setTimeout(search, delay); };

  return <form ref={form} action={action} className={className} role="search" aria-busy={pending}
    onChange={event => { if (event.target instanceof HTMLInputElement && event.target.name === "q") schedule(); }}
    onCompositionStart={() => { composing.current = true; cancel(); }}
    onCompositionEnd={() => { composing.current = false; schedule(); }}
    onSubmit={event => { event.preventDefault(); search(); }}>
    {children}
    <span className="sr-only" role="status" aria-live="polite">{pending ? "Buscando..." : ""}</span>
  </form>;
}
