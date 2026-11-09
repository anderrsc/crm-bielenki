"use client";
// Atendimento estilo Octadesk: conversas do WhatsApp, nome de quem respondeu em cima
// de cada mensagem e, ao lado, a ficha do cliente com orçamentos e financeiro.
import Link from "next/link";
import { InboxAttachments } from "@/components/inbox-attachments";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { ArrowLeft, Bot, CheckCheck, CircleAlert, Link2, Search, Send, UserPlus, Wallet, X } from "lucide-react";
import {
  closeQuoteFromInbox, createClientFromConversation, linkConversationClient, loadConversation, loadInbox,
  receiveFromInbox, searchClientsForLink, sendInboxMessage, setConversationAi,
  type ClientPanel, type ConversationDetail, type InboxItem, type InboxMessage,
} from "@/app/(crm)/atendimento-actions";
import { StatusBadge } from "@/components/status-badge";
import { cn } from "@/lib/utils";
import { formatBrPhone } from "@/lib/whatsapp/phone";

const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const hora = (iso: string | null) => {
  if (!iso) return "";
  const d = new Date(iso);
  const hoje = new Date().toDateString() === d.toDateString();
  return d.toLocaleString("pt-BR", hoje ? { hour: "2-digit", minute: "2-digit" } : { day: "2-digit", month: "2-digit" });
};
const dataBr = (iso: string | null) => (iso ? new Date(iso.length === 10 ? `${iso}T12:00:00` : iso).toLocaleDateString("pt-BR") : "—");
const hojeISO = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 10);

/** Tira a assinatura "*Nome:*" do texto (o nome já aparece em cima do balão). */
function semAssinatura(body: string) {
  return body.replace(/^\*[^*\n]{1,40}:\*\s*\n?/, "");
}
/** Negrito do WhatsApp (*texto*) sem usar HTML cru. */
const MIDIA = /^\[(foto|áudio|vídeo|figurinha|documento)(?::[^\]]*)?\]\s*/;
/** Foto, áudio, vídeo e documento abrem direto na conversa (o arquivo vem do WhatsApp). */
function Midia({ id, body }: { id: string; body: string }) {
  const tipo = body.match(MIDIA)?.[1];
  const [erro, setErro] = useState(false);
  if (!tipo) return null;
  const src = `/api/whatsapp/media/${id}`;
  if (erro) return <p className="text-xs italic text-ink/50">Arquivo não está mais disponível no WhatsApp.</p>;
  if (tipo === "foto" || tipo === "figurinha")
    return <a href={src} target="_blank" rel="noreferrer"><img src={src} alt={tipo} loading="lazy" onError={() => setErro(true)} className={cn("mb-1 rounded-xl", tipo === "foto" ? "max-h-72 w-auto" : "h-28 w-28")} /></a>;
  if (tipo === "áudio") return <audio controls preload="none" src={src} onError={() => setErro(true)} className="mb-1 w-64 max-w-full" />;
  if (tipo === "vídeo") return <video controls preload="metadata" src={src} onError={() => setErro(true)} className="mb-1 max-h-72 rounded-xl" />;
  return <a href={src} target="_blank" rel="noreferrer" className="mb-1 inline-block rounded-lg bg-cream px-2 py-1 text-xs font-bold underline">Abrir {body.match(/^\[documento:\s*([^\]]+)\]/)?.[1] ?? "documento"}</a>;
}

function Formatado({ text }: { text: string }) {
  const parts = text.split(/(\*[^*\n]+\*)/g);
  return <>{parts.map((p, i) => (/^\*[^*\n]+\*$/.test(p) ? <b key={i}>{p.slice(1, -1)}</b> : <span key={i}>{p}</span>))}</>;
}

function quemEnviou(m: InboxMessage) {
  if (m.direction === "inbound") return null;
  if (m.author === "ana") return `${m.senderName || "Ana"} (IA)`;
  if (m.author === "automacao") return "Automação";
  return m.senderName || "Equipe";
}

