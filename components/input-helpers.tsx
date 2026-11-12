"use client";
import { useEffect } from "react";

// Campos numericos: teclado com virgula no celular e a rolagem do mouse nao muda o valor.
export function InputHelpers() {
  useEffect(() => {
    const onFocus = (e: FocusEvent) => {
      const el = e.target as HTMLInputElement | null;
      if (el?.tagName === "INPUT" && el.type === "number" && !el.hasAttribute("inputmode")) {
        el.setAttribute("inputmode", el.step && !/[.,]/.test(el.step) && el.step !== "any" ? "numeric" : "decimal");
      }
    };
    const onWheel = (e: WheelEvent) => {
      const el = document.activeElement as HTMLInputElement | null;
      if (el?.tagName === "INPUT" && el.type === "number" && e.target === el) el.blur();
    };
    // Esc fecha a janela aberta (clica no fundo escuro, como o toque fora).
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      const overlays = Array.from(document.querySelectorAll<HTMLElement>(".fixed.inset-0")).filter((el) => el.offsetParent !== null || getComputedStyle(el).position === "fixed");
      const top = overlays.at(-1);
      if (!top) return;
      const backdrop = top.querySelector<HTMLElement>(":scope > button.absolute.inset-0");
      (backdrop ?? top).click();
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("focusin", onFocus);
    document.addEventListener("wheel", onWheel, { passive: true });
    return () => { document.removeEventListener("keydown", onKey); document.removeEventListener("focusin", onFocus); document.removeEventListener("wheel", onWheel); };
  }, []);
  return null;
}
