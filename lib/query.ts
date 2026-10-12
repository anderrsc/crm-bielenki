export function pageNumber(value?: string) {
  const page = Number(value ?? 1);
  return Number.isSafeInteger(page) && page > 0 ? page : 1;
}

// PostgREST treats commas, parentheses and periods as filter syntax. Quoting
// the pattern preserves literal input instead of building extra conditions.
export function searchFilter(columns: string[], value: string) {
  const literal = value.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_').replace(/"/g, '\\"');
  return columns.map(column => `${column}.ilike."%${literal}%"`).join(',');
}
