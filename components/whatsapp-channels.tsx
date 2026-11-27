"use client";
// Números de WhatsApp (calha, esquadrias…): cada usuária conecta o próprio número lendo o QR
// e autoriza quem mais pode ver as conversas dele. Cadastros continuam centralizados.
import { useCallback, useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { CheckCircle, Plus, Smartphone, XCircle } from "lucide-react";
import dynamic from "next/dynamic";
import { ArrowDownLeft, ArrowUpRight, MessagesSquare } from "lucide-react";
import {
  channelRecentMessages, type ChannelMessage,
  addWhatsappChannel, disconnectWhatsappChannel, listWhatsappChannels, loadWhatsappHealthSummary, renameWhatsappChannel, restartWhatsappChannel, setWhatsappChannelAccess, whatsappChannelQr,
  type ChannelRow, type WhatsappHealthSummary,
} from "@/app/(crm)/whatsapp-channel-actions";
import { cn } from "@/lib/utils";
import { deafSince, latestIso } from "@/lib/whatsapp/watchdog";

const WhatsappConnect = dynamic(() => import("@/components/whatsapp-connect").then((m) => m.WhatsappConnect), { loading: () => <p role="status" className="text-sm text-ink/55">Carregando conexão…</p> });
import { confirmAction } from "@/components/ui-feedback/confirm";

const STATUS: Record<string, string> = { open: "Conectado", aguardando_qr: "Aguardando QR", connecting: "Conectando", close: "Desconectado", desconectado: "Desconectado", migrado: "Aguardando conferência", unreachable: "Servidor sem resposta" };
const quando = (iso: string | null) => (iso ? new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—");

/** Painel consolidado de saúde de todos os canais usando v_whatsapp_health_summary. */
export function HealthDashboard({ summary }: { summary: WhatsappHealthSummary }) {
  if (!summary.length) return null;
  const totalErrors = summary.reduce((acc, c) => acc + (c.errors_last_24h ?? 0), 0);
  const totalEvents = summary.reduce((acc, c) => acc + (c.events_last_24h ?? 0), 0);
  const disconnected = summary.filter((c) => c.current_status !== "open");
  return (
    <div className="card space-y-3 p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Saúde do WhatsApp</h2>
        <span className={cn("rounded-full px-2 py-0.5 text-xs font-semibold", totalErrors > 0 ? "bg-red-500/15 text-red-600" : "bg-green-500/15 text-green-600")}>
          {totalErrors > 0 ? `${totalErrors} erro(s) nas últimas 24h` : "Sem erros nas últimas 24h"}
        </span>
      </div>
      <div className="grid gap-2 text-xs sm:grid-cols-3">
        <div className="rounded-lg bg-cream px-3 py-2">
          <p className="text-ink/55">Canais ativos</p>
          <p className="text-xl font-semibold">{summary.length - disconnected.length}/{summary.length}</p>
        </div>
        <div className="rounded-lg bg-cream px-3 py-2">
          <p className="text-ink/55">Eventos (24h)</p>
          <p className="text-xl font-semibold">{totalEvents}</p>
        </div>
        <div className={cn("rounded-lg px-3 py-2", totalErrors > 0 ? "bg-red-500/10" : "bg-cream")}>
          <p className={cn(totalErrors > 0 ? "text-red-500" : "text-ink/55")}>Erros (24h)</p>
          <p className={cn("text-xl font-semibold", totalErrors > 0 ? "text-red-600" : "")}>{totalErrors}</p>
        </div>
      </div>
      <ul className="space-y-1.5 text-xs" aria-label="Saúde por número">
        {summary.map((c) => (
          <li key={c.channel_id} className="rounded-lg border px-3 py-2">
            <p className="font-semibold">{c.channel_name}</p>
            <p className="text-ink/70">
              Teste de conexão: {c.probe ? <span className={c.probe.ok ? "text-green-600" : "text-red-600"}>{c.probe.ok ? "respondeu" : "não respondeu"} ({quando(c.probe.at)})</span> : "ainda não precisou (só testa depois de 20 min sem mensagens)"}
              {" · "}Configuração do webhook: {c.webhook ? <span className={c.webhook.ok ? "text-green-600" : "text-red-600"} title={c.webhook.problems ?? undefined}>{c.webhook.ok ? "ok" : `com problema (${c.webhook.problems ?? "ver servidor"})`} ({quando(c.webhook.at)})</span> : "ainda não conferida"}
            </p>
            {((c.failed_24h ?? 0) > 0 || (c.unknown_24h ?? 0) > 0) && (
              <p className="text-amber-700">Envios nas últimas 24 h: {c.failed_24h ?? 0} com falha · {c.unknown_24h ?? 0} sem confirmação do WhatsApp (confira no celular)</p>
            )}
          </li>
        ))}
      </ul>
      {disconnected.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs font-semibold text-amber-600">Canais desconectados:</p>
          {disconnected.map((c) => (
            <p key={c.channel_id} className="text-xs text-ink/70">
              • <b>{c.channel_name}</b> — {c.current_status ?? "desconhecido"}
              {c.last_connection_event_at ? ` (último evento: ${new Date(c.last_connection_event_at).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })})` : ""}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

export function WhatsappChannels() {
  const [channels, setChannels] = useState<ChannelRow[] | null>(null);
  const [team, setTeam] = useState<Array<{ id: string; name: string }>>([]);
  const [manager, setManager] = useState(false);
  const [healthSummary, setHealthSummary] = useState<WhatsappHealthSummary>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [nome, setNome] = useState("");
  const [qrFor, setQrFor] = useState<string | null>(null);
  const [qr, setQr] = useState<{ state: string; qr: string | null; pairingCode: string | null } | null>(null);
  const [pending, start] = useTransition();

  const carregar = useCallback(async () => {
    const r = await listWhatsappChannels();
    if ("channels" in r) { setChannels(r.channels); setTeam(r.team); setManager(r.manager); } else setErro(r.error);
    const h = await loadWhatsappHealthSummary();
    if ("summary" in h) setHealthSummary(h.summary);
  }, []);
  useEffect(() => { carregar(); }, [carregar]);

  // QR na tela: atualiza a cada 5 s até o celular ler.
  useEffect(() => {
    if (!qrFor) return;
    let vivo = true;
    const tick = async () => {
      const r = await whatsappChannelQr(qrFor);
      if (!vivo) return;
      if ("state" in r) {
        setQr({ state: r.state, qr: r.qr, pairingCode: r.pairingCode });
        if (r.state === "open") { setMsg(`Número conectado${r.phone ? ` (${r.phone})` : ""}! As conversas novas dele aparecem no Atendimento.`); setQrFor(null); setQr(null); carregar(); }
      } else setErro(r.error);
    };
    tick();
    const t = setInterval(tick, 5000);
    return () => { vivo = false; clearInterval(t); };
  }, [qrFor, carregar]);

  const run = (fn: () => Promise<{ error?: string } | object>, ok?: string) => start(async () => {
    setMsg(null);
    const r = await fn();
    if ("error" in r && r.error) setErro(r.error); else { setErro(null); if (ok) setMsg(ok); await carregar(); }
  });

  return (
    <div className="max-w-4xl space-y-4">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold"><Smartphone className="h-6 w-6" /> WhatsApp</h1>
        <p className="text-sm text-ink/60">Cada usuária conecta o próprio número lendo o QR no celular. As conversas de cada número ficam com quem conectou, com quem ela autorizar e com a gerência. Clientes, orçamentos e vendas continuam centralizados para todos.</p>
      </div>

      {erro && <p className="rounded-lg bg-red-500/10 p-2 text-sm text-red-500">{erro}</p>}
      {msg && <p className="rounded-lg bg-green-500/10 p-2 text-sm text-green-600">{msg}</p>}

      <HealthDashboard summary={healthSummary} />

      {manager && (
        <details className="card p-4" open={!channels?.some((c) => c.isDefault && c.active && c.status === "open")}>
          <summary className="cursor-pointer font-semibold">Conexão do número principal (servidor da empresa)</summary>
          <p className="mt-1 text-xs text-ink/55">Servidor do WhatsApp (Evolution), chave e QR do número principal. Os outros números usam este mesmo servidor.</p>
          <div className="mt-3"><WhatsappConnect /></div>
        </details>
      )}

      <div className="card space-y-2 p-4">
        <p className="font-semibold">Adicionar meu número</p>
        <div className="flex gap-2">
          <input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex.: WhatsApp Esquadrias" maxLength={60} className="field min-w-0 flex-1" />
          <button disabled={pending || nome.trim().length < 2} className="inline-flex items-center gap-1 rounded-xl bg-forest px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
            onClick={() => start(async () => {
              setMsg(null);
              const r = await addWhatsappChannel(nome);
              if ("id" in r) { setErro(null); setNome(""); setQr(null); setQrFor(r.id); await carregar(); } else setErro(r.error);
            })}><Plus className="h-4 w-4" /> Gerar QR</button>
        </div>
        <p className="text-xs text-ink/55">No celular: WhatsApp → Aparelhos conectados → Conectar um aparelho → aponte para o QR. A LIA não responde nos números novos.</p>
      </div>

      {qrFor && (
        <div className="card flex flex-col items-center gap-2 p-4 text-center">
          <p className="font-semibold">Leia o QR com o WhatsApp do número</p>
          {qr?.qr ? <img src={qr.qr.startsWith("data:") ? qr.qr : `data:image/png;base64,${qr.qr}`} alt="QR do WhatsApp" className="h-64 w-64 rounded-lg bg-white p-2" /> : <p className="text-sm text-ink/55">Gerando QR…</p>}
          {qr?.pairingCode && <p className="text-sm">Ou use o código: <b className="font-mono">{qr.pairingCode}</b></p>}
          <button onClick={() => { setQrFor(null); setQr(null); }} className="text-xs font-semibold text-ink/55 underline">Fechar</button>
        </div>
      )}

      {!channels && !erro && <p className="text-sm text-ink/55">Carregando números…</p>}
      {channels?.map((c) => <Canal key={c.id} c={c} team={team} pending={pending} run={run} onQr={() => { setQr(null); setQrFor(c.id); }} />)}
    </div>
  );
}

function Canal({ c, team, pending, run, onQr }: {
  c: ChannelRow; team: Array<{ id: string; name: string }>; pending: boolean;
  run: (fn: () => Promise<{ error?: string } | object>, ok?: string) => void; onQr: () => void;
}) {
  // Só "conectado" depois que a rotina conferiu de verdade (status "open"); nunca por suposição.
  const conectado = c.active && c.status === "open";
  const [editando, setEditando] = useState(false);
  const [nome, setNome] = useState(c.name);
  const [quem, setQuem] = useState("");
  const outros = team.filter((t) => t.id !== c.ownerId && !c.members.some((m) => m.id === t.id));
  return (
    <div className="card space-y-2 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {editando ? (
          <div className="flex flex-1 gap-2">
            <input value={nome} onChange={(e) => setNome(e.target.value)} maxLength={60} className="field min-w-0 flex-1" />
            <button disabled={pending} className="rounded-lg bg-forest px-3 text-sm font-semibold text-white" onClick={() => { run(() => renameWhatsappChannel(c.id, nome)); setEditando(false); }}>Salvar</button>
          </div>
        ) : (
          <p className="font-semibold">{c.name} {c.isDefault && <span className="ml-1 rounded bg-cream px-1.5 py-0.5 text-[11px] font-semibold text-ink/60">principal · LIA</span>}</p>
        )}
        <span className={cn("flex items-center gap-1 rounded-full px-2 py-1 text-xs font-semibold", conectado ? "bg-green-500/15 text-green-600" : "bg-amber-500/15 text-amber-600")}>
          {conectado ? <CheckCircle className="h-3 w-3" /> : <XCircle className="h-3 w-3" />} {STATUS[c.status ?? ""] ?? c.status ?? "—"}
        </span>
      </div>
      <p className="text-xs text-ink/60">
        {c.phone ? `${c.phone} · ` : ""}{c.isDefault || c.shared ? "Toda a equipe vê" : `De ${c.mine ? "você" : c.ownerName ?? "—"}`} · última mensagem {quando(c.lastEventAt)} · sincronizado {quando(c.lastSyncAt)}{c.lastRestartAt ? ` · reiniciado ${quando(c.lastRestartAt)}` : ""}
      </p>
      <Saude c={c} />
      <Mensagens c={c} />
      {!c.isDefault && !c.shared && (
        <div className="space-y-1 text-sm">
          <p className="text-xs font-semibold text-ink/60">Quem mais pode ver as conversas deste número</p>
          <div className="flex flex-wrap gap-1">
            {c.members.length === 0 && <span className="text-xs text-ink/50">Só {c.mine ? "você" : c.ownerName} e a gerência.</span>}
            {c.members.map((m) => (
              <span key={m.id} className="inline-flex items-center gap-1 rounded-full bg-cream px-2 py-0.5 text-xs">{m.name}
                {c.canManage && <button disabled={pending} aria-label={`Remover ${m.name}`} onClick={() => run(() => setWhatsappChannelAccess(c.id, m.id, false))}>×</button>}
              </span>
            ))}
          </div>
          {c.canManage && outros.length > 0 && (
            <div className="flex gap-2">
              <select value={quem} onChange={(e) => setQuem(e.target.value)} className="field min-w-0 flex-1 text-sm" aria-label="Autorizar usuário">
                <option value="">Autorizar usuário…</option>
                {outros.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
              <button disabled={pending || !quem} className="rounded-lg bg-forest px-3 text-sm font-semibold text-white disabled:opacity-60" onClick={() => { const p = quem; setQuem(""); run(() => setWhatsappChannelAccess(c.id, p, true), "Acesso liberado."); }}>Autorizar</button>
            </div>
          )}
        </div>
      )}
      {c.canManage && !c.isDefault && (
        <div className="flex flex-wrap gap-2 pt-1 text-xs font-semibold">
          {!conectado && c.provider === "evolution" && <button onClick={onQr} className="rounded-lg bg-forest px-3 py-1.5 text-white">Ler QR</button>}
          <button onClick={() => setEditando((v) => !v)} className="rounded-lg bg-cream px-3 py-1.5">Renomear</button>
          {c.active && <button disabled={pending} className="rounded-lg bg-red-500/10 px-3 py-1.5 text-red-600"
            onClick={() => { void confirmAction({ title: "Desconectar número", message: `Desconectar "${c.name}"? O histórico continua no CRM.`, confirmLabel: "Desconectar" }).then((ok) => { if (ok) run(() => disconnectWhatsappChannel(c.id), "Número desconectado."); }); }}>Desconectar</button>}
        </div>
      )}
      {c.canManage && c.provider === "evolution" && c.active && (
        <div className="rounded-lg bg-cream/60 p-2 text-xs">
          <p className="text-ink/65">As mensagens pararam de entrar, mas o número aparece conectado? Reinicie a conexão: não desconecta e não pede QR. O CRM também faz isso sozinho quando fica 20 min sem receber nada no expediente.</p>
          <button disabled={pending} className="mt-1.5 rounded-lg bg-forest px-3 py-1.5 font-semibold text-white disabled:opacity-60"
            onClick={() => run(() => restartWhatsappChannel(c.id), "Conexão reiniciada. As mensagens que ficaram paradas entram em instantes; se o número não voltar como Conectado em 1 minuto, leia o QR de novo.")}>
            {pending ? "Reiniciando…" : "Reiniciar conexão"}
          </button>
        </div>
      )}
      {c.isDefault && <p className="text-xs text-ink/50">O número principal é conectado na seção "Conexão do número principal", no topo desta tela.</p>}
    </div>
  );
}

/** Painel de saúde do número: servidor, última mensagem recebida, envios com problema e clientes esperando. */
function Saude({ c }: { c: ChannelRow }) {
  const idade = (iso: string | null) => (iso ? Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60_000)) : null);
  const sync = idade(c.lastSyncAt);
  const aberto = c.status === "open";
  // A rotina confere o servidor a cada poucos minutos: sem conferência recente = sem resposta.
  const mudo = !!deafSince({ state: c.status ?? "", lastMessageAt: latestIso(c.lastEventAt, c.lastInboundAt), lastRestartAt: c.lastRestartAt, isDefault: c.isDefault, now: new Date() });
  const servidor = !c.active ? { ok: false, t: "Desconectado" } : mudo ? { ok: false, t: "Conectado, mas sem receber mensagens: desconecte e leia o QR de novo" } :!c.lastSyncAt ? { ok: false, t: "Ainda não conferido pela rotina (aguarde alguns minutos)" } : !aberto ? { ok: false, t: "Servidor sem conexão com o WhatsApp" } : sync !== null && sync > 30 ? { ok: false, t: `Sem conferência há ${sync >= 60 ? `${Math.floor(sync / 60)} h` : `${sync} min`}` } : { ok: true, t: "Servidor respondendo" };
  const ultima = idade(c.lastInboundAt);
  const tempo = ultima === null ? "nenhuma nos últimos 7 dias" : ultima < 60 ? `há ${ultima} min` : ultima < 1440 ? `há ${Math.floor(ultima / 60)} h` : `há ${Math.floor(ultima / 1440)} dia(s)`;
  const item = "rounded-lg bg-cream px-2.5 py-1.5";
  return (
    <div className="grid gap-2 text-xs sm:grid-cols-2" aria-label={`Saúde de ${c.name}`}>
      <p className={cn(item, "flex items-center gap-1.5 font-semibold", servidor.ok ? "text-green-600" : "text-red-500")}>{servidor.ok ? <CheckCircle className="h-3.5 w-3.5" /> : <XCircle className="h-3.5 w-3.5" />}{servidor.t}</p>
      <p className={item}>Última mensagem recebida: <b>{tempo}</b></p>
      <p className={cn(item, c.failed24h > 0 && "text-red-500")}>Mensagens que falharam (24 h): <b>{c.failed24h}</b></p>
      <p className={cn(item, c.unconfirmed24h > 0 && "text-amber-600")}>Sem confirmação do WhatsApp (24 h): <b>{c.unconfirmed24h}</b></p>
      <p className={cn(item, "sm:col-span-2", c.waitingOver2h > 0 && "text-amber-600")}>Clientes esperando resposta há mais de 2 h: <b>{c.waitingOver2h}</b></p>
    </div>
  );
}

/** Conferir as últimas mensagens do número e abrir as conversas dele no Atendimento. */
function Mensagens({ c }: { c: ChannelRow }) {
  const [msgs, setMsgs] = useState<ChannelMessage[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aberto, setAberto] = useState(false);
  const [pending, start] = useTransition();
  const carregar = () => start(async () => {
    const r = await channelRecentMessages(c.id);
    if ("messages" in r) { setMsgs(r.messages); setErro(null); } else setErro(r.error);
  });
  const hora = (iso: string) => new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  const STATUS: Record<string, string> = { lida: "lida", entregue: "entregue", enviada: "enviada", enviando: "enviando", falhou: "falhou", desconhecido: "sem confirmação" };
  return (
    <div className="text-sm">
      <div className="flex flex-wrap gap-2 text-xs font-semibold">
        <button type="button" disabled={pending} onClick={() => { const v = !aberto; setAberto(v); if (v) carregar(); }} className="inline-flex items-center gap-1 rounded-lg bg-cream px-3 py-1.5">
          <MessagesSquare className="h-3.5 w-3.5" />{aberto ? "Fechar mensagens" : "Conferir últimas mensagens"}
        </button>
        <Link href={`/atendimento?numero=${c.id}`} className="inline-flex items-center gap-1 rounded-lg bg-cream px-3 py-1.5">Ver conversas deste número →</Link>
        {aberto && <button type="button" disabled={pending} onClick={carregar} className="rounded-lg px-2 py-1.5 text-forest underline">{pending ? "Atualizando…" : "Atualizar"}</button>}
      </div>
      {aberto && (
        <div className="mt-2 rounded-xl border border-sand">
          {erro && <p className="p-3 text-xs text-red-500">{erro}</p>}
          {!msgs && !erro && <p className="p-3 text-xs text-ink/55">Carregando…</p>}
          {msgs?.length === 0 && <p className="p-3 text-xs text-ink/55">Nenhuma mensagem neste número ainda.</p>}
          <ul className="divide-y divide-sand">
            {msgs?.map((m) => (
              <li key={m.id}>
                <Link href={`/atendimento?c=${m.conversationId}`} className="flex items-start gap-2 px-3 py-2 hover:bg-cream">
                  {m.direction === "inbound" ? <ArrowDownLeft className="mt-0.5 h-3.5 w-3.5 shrink-0 text-blue-500" aria-label="Recebida" /> : <ArrowUpRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-green-600" aria-label="Enviada" />}
                  <span className="min-w-0 flex-1"><b className="text-xs">{m.contact}</b> <span className="text-xs text-ink/50">· {hora(m.at)}{m.direction === "outbound" && m.status ? ` · ${STATUS[m.status] ?? m.status}` : ""}</span><span className={cn("block truncate text-xs", m.status === "falhou" ? "text-red-500" : "text-ink/70")}>{m.body || "—"}</span></span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
