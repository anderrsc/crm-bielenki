export type PendingItem = {
  record_id: string;
  category: string;
  priority: string;
  title: string;
  subtitle: string;
  link: string;
  due_date: string | null;
  days_late: number | null;
  amount: number | null;
  client_name: string | null;
};

export function pendingCategory(category: string) {
  return category.startsWith('financeiro_') ? 'financeiro' : category;
}

export function summarizePending(items: PendingItem[], category?: string) {
  const counts: Record<string, number> = {};
  for (const item of items) {
    const key = pendingCategory(item.category);
    counts[key] = (counts[key] ?? 0) + 1;
  }
  const priorities: Record<string, number> = { high: 0, medium: 1, low: 2 };
  const filtered = items.filter(item => !category || item.category === category || pendingCategory(item.category) === category)
    .sort((a, b) => (priorities[a.priority] ?? 2) - (priorities[b.priority] ?? 2)
      || (a.due_date ?? '9999').localeCompare(b.due_date ?? '9999'));
  return { counts, filtered, totalHigh: filtered.filter(item => item.priority === 'high').length };
}
