import { APP_TIME_ZONE } from "@/lib/utils";

export const inboxDay = (value: string | Date) => new Intl.DateTimeFormat("en-CA", { timeZone: APP_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(value));
export const inboxClock = (value: string) => new Intl.DateTimeFormat("pt-BR", { timeZone: APP_TIME_ZONE, hour: "2-digit", minute: "2-digit" }).format(new Date(value));
// "Agora" é sempre a data real (como no WhatsApp: hoje mostra a hora, ontem "Ontem", antes a data).
// Na tela, o texto que depende do relógio leva suppressHydrationWarning para o servidor e o
// navegador poderem diferir por segundos sem erro de hidratação.
export function inboxDayLabel(value: string, now?: Date) {
  const n = now ?? new Date();
  if (inboxDay(value) === inboxDay(n)) return "Hoje";
  if (inboxDay(value) === inboxDay(new Date(n.getTime() - 86400000))) return "Ontem";
  return new Intl.DateTimeFormat("pt-BR", { timeZone: APP_TIME_ZONE, day: "2-digit", month: "long", year: "numeric" }).format(new Date(value));
}
export function inboxListTime(value: string | null, now?: Date) {
  if (!value) return "";
  const n = now ?? new Date();
  if (inboxDay(value) === inboxDay(n)) return inboxClock(value);
  if (inboxDay(value) === inboxDay(new Date(n.getTime() - 86400000))) return "Ontem";
  return new Intl.DateTimeFormat("pt-BR", { timeZone: APP_TIME_ZONE, day: "2-digit", month: "2-digit" }).format(new Date(value));
}