export function AtendimentoPage({ initial, initialError }: { initial: InboxItem[]; initialError?: string }) {
  const [items, setItems] = useState(initial);
  const [listError, setListError] = useState(initialError);
  const [busca, setBusca] = useState("");
  const [filtro, setFiltro] = useState<"todas" | "naolidas" | "ana" | "equipe">("todas");
  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ConversationDetail | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [showPanel, setShowPanel] = useState(false);

  const refreshList = useCallback(async () => {
    const r = await loadInbox();
    setItems(r.items);
    setListError(r.error);
  }, []);

  const refreshDetail = useCallback(async (id: string) => {
    const r = await loadConversation(id);
    if ("error" in r) { setDetailError(r.error); return; }
    setDetailError(null);
    setDetail(r);
  }, []);

  useEffect(() => {
    const t = setInterval(refreshList, 8000);
    return () => clearInterval(t);
  }, [refreshList]);

  useEffect(() => {
    if (!openId) return;
    refreshDetail(openId);
    const t = setInterval(() => refreshDetail(openId), 5000);
    return () => clearInterval(t);
  }, [openId, refreshDetail]);

  const visiveis = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return items.filter((c) => {
      if (filtro === "naolidas" && c.unread === 0) return false;
      if (filtro === "ana" && c.aiPaused) return false;
      if (filtro === "equipe" && !c.aiPaused) return false;
      return !q || c.name.toLowerCase().includes(q) || c.phone.includes(q.replace(/\D/g, "") || "§");
    });
  }, [items, busca, filtro]);

  const abrir = (id: string) => {
    setOpenId(id);
    setDetail((d) => (d?.conversation.id === id ? d : null));
    setShowPanel(false);
    setItems((all) => all.map((c) => (c.id === id ? { ...c, unread: 0 } : c)));
  };

  const atual = detail && detail.conversation.id === openId ? detail : null;

  return (
    <div className="flex h-[calc(100dvh-11.5rem)] min-h-[460px] lg:h-[calc(100dvh-7.5rem)] overflow-hidden rounded-2xl border border-sand/80 bg-surface">
      {/* Lista */}
      <aside className={cn("flex w-full flex-col border-r border-sand/80 md:w-80 md:shrink-0", openId && "hidden md:flex")}>
        <div className="space-y-2 border-b border-sand/80 p-3">
          <h1 className="text-lg font-black">Atendimento</h1>
          <div className="flex items-center gap-2 rounded-xl bg-cream px-3 py-2">
            <Search className="h-4 w-4 text-ink/40" />
            <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar nome ou telefone" className="w-full bg-transparent text-sm outline-none" />
          </div>
          <div className="flex gap-1 text-xs font-bold">
            {([["todas", "Todas"], ["naolidas", "Não lidas"], ["ana", "Com a Ana"], ["equipe", "Com a equipe"]] as const).map(([k, l]) => (
              <button key={k} onClick={() => setFiltro(k)} className={cn("rounded-lg px-2 py-1", filtro === k ? "bg-forest text-white" : "bg-cream text-ink/60")}>{l}</button>
            ))}
          </div>
        </div>
        {listError && <p className="m-3 rounded-xl bg-red-500/10 p-3 text-sm text-red-500">{listError}</p>}
        <ul className="flex-1 overflow-y-auto">
          {visiveis.length === 0 && !listError && <li className="p-6 text-center text-sm text-ink/50">Nenhuma conversa ainda. Quando um cliente chamar no WhatsApp, aparece aqui.</li>}
          {visiveis.map((c) => (
            <li key={c.id}>
              <button onClick={() => abrir(c.id)} className={cn("flex w-full gap-3 border-b border-sand/50 px-3 py-3 text-left hover:bg-cream/60", openId === c.id && "bg-cream")}>
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-forest/10 font-black text-forest">{c.name.slice(0, 1).toUpperCase()}</div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate font-bold">{c.name}</p>
                    <span className="shrink-0 text-[11px] text-ink/45">{hora(c.lastAt)}</span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate text-sm text-ink/55">{c.preview || "—"}</p>
                    {c.unread > 0 && <span className="shrink-0 rounded-full bg-green-600 px-1.5 text-[11px] font-bold text-white">{c.unread}</span>}
                  </div>
                  <p className="mt-0.5 text-[11px] text-ink/45">{c.aiPaused ? `Com ${c.assignedName ?? "a equipe"}` : "Com a Ana (IA)"}{!c.clientId && " · sem cadastro"}</p>
                </div>
              </button>
            </li>
          ))}
        </ul>
      </aside>

      {/* Conversa */}
      <section className={cn("flex min-w-0 flex-1 flex-col", !openId && "hidden md:flex", showPanel && "hidden lg:flex")}>
        {!openId ? (
          <div className="m-auto max-w-xs text-center text-sm text-ink/50">Escolha uma conversa. O nome de quem respondeu aparece em cima de cada mensagem, e a ficha do cliente fica ao lado.</div>
        ) : !atual ? (
          <div className="m-auto text-sm text-ink/50">{detailError ?? "Carregando…"}</div>
        ) : (
          <Conversa key={atual.conversation.id} detail={atual} onBack={() => setOpenId(null)} onPanel={() => setShowPanel(true)} onChanged={() => { refreshDetail(atual.conversation.id); refreshList(); }} />
        )}
      </section>

      {/* Ficha do cliente */}
      {atual && (
        <aside className={cn("w-full flex-col overflow-y-auto border-l border-sand/80 bg-cream/30 lg:flex lg:w-[360px] lg:shrink-0", showPanel ? "flex" : "hidden")}>
          <div className="flex items-center gap-2 border-b border-sand/80 p-3 lg:hidden">
            <button onClick={() => setShowPanel(false)} className="rounded-lg p-1 hover:bg-cream"><ArrowLeft className="h-5 w-5" /></button>
            <p className="font-bold">Ficha do cliente</p>
          </div>
          <Ficha detail={atual} onChanged={() => { refreshDetail(atual.conversation.id); refreshList(); }} />
        </aside>
      )}
    </div>
  );
}

