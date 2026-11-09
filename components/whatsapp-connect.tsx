"use client";
// Quadro "Conectar WhatsApp" da Central de IA: instala a Evolution na nuvem gratuita
// e conecta o número atual por QR code, sem sair do CRM.
import { useCallback, useEffect, useState, useTransition } from "react";
import { CheckCircle, Copy, Smartphone, Users, XCircle } from "lucide-react";
import {
  disconnectEvolution, generateEvolutionKey, getEvolutionQr, getWhatsappSetup, saveEvolutionServer, syncKnownContacts,
  type WhatsappSetup,
} from "@/app/(crm)/whatsapp-connect-actions";
import { cn } from "@/lib/utils";

function Passo({ n, titulo, feito, children }: { n: number; titulo: string; feito?: boolean; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-sand/80 p-3">
      <p className="mb-2 flex items-center gap-2 font-bold">
        <span className={cn("flex h-6 w-6 items-center justify-center rounded-full text-xs font-black", feito ? "bg-green-600 text-white" : "bg-cream text-ink/70")}>{feito ? "✓" : n}</span>
        {titulo}
      </p>
      <div className="space-y-2 text-sm text-ink/75">{children}</div>
    </div>
  );
}

export function WhatsappConnect() {
  const [setup, setSetup] = useState<WhatsappSetup | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [ip, setIp] = useState("");
  const [qr, setQr] = useState<{ state: string; qr: string | null; pairingCode: string | null } | null>(null);
  const [mostrarScript, setMostrarScript] = useState(false);
  const [onde, setOnde] = useState<"pc" | "oracle">("pc");
  const [importando, setImportando] = useState<{ page: number; pages: number; inserted: number; done: boolean; error?: string } | null>(null);

  // Traz o histórico que o WhatsApp já tem (página por página) para o Atendimento.
  const importarHistorico = useCallback(async () => {
    let page = 1, inserted = 0;
    setImportando({ page: 0, pages: 0, inserted: 0, done: false });
    for (;;) {
      const r = await fetch("/api/whatsapp/import-history", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ page }) })
        .then((res) => res.json()).catch((e) => ({ error: String(e) }));
      if (r.error) { setImportando({ page, pages: 0, inserted, done: true, error: r.error }); return; }
      inserted += r.inserted ?? 0;
      setImportando({ page, pages: r.pages ?? 0, inserted, done: !!r.done });
      if (r.done) return;
      page += 1;
    }
  }, []);
  const [pending, start] = useTransition();

  const carregar = useCallback(async () => {
    const r = await getWhatsappSetup();
    if ("setup" in r) { setSetup(r.setup); setErro(null); } else setErro(r.error);
  }, []);
  useEffect(() => { carregar(); }, [carregar]);

  const conectado = setup?.state === "open" || qr?.state === "open";

  // Esperando o PC mandar o endereço do túnel: confere a cada 10 s.
  useEffect(() => {
    if (!setup?.hasKey || setup.url || onde !== "pc") return;
    const t = setInterval(carregar, 10_000);
    return () => clearInterval(t);
  }, [setup?.hasKey, setup?.url, onde, carregar]);

  // Enquanto o QR está na tela, atualiza a cada 5 s até o celular ler.
  useEffect(() => {
    if (!qr || qr.state === "open") return;
    const t = setInterval(async () => {
      const r = await getEvolutionQr();
      if ("state" in r) {
        setQr({ state: r.state, qr: r.qr, pairingCode: r.pairingCode });
        if (r.state === "open") {
          const s = await syncKnownContacts();
          setMsg("added" in s ? `WhatsApp conectado! ${s.total} conversas atuais marcadas como contatos conhecidos (a Ana não responde esses).` : "WhatsApp conectado!");
          carregar();
          // O celular leva alguns segundos para mandar o histórico; depois importa.
          setTimeout(() => { importarHistorico(); }, 20_000);
        }
      }
    }, 5000);
    return () => clearInterval(t);
  }, [qr, carregar, importarHistorico]);

  const run = (fn: () => Promise<{ error?: string } | object>, ok?: string) => start(async () => {
    setMsg(null);
    const r = await fn();
    if ("error" in r && r.error) setErro(r.error); else { setErro(null); if (ok) setMsg(ok); await carregar(); }
  });

  if (!setup && !erro) return <div className="card p-4 text-sm text-ink/55">Carregando conexão do WhatsApp…</div>;

  return (
    <div className="card space-y-3 p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 font-black"><Smartphone className="h-5 w-5" /> WhatsApp da empresa</h2>
        {setup?.url && (
          <span className={cn("flex items-center gap-1 rounded-full px-2 py-1 text-xs font-bold", conectado ? "bg-green-500/15 text-green-500" : "bg-amber-500/15 text-amber-500")}>
            {conectado ? <CheckCircle className="h-3 w-3" /> : <XCircle className="h-3 w-3" />} {conectado ? "Conectado" : "Desconectado"}
          </span>
        )}
      </div>
      <p className="text-xs text-ink/55">Conecta o número atual como mais um "WhatsApp Web". O celular e o WhatsApp Web continuam funcionando. Conexão não oficial: existe risco de bloqueio do número.</p>

      {erro && <p className="rounded-lg bg-red-500/10 p-2 text-xs text-red-500">{erro}</p>}
      {msg && <p className="rounded-lg bg-green-500/10 p-2 text-xs text-green-500">{msg}</p>}

      {setup && (
        <>
          <Passo n={1} titulo="Instalar o servidor" feito={!!setup.url}>
            {!setup.hasKey ? (
              <button disabled={pending} onClick={() => run(generateEvolutionKey)} className="rounded-xl bg-forest px-4 py-2 text-sm font-bold text-white disabled:opacity-60">Gerar instalação</button>
            ) : (
              <>
                <div className="flex gap-1 text-xs font-bold">
                  {([["pc", "PC da empresa (Windows)"], ["oracle", "Nuvem Oracle (grátis)"]] as const).map(([k, l]) => (
                    <button key={k} onClick={() => { setOnde(k); setMostrarScript(false); }} className={cn("rounded-lg px-3 py-1.5", onde === k ? "bg-forest text-white" : "bg-cream text-ink/60")}>{l}</button>
                  ))}
                </div>
                {onde === "pc" ? (
                  <>
                    <p>No PC que fica ligado: instale e abra o <b>Docker Desktop</b>, depois abra o <b>PowerShell</b>, cole o script e aperte Enter. Em 2 minutos o PC manda o endereço para cá sozinho (e manda de novo se reiniciar).</p>
                    <p className="text-xs">No Docker Desktop, deixe ligado "Start Docker Desktop when you sign in". O PC precisa entrar no Windows sozinho depois de reiniciar.</p>
                  </>
                ) : (
                  <>
                    <p>Na Oracle, crie uma instância <b>Ubuntu</b> e, em <b>Mostrar opções avançadas → Gerenciamento → Colar script cloud-init</b>, cole o script abaixo. Ele instala tudo sozinho em uns 10 minutos.</p>
                    <p className="text-xs">Na rede da instância, libere as portas <b>80</b> e <b>443</b> (Lista de segurança → Regras de entrada → origem 0.0.0.0/0, TCP).</p>
                  </>
                )}
                <div className="flex flex-wrap gap-2">
                  <button onClick={() => { navigator.clipboard.writeText((onde === "pc" ? setup.windowsScript : setup.cloudInit) ?? ""); setMsg("Script copiado."); }} className="flex items-center gap-1 rounded-xl bg-forest px-3 py-2 text-xs font-bold text-white"><Copy className="h-4 w-4" /> Copiar script</button>
                  <button onClick={() => setMostrarScript((v) => !v)} className="rounded-xl bg-cream px-3 py-2 text-xs font-bold">{mostrarScript ? "Esconder" : "Ver script"}</button>
                </div>
                {mostrarScript && <pre className="max-h-60 overflow-auto rounded-lg bg-cream p-2 text-[10px] leading-tight">{onde === "pc" ? setup.windowsScript : setup.cloudInit}</pre>}
                {onde === "pc" && !setup.url && <p className="text-xs text-amber-500">Aguardando o PC mandar o endereço…</p>}
              </>
            )}
          </Passo>

          {setup.hasKey && (setup.url || onde === "oracle") && (
            <Passo n={2} titulo="Ligar o servidor ao CRM" feito={!!setup.url && !setup.stateError}>
              {setup.url && <p className="text-xs">Servidor{setup.onPc ? " (PC da empresa)" : ""}: <b>{setup.url}</b>{setup.stateError && <span className="text-red-500"> — {setup.stateError}</span>}</p>}
              {setup.onPc && (setup.stateError || setup.state === null || setup.state === "unknown") && (
                <button disabled={pending} onClick={() => run(() => saveEvolutionServer(""), "Servidor do PC ligado ao CRM.")} className="rounded-xl bg-forest px-3 py-2 text-xs font-bold text-white disabled:opacity-60">{pending ? "Testando…" : "Ligar servidor do PC ao CRM"}</button>
              )}
              {!setup.onPc && <div className="flex gap-2">
                <input value={ip} onChange={(e) => setIp(e.target.value)} placeholder="IP público da instância (ex.: 129.146.10.20)" className="field flex-1" />
                <button disabled={pending || !ip.trim()} onClick={() => run(() => saveEvolutionServer(ip), "Servidor ligado ao CRM.")} className="rounded-xl bg-forest px-3 py-2 text-xs font-bold text-white disabled:opacity-60">{pending ? "Testando…" : "Testar e salvar"}</button>
              </div>}
            </Passo>
          )}

          {setup.url && !setup.stateError && (
            <Passo n={3} titulo="Ler o QR code com o celular da empresa" feito={conectado}>
              {conectado ? (
                <div className="space-y-2">
                  <p className="text-green-500">Número conectado. As mensagens já chegam no Atendimento.</p>
                  <p className="text-xs">A Ana só responde número que ainda não conversou com vocês. {setup.syncedAt ? `Contatos atuais marcados em ${new Date(setup.syncedAt).toLocaleString("pt-BR")}.` : ""}</p>
                  <div className="rounded-lg bg-cream/60 p-2 text-xs">
                    <p className="font-bold">Histórico de conversas</p>
                    <p className="text-ink/60">Traz para o Atendimento as conversas e mensagens que o WhatsApp já tem. Pode rodar de novo: não duplica.</p>
                    {importando && (
                      <p className={cn("mt-1", importando.error ? "text-red-500" : importando.done ? "text-green-500" : "text-ink/70")}>
                        {importando.error ? `Erro: ${importando.error}`
                          : importando.done ? `Pronto: ${importando.inserted} mensagens importadas.`
                          : `Importando… página ${importando.page}${importando.pages ? ` de ${importando.pages}` : ""} · ${importando.inserted} mensagens`}
                      </p>
                    )}
                    <button disabled={!!importando && !importando.done} onClick={importarHistorico} className="mt-2 rounded-xl bg-forest px-3 py-2 text-xs font-bold text-white disabled:opacity-60">
                      {importando && !importando.done ? "Importando…" : "Importar histórico do WhatsApp"}
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button disabled={pending} onClick={() => run(async () => { const r = await syncKnownContacts(); return "added" in r ? (setMsg(`${r.total} conversas marcadas como conhecidas (${r.added} novas).`), {}) : r; })} className="flex items-center gap-1 rounded-xl bg-cream px-3 py-2 text-xs font-bold"><Users className="h-4 w-4" /> Marcar contatos atuais de novo</button>
                    <button disabled={pending} onClick={() => run(disconnectEvolution, "WhatsApp desconectado do CRM.")} className="rounded-xl bg-red-500/10 px-3 py-2 text-xs font-bold text-red-500">Desconectar</button>
                  </div>
                </div>
              ) : qr?.qr ? (
                <div className="space-y-2">
                  <p>No celular: WhatsApp Business → <b>Dispositivos conectados</b> → <b>Conectar dispositivo</b> e aponte para o código.</p>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={qr.qr} alt="QR code do WhatsApp" className="mx-auto h-64 w-64 rounded-lg bg-white p-2" />
                  <p className="text-center text-xs text-ink/50">O código muda sozinho; se expirar, ele é renovado aqui.</p>
                </div>
              ) : (
                <button disabled={pending} onClick={() => start(async () => { const r = await getEvolutionQr(); if ("state" in r) { setQr({ state: r.state, qr: r.qr, pairingCode: r.pairingCode }); setErro(null); } else setErro(r.error); })}
                  className="rounded-xl bg-green-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-60">Mostrar QR code</button>
              )}
            </Passo>
          )}
        </>
      )}
    </div>
  );
}
