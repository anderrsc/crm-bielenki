"use client";
import { useEffect } from "react";

/**
 * Valores monetários e indicadores nunca são cortados nem quebrados no meio dos dígitos:
 * a fonte reduz só o necessário (até 70% do tamanho original) para caber na largura do cartão.
 * Marque outros elementos com data-fit para entrarem na regra.
 */
const SELECTOR = [
  "[data-fit]", ".mh-kpi-value strong", ".mh-hero-value", ".sale-money > p:last-child", ".quote-row-total",
  ".num.text-xl", ".num.text-2xl", ".num.text-3xl", ".num.text-4xl",
].join(",");
const MIN_RATIO = 0.7;

function fit(el: HTMLElement) {
  el.style.fontSize = "";
  el.removeAttribute("data-fit-wrap");
  if (el.clientWidth === 0) return;
  if (el.scrollWidth <= el.clientWidth + 1) return;
  const base = parseFloat(getComputedStyle(el).fontSize);
  const ratio = Math.max(MIN_RATIO, el.clientWidth / el.scrollWidth);
  el.style.fontSize = `${(base * ratio).toFixed(2)}px`;
  if (el.scrollWidth > el.clientWidth + 1) el.setAttribute("data-fit-wrap", "true");
}

export function FitNumbers() {
  useEffect(() => {
    let frame = 0;
    const run = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(() => document.querySelectorAll<HTMLElement>(SELECTOR).forEach(fit)); };
    run();
    const mutation = new MutationObserver(run);
    mutation.observe(document.body, { childList: true, subtree: true, characterData: true });
    window.addEventListener("resize", run);
    document.fonts?.ready.then(run).catch(() => {});
    return () => { cancelAnimationFrame(frame); mutation.disconnect(); window.removeEventListener("resize", run); };
  }, []);
  return null;
}