function Conversa({ detail, onBack, onPanel, onChanged }: { detail: ConversationDetail; onBack: () => void; onPanel: () => void; onChanged: () => void }) {
  const { conversation: c, messages } = detail;
  const [texto, setTexto] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, startEnvio] = useTransition();
  const [mudandoIa, startIa] = useTransition();
  const fim = useRef<HTMLDivElement>(null);
  const ultimo = messages.at(-1)?.id;

  useEffect(() => { fim.current?.scrollIntoView({ block: "end" }); }, [ultimo, c.id]);

  const enviar = () => {
    const t = texto.trim();
    if (!t || enviando) return;
    startEnvio(async () => {
      const r = await sendInboxMessage(c.id, t);
      if (r.error) setErro(r.error); else { setErro(null); setTexto(""); }
      onChanged();
    });
  };

  return (
    <>
      <header className="flex items-center gap-2 border-b border-sand/80 p-3">
        <button onClick={onBack} className="rounded-lg p-1 hover:bg-cream md:hidden"><ArrowLeft className="h-5 w-5" /></button>
        <div className="min-w-0 flex-1">
          <p className="truncate font-black">{c.name}</p>
          <p className="whitespace-nowrap text-xs text-ink/50">{formatBrPhone(c.phone)}</p>
        </div>
        <button
          disabled={mudandoIa}
          onClick={() => startIa(async () => { await setConversationAi(c.id, c.aiPaused); onChanged(); })}
          className={cn("flex items-center gap-1 rounded-xl px-3 py-2 text-xs font-bold", c.aiPaused ? "bg-cream text-ink/70" : "bg-forest text-white")}
          title={c.aiPaused ? "A Ana volta a responder este cliente" : "Você assume e a Ana para de responder"}
        >
          <Bot className="h-4 w-4" /> {c.aiPaused ? "Devolver p/ Ana" : "Assumir"}
        </button>
        <button onClick={onPanel} className="rounded-xl bg-cream px-3 py-2 text-xs font-bold lg:hidden">Ficha</button>
      </header>

      <div className="flex-1 space-y-2 overflow-y-auto bg-cream p-3">
        {messages.length === 0 && <p className="text-center text-sm text-ink/50">Sem mensagens.</p>}
        {messages.map((m) => {
          const nome = quemEnviou(m);
          const saida = m.direction === "outbound";
          return (
            <div key={m.id} className={cn("flex", saida ? "justify-end" : "justify-start")}>
              <div className={cn("max-w-[85%] rounded-2xl px-3 py-2 text-sm shadow-sm", saida ? "rounded-tr-sm bg-green-500/15" : "rounded-tl-sm bg-surface", m.failed && "ring-2 ring-red-400")}>
                {nome && <p className={cn("mb-0.5 text-xs font-black", m.author === "ana" ? "text-blue-400" : "text-forest")}>{nome}</p>}
                <Midia id={m.id} body={saida ? semAssinatura(m.body) : m.body} />
                {(saida ? semAssinatura(m.body) : m.body).replace(MIDIA, "") && <p className="whitespace-pre-wrap break-words"><Formatado text={(saida ? semAssinatura(m.body) : m.body).replace(MIDIA, "")} /></p>}
                <p className="mt-1 flex items-center justify-end gap-1 text-[10px] text-ink/45">
                  {hora(m.at)} {m.pending && "Aguardando envio…"} {saida && !m.failed && !m.pending && <CheckCheck className="h-3 w-3" />}
                </p>
                {m.failed && <p className="mt-1 flex items-start gap-1 text-[11px] text-red-500"><CircleAlert className="mt-0.5 h-3 w-3 shrink-0" /> Não enviada: {m.error}</p>}
              </div>
            </div>
          );
        })}
        <div ref={fim} />
      </div>

      <footer className="border-t border-sand/80 p-3">
        {!detail.windowOpen && <p className="mb-2 rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-500">Passaram 24h da última mensagem do cliente: pelo WhatsApp oficial, a mensagem pode não sair até ele responder.</p>}
        {!c.aiPaused && <p className="mb-2 text-xs text-ink/50">A Ana está respondendo. Ao enviar, você assume a conversa.</p>}
        {erro && <p className="mb-2 rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-500">{erro}</p>}
        <InboxAttachments conversationId={c.id} quotes={detail.panel?.orcamentos??[]} onChanged={onChanged}/>
        <div className="flex items-end gap-2">
          <textarea
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); enviar(); } }}
            rows={Math.min(5, Math.max(1, texto.split("\n").length))}
            placeholder="Escreva a mensagem (Enter envia, Shift+Enter pula linha)"
            className="field max-h-40 flex-1 resize-none"
          />
          <button onClick={enviar} disabled={enviando || !texto.trim()} className="rounded-xl bg-green-600 p-3 text-white disabled:opacity-50" aria-label="Enviar">
            <Send className="h-5 w-5" />
          </button>
        </div>
      </footer>
    </>
  );
}

