"use client";
// Avisa antes de sair de um formulário longo (orçamento, compra) com alterações não salvas.
// Vale para <form data-warn-unsaved>. Enviar o formulário limpa o aviso.
import { useEffect } from "react";
import { confirmAction } from "@/components/ui-feedback/confirm";

export function UnsavedGuard() {
  useEffect(() => {
    let dirty = false;
    const inGuarded = (t: EventTarget | null) => (t instanceof Element ? t.closest("form[data-warn-unsaved]") : null);
    const onInput = (e: Event) => { if (inGuarded(e.target)) dirty = true; };
    const onSubmit = (e: Event) => { if (inGuarded(e.target)) dirty = false; };
    const onBeforeUnload = (e: BeforeUnloadEvent) => { if (dirty) { e.preventDefault(); e.returnValue = ""; } };
    // Links internos do menu: pergunta antes de trocar de tela.
    const onClick = (e: MouseEvent) => {
      if (!dirty || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey) return;
      const a = (e.target instanceof Element ? e.target.closest("a[href]") : null) as HTMLAnchorElement | null;
      if (!a || a.target === "_blank" || a.origin !== location.origin || a.pathname === location.pathname) return;
      e.preventDefault(); e.stopPropagation();
      void confirmAction({ title: "Sair sem salvar?", message: "Você alterou este formulário e ainda não salvou. Se sair agora, as alterações podem ser perdidas.", confirmLabel: "Sair mesmo assim", danger: false })
        .then((ok) => { if (ok) { dirty = false; location.assign(a.href); } });
    };
    document.addEventListener("input", onInput, true); document.addEventListener("change", onInput, true);
    document.addEventListener("submit", onSubmit, true); document.addEventListener("click", onClick, true);
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      document.removeEventListener("input", onInput, true); document.removeEventListener("change", onInput, true);
      document.removeEventListener("submit", onSubmit, true); document.removeEventListener("click", onClick, true);
      window.removeEventListener("beforeunload", onBeforeUnload);
    };
  }, []);
  return null;
}
