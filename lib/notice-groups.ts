// Avisos da equipe: separa urgente de informativo e junta avisos repetidos (mesmo título).
export type NoticeLike = { id: string; title: string; body: string | null; link: string | null; read_at: string | null };
export type NoticeGroup<T extends NoticeLike = NoticeLike> = { title: string; items: T[]; unread: number; urgent: boolean };

const URGENT = /sem resposta|desconectad|vencid|atrasad|falh|erro|urgente|cancelad/i;
export const isUrgentNotice = (title: string) => URGENT.test(title);

/** Urgentes primeiro; dentro de cada bloco, não lidos primeiro. Avisos com o mesmo título viram um grupo. */
export function groupNotices<T extends NoticeLike>(notices: T[]): NoticeGroup<T>[] {
  const map = new Map<string, NoticeGroup<T>>();
  for (const n of notices) {
    const g = map.get(n.title) ?? { title: n.title, items: [], unread: 0, urgent: isUrgentNotice(n.title) };
    g.items.push(n); if (!n.read_at) g.unread++;
    map.set(n.title, g);
  }
  return [...map.values()].sort((a, b) => Number(b.urgent) - Number(a.urgent) || Number(b.unread > 0) - Number(a.unread > 0));
}
