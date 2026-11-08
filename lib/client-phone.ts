export function correctClientPhone(value: string): string {
  // Only correct a complete Brazilian number with DDD and an old mobile prefix.
  // Leave extensions, short numbers and foreign numbers as entered.
  const match = /^(?:(\+?55)[\s.-]*)?\(?0?([1-9]\d)\)?[\s.-]*([6-9]\d{3})[\s.-]*(\d{4})$/.exec(value.trim());
  if (!match) return value;
  const [, country, area, first, last] = match;
  return `${country ? "+55 " : ""}(${area}) 9${first}-${last}`;
}
