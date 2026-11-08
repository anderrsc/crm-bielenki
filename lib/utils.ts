import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs));
}

export const money = (value: number | string | null | undefined) =>
    new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number.isFinite(Number(value ?? 0)) ? Number(value ?? 0) : 0);

/**
 * Fuso dos usuarios. O servidor (Vercel) roda em UTC: datas formatadas sem
 * fuso explicito mudam de dia a partir das 21h e o React acusa erro de
 * hidratacao (#418) quando servidor e navegador discordam.
 */
export const APP_TIME_ZONE = "America/Sao_Paulo";

/** Data de hoje (AAAA-MM-DD) no fuso de Brasilia, igual no servidor e no navegador. */
export const todayISO = () =>
    new Intl.DateTimeFormat("en-CA", { timeZone: APP_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

/** Soma dias a uma data AAAA-MM-DD (sem depender do fuso). */
// Validade padrão do orçamento: 7 dias corridos (pode ser alterada no orçamento).
export const DEFAULT_QUOTE_VALIDITY_DAYS = 7;

export const addDaysISO = (iso: string, days: number) => {
    const date = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
};

export const shortDate = (value?: string | null) => {
    if (!value) return "Sem data";
    const date = value.includes("T") ? new Date(value) : new Date(`${value.slice(0, 10)}T12:00:00Z`);
    return Number.isNaN(date.getTime()) ? "Sem data" : new Intl.DateTimeFormat("pt-BR", { timeZone: APP_TIME_ZONE }).format(date);
};

// Converte URL de logo para proxy local (resolve CORS na impressão/PDF)
export const proxyLogoUrl = (url: string | null | undefined): string | null => {
  if (!url) return null;
  return `/api/proxy-image?url=${encodeURIComponent(url)}`;
};

/** AAAA-MM-DD de um Date pelos campos locais; sem argumento, hoje em Brasilia. */
export const localISODate = (date?: Date) => {
    if (!date) return todayISO();
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
};
