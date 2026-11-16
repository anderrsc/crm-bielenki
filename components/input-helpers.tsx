"use client";
import { useEffect } from "react";
import { brazilianFieldKind, formatBrazilianPhone, formatBrazilianTaxId, formatRegistrationName, registrationTextKind } from "@/lib/brazilian-input";

// Campos numericos: teclado com virgula no celular e a rolagem do mouse nao muda o valor.
export function InputHelpers() {
  useEffect(() => {
    const previous = new WeakMap<HTMLInputElement, string>();
    const format = (el: HTMLInputElement, editing = false, inputType = "") => {
      const kind = brazilianFieldKind(el.name, el.type, el.getAttribute("aria-label") ?? "");
      const textKind = registrationTextKind(el.name, el.getAttribute("aria-label") ?? "");
      if ((!kind && (!textKind || editing)) || el.disabled || el.readOnly || el.type === "password") return;
      if (kind && el.type === "number") { el.type = kind === "phone" ? "tel" : "text"; el.inputMode = kind === "phone" ? "tel" : "numeric"; }
      const before = el.value;
      const semantic = (text: string) => text.replace(kind === "phone" ? /\D/g : /[^a-z0-9]/gi, "");
      if (inputType.startsWith("delete") && previous.has(el) && semantic(previous.get(el)!) === semantic(before)) { previous.set(el, before); return; }
      const after = kind === "phone" ? formatBrazilianPhone(before) : kind ? formatBrazilianTaxId(before, kind) : textKind === "email" ? before.trim().toLowerCase() : formatRegistrationName(before);
      previous.set(el, after);
      if (after === before) return;
      const start = el.selectionStart;
      const count = semantic(before.slice(0, start ?? before.length)).length;
      // Setter nativo mantém o onChange do React recebendo o valor formatado.
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, after);
      if (editing && start !== null) {
        let index = 0, seen = 0;
        while (index < after.length && seen < count) { if (semantic(after[index])) seen++; index++; }
        if (start === before.length) index = after.length;
        el.setSelectionRange(index, index);
      }
      if (!editing) el.dispatchEvent(new Event("input", { bubbles: true }));
    };
    // CRM de vários clientes: o histórico pessoal do navegador não deve sugerir dados de outro cadastro.
    const selector = 'form, input:not([type="password"]):not([type="hidden"]), textarea';
    const prepare = (root: ParentNode) => {
      const fields = [...(root instanceof HTMLElement && root.matches(selector) ? [root] : []), ...Array.from(root.querySelectorAll<HTMLElement>(selector))];
      for (const field of fields) {
        if (field.getAttribute("autocomplete") !== "off") field.setAttribute("autocomplete", "off");
        if (field instanceof HTMLInputElement) format(field);
      }
    };
    prepare(document.body);
    const observer = new MutationObserver(records => {
      for (const record of records) {
        if (record.type === "attributes" && record.target instanceof HTMLElement) prepare(record.target);
        for (const node of record.addedNodes) if (node instanceof HTMLElement) prepare(node);
      }
    });
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["autocomplete", "type"] });
    const onFocus = (e: FocusEvent) => {
      const el = e.target as HTMLInputElement | null;
      if (el instanceof HTMLElement && el.matches(selector)) prepare(el);
      if (el instanceof HTMLInputElement) { format(el); previous.set(el, el.value); }
      if (el?.tagName === "INPUT" && el.type === "number" && !el.hasAttribute("inputmode")) {
        el.setAttribute("inputmode", el.step && !/[.,]/.test(el.step) && el.step !== "any" ? "numeric" : "decimal");
      }
    };
    const onInput = (event: Event) => { if (event.target instanceof HTMLInputElement && !(event as InputEvent).isComposing) format(event.target, true, (event as InputEvent).inputType ?? ""); };
    const onBlur = (event: FocusEvent) => { if (event.target instanceof HTMLInputElement) format(event.target); };
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
    document.addEventListener("input", onInput, true);
    document.addEventListener("focusout", onBlur);
    document.addEventListener("wheel", onWheel, { passive: true });
    return () => { observer.disconnect(); document.removeEventListener("keydown", onKey); document.removeEventListener("focusin", onFocus); document.removeEventListener("input", onInput, true); document.removeEventListener("focusout", onBlur); document.removeEventListener("wheel", onWheel); };
  }, []);
  return null;
}