function Ficha({ detail, onChanged }: { detail: ConversationDetail; onChanged: () => void }) {
  const { conversation: c, panel, triage } = detail;
  return (
    <div className="space-y-4 p-4">
      {panel ? <Cliente panel={panel} onChanged={onChanged} /> : <SemCadastro conversationId={c.id} sugestao={c.name} onChanged={onChanged} />}
      {triage && (
        <div className="card p-3">
          <p className="mb-1 flex items-center gap-1 text-xs font-black uppercase text-blue-400"><Bot className="h-4 w-4" /> Triagem da Ana</p>
          {triage.resumo && <p className="mb-2 whitespace-pre-wrap text-sm">{triage.resumo}</p>}
          <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
            {Object.entries(triage.dados).slice(0, 14).map(([k, v]) => (
              <div key={k} className="min-w-0"><dt className="text-ink/45">{k.replaceAll("_", " ")}</dt><dd className="truncate font-semibold">{typeof v === "boolean" ? (v ? "sim" : "não") : String(v)}</dd></div>
            ))}
          </dl>
        </div>
      )}
    </div>
  );
}

function SemCadastro({ conversationId, sugestao, onChanged }: { conversationId: string; sugestao: string; onChanged: () => void }) {
  const [nome, setNome] = useState(/\d{4}/.test(sugestao) ? "" : sugestao);
  const [busca, setBusca] = useState("");
  const [achados, setAchados] = useState<Array<{ id: string; name: string; phone: string | null }>>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    const t = setTimeout(async () => setAchados(busca.trim().length >= 2 ? await searchClientsForLink(busca) : []), 300);
    return () => clearTimeout(t);
  }, [busca]);

  return (
    <div className="space-y-3">
      <div className="card space-y-2 p-3">
        <p className="font-black">Contato sem cadastro</p>
        <p className="text-xs text-ink/55">Cadastre para ver orçamentos e financeiro aqui. O cliente novo já entra no pipeline.</p>
        <input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Nome do cliente" className="field w-full" />
        <button disabled={pending} onClick={() => start(async () => { const r = await createClientFromConversation(conversationId, nome); if (r.error) setErro(r.error); else onChanged(); })}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-forest px-3 py-2 text-sm font-bold text-white disabled:opacity-60">
          <UserPlus className="h-4 w-4" /> Cadastrar cliente
        </button>
      </div>
      <div className="card space-y-2 p-3">
        <p className="flex items-center gap-1 text-sm font-bold"><Link2 className="h-4 w-4" /> Já é cliente? Vincular</p>
        <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar por nome ou telefone" className="field w-full" />
        {achados.map((a) => (
          <button key={a.id} disabled={pending} onClick={() => start(async () => { const r = await linkConversationClient(conversationId, a.id); if (r.error) setErro(r.error); else onChanged(); })}
            className="block w-full rounded-lg px-2 py-1 text-left text-sm hover:bg-cream">
            <b>{a.name}</b> <span className="text-ink/50">{a.phone}</span>
          </button>
        ))}
      </div>
      {erro && <p className="rounded-lg bg-red-500/10 p-2 text-xs text-red-500">{erro}</p>}
    </div>
  );
}

