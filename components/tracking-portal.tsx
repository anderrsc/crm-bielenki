import Link from 'next/link';

export function TrackingPortal(){
 return <div className="mx-auto max-w-[1600px] space-y-4">
  <header className="flex flex-wrap items-start justify-between gap-3">
   <div><Link href="/equipes/rastreamento" className="text-sm font-medium text-forest underline">← Localização dos veículos</Link><h1 className="mt-3 text-3xl font-semibold">Painel TrackCEO</h1></div>
   <a href="https://gps.trackceo.com/" target="_blank" rel="noopener noreferrer" className="button-ghost">Abrir em nova guia</a>
  </header>
  <p className="text-sm text-ink/65">Entre com sua conta do rastreamento no painel abaixo. Esta área mostra o site do TrackCEO; os dados não são sincronizados com os cadastros do CRM.</p>
  <section className="card overflow-hidden" aria-label="Portal do rastreamento">
   <iframe title="Painel TrackCEO" src="https://gps.trackceo.com/" referrerPolicy="no-referrer" sandbox="allow-forms allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-modals allow-downloads" allowFullScreen className="block h-[calc(100dvh-240px)] min-h-[680px] w-full border-0"/>
  </section>
  <p className="pb-4 text-sm text-ink/65">Mantenha esta página aberta para acompanhar o rastreamento. Se o painel não abrir ou o login não permanecer conectado, use “Abrir em nova guia”.</p>
 </div>;
}
