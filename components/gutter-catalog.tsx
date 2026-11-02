import { MARQUINHOS_CATALOG, catalogImagePath, catalogModelUrl } from "@/lib/gutter-catalog";

export function GutterCatalog() {
  return <section>
    <h2 className="text-2xl font-black">Catálogo de peças dobradas</h2>
    <p className="mb-6 mt-2 text-sm text-ink/60">Selecione o nome da peça no orçamento. A ilustração e o QR code para o modelo 3D aparecem automaticamente na impressão e no PDF.</p>
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {MARQUINHOS_CATALOG.pieces.map(piece => <a key={piece.id} href={catalogModelUrl(piece)} target="_blank" rel="noopener noreferrer" className="card p-4 transition hover:shadow-md">
        <p className="flex justify-between text-xs font-black uppercase tracking-wider text-red-700"><span>{piece.category}</span><span>{piece.code}</span></p>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={catalogImagePath(piece)} alt={piece.name} width={320} height={180} className="my-3 h-32 w-full object-contain" />
        <h3 className="font-bold">{piece.name}</h3>
        <p className="mt-2 text-xs text-forest underline">Abrir modelo 3D ↗</p>
      </a>)}
    </div>
    <div className="card mt-6 p-5">
      <h3 className="font-bold">Condições da tabela de referência</h3>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">{MARQUINHOS_CATALOG.conditions.map(condition => <li key={condition}>{condition}</li>)}</ul>
      <p className="mt-3 text-xs text-ink/60">Condições para consulta; descontos e formas de pagamento devem ser definidos em cada orçamento, sem aplicação automática cumulativa.</p>
      <a href={MARQUINHOS_CATALOG.source} target="_blank" rel="noopener noreferrer" className="mt-3 inline-block text-sm text-forest underline">Tabela de referência de {MARQUINHOS_CATALOG.sourceDate} ↗</a>
    </div>
  </section>;
}
