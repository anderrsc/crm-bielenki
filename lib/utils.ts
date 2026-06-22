import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs));
}

export const money = (value: number | string | null | undefined) =>
    new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(value ?? 0));

export const shortDate = (value?: string | null) => {
    if (!value) return "Sem data";
    const date = value.includes("T") ? new Date(value) : new Date(`${value.slice(0, 10)}T12:00:00`);
    return Number.isNaN(date.getTime()) ? "Sem data" : new Intl.DateTimeFormat("pt-BR").format(date);
};

export const localISODate = (date = new Date()) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
};
