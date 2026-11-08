// "Ocultar deslocamento": o valor do deslocamento é diluído nos outros itens,
// proporcional ao valor de cada um, para a soma das linhas bater com o subtotal
// sem o cliente conseguir descobrir quanto custou o deslocamento.
export type DilutionLine = {
  total: number; // total da linha sem diluição
  base: number; // quantidade que multiplica o unitário (qtd ou qtd × metros)
  travel: boolean;
};

export type DilutedLine = { total: number; unitPrice: number | null };

const cents = (value: number) => Math.round(value * 100);

export function diluteTravel(lines: DilutionLine[]): DilutedLine[] | null {
  const travelCents = lines.filter(l => l.travel).reduce((t, l) => t + cents(l.total), 0);
  const visible = lines.map((l, i) => ({ ...l, i })).filter(l => !l.travel && cents(l.total) > 0);
  if (travelCents <= 0 || !visible.length) return null;

  const visibleCents = visible.reduce((t, l) => t + cents(l.total), 0);
  const result: DilutedLine[] = lines.map(l => ({ total: l.total, unitPrice: null }));
  let distributed = 0;
  visible.forEach((line, n) => {
    const own = cents(line.total);
    // O último item fica com o resto do arredondamento: a soma fecha no centavo.
    const share = n === visible.length - 1 ? travelCents - distributed : Math.round((travelCents * own) / visibleCents);
    distributed += share;
    const total = (own + share) / 100;
    result[line.i] = { total, unitPrice: line.base > 0 ? Math.round((total / line.base) * 100) / 100 : null };
  });
  lines.forEach((line, i) => { if (line.travel) result[i] = { total: 0, unitPrice: null }; });
  return result;
}