function Cliente({ panel, onChanged }: { panel: ClientPanel; onChanged: () => void }) {
  const { client, resumo: r } = panel;
  const [receber, setReceber] = useState<string | null>(null);
  const [fechar, setFechar] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const abertas = panel.contas.filter((e) => e.aberto > 0);

  return (
    <div className="space-y-4">
      <div className="card p-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate text-lg font-black">{client.name}</p>
            <p className="text-xs text-ink/55">{[client.phone, client.city].filter(Boolean).join(" · ")}</p>
            {client.address && <p className="text-xs text-ink/55">{client.address}</p>}
          </div>
          <Link href={`/clientes/${client.id}`} className="shrink-0 text-xs font-bold text-forest">Ficha →</Link>
        </div>
        {panel.pipeline && (
          <p className="mt-2 rounded-lg bg-cream px-2 py-1 text-xs">
            Pipeline: <b>{panel.pipeline.etapa ?? "—"}</b>
            {panel.pipeline.valor ? ` · ${brl(Number(panel.pipeline.valor))}` : ""}
            {panel.pipeline.proximaAcao ? ` · ${panel.pipeline.proximaAcao}${panel.pipeline.data ? ` (${dataBr(panel.pipeline.data)})` : ""}` : ""}
          </p>
        )}
        {client.notes && <p className="mt-2 whitespace-pre-wrap text-xs text-ink/60">{client.notes}</p>}
      </div>

      <div className="grid grid-cols-3 gap-2 text-center">
        <Mini label="Orçamentos" value={String(r.feitos)} />
        <Mini label="Enviados" value={String(r.enviados)} />
        <Mini label="Fechados" value={String(r.fechados)} />
        <Mini label="Fechado" value={brl(r.valorFechado)} />
        <Mini label="Recebido" value={brl(r.recebido)} tone="ok" />
        <Mini label={r.vencido > 0 ? "Vencido" : "A receber"} value={brl(r.vencido > 0 ? r.vencido : r.aReceber)} tone={r.vencido > 0 ? "bad" : r.aReceber > 0 ? "warn" : undefined} />
      </div>

      {erro && <p className="rounded-lg bg-red-500/10 p-2 text-xs text-red-500">{erro}</p>}

      <div className="card p-3">
        <p className="mb-2 flex items-center gap-1 font-black"><Wallet className="h-4 w-4" /> Financeiro</p>
        {abertas.length === 0 && <p className="text-xs text-ink/50">Nada em aberto.</p>}
        <ul className="space-y-2">
          {abertas.map((e) => (
            <li key={e.id} className="rounded-xl border border-sand/80 bg-surface p-2">
              <div className="flex items-start justify-between gap-2 text-sm">
                <div className="min-w-0">
                  <p className="truncate font-semibold">{e.descricao}</p>
                  <p className={cn("text-xs", e.vencida ? "font-bold text-red-600" : "text-ink/55")}>Vence {dataBr(e.vencimento)}{e.vencida && " · vencida"}</p>
                </div>
                <div className="text-right">
                  <p className="font-black">{brl(e.aberto)}</p>
                  {e.pago > 0 && <p className="text-[11px] text-ink/50">pago {brl(e.pago)} de {brl(e.total)}</p>}
                </div>
              </div>
              {receber === e.id ? (
                <ReceberForm aberto={e.aberto} pending={pending} onCancel={() => setReceber(null)} onSubmit={(v) => start(async () => {
                  const res = await receiveFromInbox({ entryId: e.id, ...v });
                  if (res.error) setErro(res.error); else { setErro(null); setReceber(null); onChanged(); }
                })} />
              ) : (
                <button onClick={() => setReceber(e.id)} className="mt-2 w-full rounded-lg bg-brand-strong px-3 py-1.5 text-xs font-bold">Registrar pagamento</button>
              )}
            </li>
          ))}
        </ul>
        {panel.pagamentos.length > 0 && (
          <div className="mt-3">
            <p className="mb-1 text-xs font-bold text-ink/55">Últimos pagamentos</p>
            <ul className="space-y-1 text-xs">
              {panel.pagamentos.slice(0, 6).map((p, i) => (
                <li key={i} className="flex justify-between gap-2"><span className="truncate">{dataBr(p.data)} · {(p.forma ?? "").replaceAll("_", " ")}</span><b className="text-green-500">{brl(p.valor)}</b></li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <div className="card p-3">
        <div className="mb-2 flex items-center justify-between">
          <p className="font-black">Orçamentos</p>
          <div className="flex gap-2 text-xs font-bold text-forest">
            <Link href="/orcamentos/calhas">+ Calhas</Link>
            <Link href="/orcamentos/esquadrias">+ Esquadrias</Link>
          </div>
        </div>
        {panel.orcamentos.length === 0 && <p className="text-xs text-ink/50">Nenhum orçamento.</p>}
        <ul className="space-y-2">
          {panel.orcamentos.map((q) => (
            <li key={q.id} className="rounded-xl border border-sand/80 bg-surface p-2 text-sm">
              <div className="flex items-center justify-between gap-2">
                <Link href={`/orcamentos/${q.id}`} className="font-bold text-forest">{q.numero}</Link>
                <StatusBadge value={q.fechado ? "aprovado" : q.status} />
              </div>
              <div className="flex items-center justify-between text-xs text-ink/55">
                <span>{dataBr(q.data)}</span><b className="text-ink">{brl(q.total)}</b>
              </div>
              {!q.fechado && ["rascunho", "pendente", "enviado"].includes(q.status) && (
                fechar === q.id ? (
                  <FecharForm pending={pending} onCancel={() => setFechar(null)} onSubmit={(venc) => start(async () => {
                    const res = await closeQuoteFromInbox(q.id, venc);
                    if (res.error) setErro(res.error); else { setErro(null); setFechar(null); onChanged(); }
                  })} />
                ) : (
                  <button onClick={() => setFechar(q.id)} className="mt-2 w-full rounded-lg bg-forest px-3 py-1.5 text-xs font-bold text-white">Fechar venda</button>
                )
              )}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function Mini({ label, value, tone }: { label: string; value: string; tone?: "ok" | "warn" | "bad" }) {
  return (
    <div className="rounded-xl border border-sand/80 bg-surface p-2">
      <p className={cn("truncate text-sm font-black", tone === "ok" && "text-green-500", tone === "warn" && "text-amber-500", tone === "bad" && "text-red-600")}>{value}</p>
      <p className="text-[10px] uppercase text-ink/45">{label}</p>
    </div>
  );
}

const FORMAS: Array<[string, string]> = [["pix", "Pix"], ["dinheiro", "Dinheiro"], ["cartao_credito", "Cartão de crédito"], ["cartao_debito", "Cartão de débito"], ["transferencia", "Transferência"], ["boleto", "Boleto"], ["cheque", "Cheque"]];

function ReceberForm({ aberto, pending, onSubmit, onCancel }: { aberto: number; pending: boolean; onCancel: () => void; onSubmit: (v: { amount: number; discount: number; method: string; paidAt: string }) => void }) {
  const [desconto, setDesconto] = useState("0");
  const [valor, setValor] = useState(aberto.toFixed(2));
  const [forma, setForma] = useState("pix");
  const [data, setData] = useState(hojeISO());
  // Aceita "1.234,56", "1234,56" e "1234.56".
  const num = (s: string) => {
    const t = s.trim();
    return Number(t.includes(",") ? t.replace(/\./g, "").replace(",", ".") : t) || 0;
  };
  const saldo = Math.max(aberto - num(desconto), 0);
  return (
    <div className="mt-2 space-y-2 rounded-lg bg-cream/60 p-2 text-xs">
      <div className="grid grid-cols-2 gap-2">
        <label>Desconto (R$)<input inputMode="decimal" value={desconto} onChange={(e) => { setDesconto(e.target.value); setValor(Math.max(aberto - num(e.target.value), 0).toFixed(2)); }} className="field w-full" /></label>
        <label>Valor pago (R$)<input inputMode="decimal" value={valor} onChange={(e) => setValor(e.target.value)} className="field w-full" /></label>
        <label>Forma<select value={forma} onChange={(e) => setForma(e.target.value)} className="field w-full">{FORMAS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
        <label>Data<input type="date" value={data} onChange={(e) => setData(e.target.value)} className="field w-full" /></label>
      </div>
      <p className="text-ink/60">Saldo com desconto: <b>{brl(saldo)}</b>{num(valor) < saldo && ` · ficará em aberto ${brl(saldo - num(valor))}`}</p>
      <div className="flex gap-2">
        <button type="button" onClick={onCancel} className="flex-1 rounded-lg bg-surface px-2 py-1.5 font-bold"><X className="mx-auto h-4 w-4" /></button>
        <button type="button" disabled={pending || num(valor) <= 0} onClick={() => onSubmit({ amount: num(valor), discount: num(desconto), method: forma, paidAt: data })} className="flex-[3] rounded-lg bg-green-600 px-2 py-1.5 font-bold text-white disabled:opacity-50">
          {pending ? "Lançando…" : "Lançar no financeiro"}
        </button>
      </div>
    </div>
  );
}

function FecharForm({ pending, onSubmit, onCancel }: { pending: boolean; onCancel: () => void; onSubmit: (vencimento: string) => void }) {
  const [venc, setVenc] = useState(() => new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10));
  return (
    <div className="mt-2 space-y-2 rounded-lg bg-cream/60 p-2 text-xs">
      <p>Gera a venda, o pedido e a conta a receber no financeiro.</p>
      <label className="block">Vencimento<input type="date" value={venc} onChange={(e) => setVenc(e.target.value)} className="field w-full" /></label>
      <div className="flex gap-2">
        <button type="button" onClick={onCancel} className="flex-1 rounded-lg bg-surface px-2 py-1.5 font-bold">Cancelar</button>
        <button type="button" disabled={pending} onClick={() => onSubmit(venc)} className="flex-[2] rounded-lg bg-forest px-2 py-1.5 font-bold text-white disabled:opacity-50">{pending ? "Fechando…" : "Confirmar venda"}</button>
      </div>
    </div>
  );
}
