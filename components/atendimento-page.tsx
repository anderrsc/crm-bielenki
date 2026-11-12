"use client";
// Atendimento estilo Octadesk: conversas do WhatsApp, nome de quem respondeu em cima
// de cada mensagem e, ao lado, a ficha do cliente com orçamentos e financeiro.
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { InboxAttachments } from "@/components/inbox-attachments";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { Archive, ArchiveRestore, ArrowLeft, Bot, Check, CheckCheck, RefreshCw, CircleAlert, Link2, Search, Send, UserPlus, Wallet, X } from "lucide-react";
import {
  closeQuoteFromInbox, createClientFromConversation, linkConversationClient, loadConversation, loadInbox, loadOlderMessages, setConversationArchived,
  markInboxRead, syncInboxContacts, receiveFromInbox, searchClientsForLink, sendInboxMessage, setConversationAi,
  type ClientPanel, type ConversationDetail, type InboxItem, type InboxMessage,
} from "@/app/(crm)/atendimento-actions";
import { StatusBadge } from "@/components/status-badge";
import { cn } from "@/lib/utils";
import { formatBrPhone } from "@/lib/whatsapp/phone";
import { QuickReplies } from "@/components/quick-replies";
import { ReceivingAccountSelect } from "@/components/receiving-account-select";
import { PixCharge } from "@/components/pix-charge";
import { fillQuickReply, QUOTE_MESSAGE, quickReplyQuery } from "@/lib/quick-replies";

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
  if (m.author === "ana") return `${m.senderName || "Lia"} (IA)`;
  if (m.author === "automacao") return "Automação";
  return m.senderName || "Equipe";
}

export function AtendimentoPage({ initial, initialError }: { initial: InboxItem[]; initialError?: string }) {
  const [items, setItems] = useState(initial);
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const [listError, setListError] = useState(initialError);
  const [busca, setBusca] = useState("");
  const [filtro, setFiltro] = useState<"todas" | "naolidas" | "ana" | "equipe">("todas");
  const [verArquivadas, setVerArquivadas] = useState(false);
  // Conversas ja carregadas ficam guardadas: abrir de novo mostra na hora e atualiza por tras.
  const cache = useRef(new Map<string, ConversationDetail>());
  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ConversationDetail | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [showPanel, setShowPanel] = useState(false);

  const [companyId, setCompanyId] = useState<string>();
  const [aiActive, setAiActive] = useState(false);
  const [connection, setConnection] = useState("Conectando…");
  const [syncing, setSyncing] = useState(false);
  const selected = useRef(openId);
  selected.current = openId;
  const listVersion = useRef(0);
  const detailVersion = useRef(0);
  const refreshList = useCallback(async () => {
    const version = ++listVersion.current;
    const r = await loadInbox();
    if (version !== listVersion.current) return;
    if (!r.error) setItems(r.items);
    setListError(r.error);
    if (r.companyId) setCompanyId(r.companyId);
    setAiActive(r.aiActive === true);
  }, []);

  const refreshDetail = useCallback(async (id: string) => {
    const version = ++detailVersion.current;
    const r = await loadConversation(id);
    if (!("error" in r)) cache.current.set(id, r);
    if (selected.current !== id || version !== detailVersion.current) return;
    if ("error" in r) { setDetailError(r.error); return; }
    setDetailError(null);
    setDetail(r);
  }, []);

  // Pre-carrega as conversas do topo (so as mensagens): abrir fica instantaneo.
  const prefetching = useRef(false);
  useEffect(() => {
    if (prefetching.current) return;
    const fila = items.filter((c) => !c.archived && !cache.current.has(c.id)).slice(0, 10).map((c) => c.id);
    if (!fila.length) return;
    prefetching.current = true;
    const worker = async () => {
      for (let id = fila.shift(); id; id = fila.shift()) {
        if (document.visibilityState !== "visible") break;
        const r = await loadConversation(id, { panel: false }).catch(() => null);
        if (r && !("error" in r) && !cache.current.has(id)) cache.current.set(id, r);
      }
    };
    // Espera a tela assentar para nao disputar com abrir/enviar.
    const t = setTimeout(() => { void Promise.all([worker(), worker()]).finally(() => { prefetching.current = false; }); }, 1200);
    return () => { clearTimeout(t); prefetching.current = false; };
  }, [items]);

  // Tempo real conectado: nada de atualizar a cada 15s. Sem ele, a consulta periodica cobre.
  const live = useRef(false);
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState !== "visible") return;
      void refreshList();
      if (selected.current) void refreshDetail(selected.current);
    };
    if (!initial.length) refresh();
    const timer = setInterval(() => { if (!live.current) refresh(); }, 15000);
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("online", refresh);
    return () => { clearInterval(timer); document.removeEventListener("visibilitychange", refresh); window.removeEventListener("online", refresh); };
  }, [refreshList, refreshDetail]);

  useEffect(() => {
    if (openId) void refreshDetail(openId);
  }, [openId, refreshDetail]);

  useEffect(() => {
    if (!companyId) return;
    const db = createClient();
    let listTimer: ReturnType<typeof setTimeout> | undefined;
    let detailTimer: ReturnType<typeof setTimeout> | undefined;
    const listSoon = (ms = 400) => {
      clearTimeout(listTimer);
      listTimer = setTimeout(() => { if (document.visibilityState === "visible") void refreshList(); }, ms);
    };
    const detailSoon = (id: string) => {
      cache.current.delete(id);
      if (selected.current !== id) return;
      clearTimeout(detailTimer);
      detailTimer = setTimeout(() => { if (selected.current === id) void refreshDetail(id); }, 150);
    };
    type Row = Record<string, unknown>;
    // So o que mudou: a conversa alterada e corrigida na lista; mensagens recarregam so a conversa aberta.
    const onConversation = (p: { eventType: string; new: Row; old: Row }) => {
      const row = (p.eventType === "DELETE" ? p.old : p.new) as Row;
      const id = String(row?.id ?? "");
      if (!id) return listSoon();
      if (p.eventType === "DELETE") { setItems((prev) => prev.filter((c) => c.id !== id)); return; }
      const current = itemsRef.current.find((c) => c.id === id);
      // Conversa nova, cliente ligado/trocado: busca a lista (com nomes) uma vez.
      if (!current || current.clientId !== ((row.client_id as string | null) ?? null)) { listSoon(); return; }
      setItems((prev) => {
        const i = prev.findIndex((c) => c.id === id);
        if (i < 0) return prev;
        const next = [...prev];
        next[i] = {
          ...prev[i],
          preview: String(row.last_message_preview ?? prev[i].preview ?? ""),
          lastAt: (row.last_message_at as string | null) ?? prev[i].lastAt,
          unread: Number(row.unread_count ?? 0),
          aiPaused: !!row.ai_paused,
          archived: !!row.archived_at,
        };
        return next.sort((a, b) => (b.lastAt ?? "").localeCompare(a.lastAt ?? ""));
      });
    };
    const channel = db.channel(`atendimento:${companyId}`);
    channel.on("postgres_changes", { event: "*", schema: "public", table: "conversations", filter: `company_id=eq.${companyId}` }, (p) => onConversation(p as never));
    channel.on("postgres_changes", { event: "*", schema: "public", table: "messages", filter: `company_id=eq.${companyId}` }, (p) => {
      const row = ((p as { new?: Row; old?: Row }).new ?? (p as { old?: Row }).old ?? {}) as Row;
      if (row.conversation_id) detailSoon(String(row.conversation_id));
    });
    channel.on("postgres_changes", { event: "*", schema: "public", table: "clients", filter: `company_id=eq.${companyId}` }, () => listSoon(1500));
    let first = true;
    channel.subscribe(status => {
      live.current = status === "SUBSCRIBED";
      setConnection(status === "SUBSCRIBED" ? "Em tempo real" : "Reconectando · atualização a cada 15s");
      // Reconexao: pode ter perdido eventos, entao recarrega uma vez.
      if (status === "SUBSCRIBED") { if (!first) { listSoon(0); if (selected.current) detailSoon(selected.current); } first = false; }
    });
    return () => { clearTimeout(listTimer); clearTimeout(detailTimer); live.current = false; void db.removeChannel(channel); };
  }, [companyId, refreshList, refreshDetail]);

  const visiveis = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return items.filter((c) => {
      if (c.archived !== verArquivadas) return false;
      if (filtro === "naolidas" && c.unread === 0) return false;
      if (filtro === "ana" && (c.aiPaused || !aiActive)) return false;
      if (filtro === "equipe" && !c.aiPaused && aiActive) return false;
      return !q || c.name.toLowerCase().includes(q) || c.phone.includes(q.replace(/\D/g, "") || "§");
    });
  }, [items, busca, filtro, aiActive, verArquivadas]);
  const arquivadas = useMemo(() => items.filter((c) => c.archived), [items]);

  const abrir = (id: string) => {
    selected.current = id;
    setOpenId(id);
    setDetail((d) => (d?.conversation.id === id ? d : cache.current.get(id) ?? null));
    setDetailError(null);
    setShowPanel(false);

  };

  const atual = detail && detail.conversation.id === openId ? detail : null;

  return (
    <div className="mobile-inbox flex h-[calc(100dvh-11.5rem)] min-h-[460px] lg:h-[calc(100dvh-7.5rem)] overflow-hidden rounded-2xl border border-sand/80 bg-surface">
      {/* Lista */}
      <aside className={cn("flex w-full flex-col border-r border-sand/80 md:w-80 md:shrink-0", openId && "hidden md:flex")}>
        <div className="space-y-2 border-b border-sand/80 p-3">
          <div className="flex items-center justify-between"><h1 className="text-lg font-black">Atendimento</h1>
          <button aria-label="Sincronizar contatos" title="Sincronizar contatos" disabled={syncing} onClick={async () => {
            setSyncing(true);
            try { const r = await syncInboxContacts(); await refreshList(); if (r.error) setListError(r.error); }
            finally { setSyncing(false); }
          }} className="rounded-lg p-2 hover:bg-cream"><RefreshCw className={cn("h-4 w-4", syncing && "animate-spin")} /></button></div>
          <p className="text-[11px] text-ink/60">{connection} · {items.reduce((n, c) => n + c.unread, 0)} não lidas</p>
          {!aiActive && <p className="rounded-lg bg-amber-500/10 p-2 text-xs font-bold text-amber-700">IA pausada · atendimento pela equipe</p>}
          <div className="flex items-center gap-2 rounded-xl bg-cream px-3 py-2">
            <Search className="h-4 w-4 text-ink/40" />
            <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar nome ou telefone" className="w-full bg-transparent text-sm outline-none" />
          </div>
          <div className="flex gap-1 text-xs font-bold">
            {([["todas", "Todas"], ["naolidas", "Não lidas"], ["ana", "Com a Lia"], ["equipe", "Com a equipe"]] as const).map(([k, l]) => (
              <button key={k} onClick={() => setFiltro(k)} className={cn("rounded-lg px-2 py-1", filtro === k ? "bg-forest text-white" : "bg-cream text-ink/60")}>{l}</button>
            ))}
          </div>
        </div>
        {listError && <p className="m-3 rounded-xl bg-red-500/10 p-3 text-sm text-red-500">{listError}</p>}
        <ul className="flex-1 overflow-y-auto">
          {verArquivadas ? (
            <li><button onClick={() => setVerArquivadas(false)} className="flex w-full items-center gap-3 border-b border-sand/50 px-3 py-3 text-left font-bold hover:bg-cream/60"><ArrowLeft className="h-4 w-4" /> Arquivadas</button></li>
          ) : arquivadas.length > 0 && (
            <li><button onClick={() => setVerArquivadas(true)} className="flex w-full items-center gap-3 border-b border-sand/50 px-3 py-3 text-left hover:bg-cream/60">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center text-forest"><Archive className="h-5 w-5" /></span>
              <span className="flex-1 font-bold">Arquivadas</span>
              <span className="text-xs font-bold text-forest">{arquivadas.reduce((n, c) => n + c.unread, 0) || arquivadas.length}</span>
            </button></li>
          )}
          {visiveis.length === 0 && !listError && <li className="p-6 text-center text-sm text-ink/50">{verArquivadas ? "Nenhuma conversa arquivada." : "Nenhuma conversa ainda. Quando um cliente chamar no WhatsApp, aparece aqui."}</li>}
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
                  <p className="mt-0.5 text-[11px] text-ink/45">{c.aiPaused || !aiActive ? `Com ${c.assignedName ?? "a equipe"}` : "Com a Lia (IA)"}{!c.clientId && " · sem cadastro"}</p>
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
          <Conversa key={atual.conversation.id} detail={atual} aiActive={aiActive} visible={!showPanel} onBack={() => setOpenId(null)} onPanel={() => setShowPanel(true)} onChanged={() => { refreshDetail(atual.conversation.id); refreshList(); }} />
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

function Conversa({ detail, aiActive, visible, onBack, onPanel, onChanged }: { aiActive: boolean; visible: boolean; detail: ConversationDetail; onBack: () => void; onPanel: () => void; onChanged: () => void }) {
  const { conversation: c } = detail;
  // Historico antigo: carrega sozinho ao rolar para o topo.
  const [antigas, setAntigas] = useState<InboxMessage[]>([]);
  const [temAntigas, setTemAntigas] = useState(detail.hasOlder);
  const [carregandoAntigas, setCarregandoAntigas] = useState(false);
  const caixa = useRef<HTMLDivElement>(null);
  const messages = useMemo(() => {
    const ids = new Set(detail.messages.map((m) => m.id));
    return [...antigas.filter((m) => !ids.has(m.id)), ...detail.messages];
  }, [antigas, detail.messages]);
  const carregarAntigas = async () => {
    if (carregandoAntigas || !temAntigas || !messages.length) return;
    setCarregandoAntigas(true);
    const el = caixa.current; const altura = el?.scrollHeight ?? 0;
    const r = await loadOlderMessages(c.id, messages[0].at);
    setCarregandoAntigas(false);
    if ("error" in r) return;
    setAntigas((a) => [...r.messages, ...a]);
    setTemAntigas(r.hasOlder);
    requestAnimationFrame(() => { if (el) el.scrollTop += el.scrollHeight - altura; });
  };
  const [arquivando, startArquivo] = useTransition();
  const [texto, setTexto] = useState("");
  useEffect(() => { try { setTexto(sessionStorage.getItem(`inbox-draft:${detail.conversation.id}`) || ""); } catch {} }, [detail.conversation.id]);

  const [atalhos, setAtalhos] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, startEnvio] = useTransition();
  const [mudandoIa, startIa] = useTransition();
  const fim = useRef<HTMLDivElement>(null);
  const ultimo = messages.at(-1)?.id;

  const [atBottom, setAtBottom] = useState(true);
  const readBusy = useRef(false);
  const [readError, setReadError] = useState<string | null>(null);
  const readKey = useRef("");
  const changed = useRef(onChanged);
  changed.current = onChanged;
  useEffect(() => { if (atBottom) fim.current?.scrollIntoView({ block: "end" }); }, [ultimo, c.id, atBottom]);
  useEffect(() => {
    const read = async () => {
      if (!visible || !atBottom || document.visibilityState !== "visible" || readBusy.current) return;
      const inbound = messages.filter(m => m.direction === "inbound");
      if (!c.unread && !inbound.some(m => m.deliveryStatus !== "lida")) return;
      const key = `${c.id}:${ultimo}:${detail.readSnapshot.count}:${detail.readSnapshot.lastInbound}:${detail.readSnapshot.generation}`;
      if (readKey.current === key) return;
      readBusy.current = true;
      const r = await markInboxRead(c.id, inbound.map(m => m.id), detail.readSnapshot);
      readBusy.current = false;
      if (r.error) { setReadError(`Confirmação de leitura pendente: ${r.error}`); return; }
      readKey.current = key;
      setReadError(null);
      changed.current();
    };
    void read();
    document.addEventListener("visibilitychange", read);
    return () => document.removeEventListener("visibilitychange", read);
  }, [messages, c.id, c.unread, ultimo, detail.readSnapshot, visible, atBottom]);

  const enviar = () => {
    const t = texto.trim();
    if (!t || enviando) return;
    startEnvio(async () => {
      const r = await sendInboxMessage(c.id, t);
      if (r.error) setErro(r.error); else { setErro(r.warning ?? null); setTexto(""); try { sessionStorage.removeItem(`inbox-draft:${c.id}`); } catch {} }
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
          disabled={mudandoIa || (!aiActive && c.aiPaused)}
          onClick={() => startIa(async () => { const r = await setConversationAi(c.id, c.aiPaused); setErro(r.error ?? null); onChanged(); })}
          className={cn("flex items-center gap-1 rounded-xl px-3 py-2 text-xs font-bold", c.aiPaused ? "bg-cream text-ink/70" : "bg-forest text-white")}
          title={c.aiPaused ? "A Lia volta a responder este cliente" : "Você assume e a Lia para de responder"}
        >
          <Bot className="h-4 w-4" /> {c.aiPaused ? "Devolver p/ Lia" : "Assumir"}
        </button>
        <button
          disabled={arquivando}
          onClick={() => startArquivo(async () => { const r = await setConversationArchived(c.id, !c.archived); setErro(r.error ?? null); onChanged(); })}
          className="rounded-xl bg-cream p-2 text-ink/70 hover:text-forest"
          title={c.archived ? "Desarquivar conversa" : "Arquivar conversa"} aria-label={c.archived ? "Desarquivar conversa" : "Arquivar conversa"}
        >
          {c.archived ? <ArchiveRestore className="h-4 w-4" /> : <Archive className="h-4 w-4" />}
        </button>
        <button onClick={onPanel} className="rounded-xl bg-cream px-3 py-2 text-xs font-bold lg:hidden">Ficha</button>
      </header>

      <div ref={caixa} onScroll={e => { const el = e.currentTarget; setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 80); if (el.scrollTop < 150) void carregarAntigas(); }} className="flex-1 space-y-2 overflow-y-auto bg-cream p-3">
        {temAntigas && <p className="text-center text-xs text-ink/45">{carregandoAntigas ? "Carregando mensagens anteriores…" : <button onClick={() => void carregarAntigas()} className="underline">Mensagens anteriores</button>}</p>}
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
                  {hora(m.at)} {m.pending && "Aguardando envio…"} {saida && !m.failed && !m.pending && (m.deliveryStatus === "lida" || m.deliveryStatus === "entregue" ? <CheckCheck aria-label={m.deliveryStatus} className={cn("h-3 w-3", m.deliveryStatus === "lida" && "text-blue-500")} /> : <Check aria-label="Enviada" className="h-3 w-3" />)}
                </p>
                {m.failed && <p className="mt-1 flex items-start gap-1 text-[11px] text-red-500"><CircleAlert className="mt-0.5 h-3 w-3 shrink-0" /> Não enviada: {m.error}</p>}
              </div>
            </div>
          );
        })}
        <div ref={fim} />
      </div>

      {!atBottom && <button className="bg-surface py-2 text-xs font-bold text-forest" onClick={() => { setAtBottom(true); fim.current?.scrollIntoView({ block: "end" }); }}>Ir para mensagens recentes ↓</button>}
      <footer className="border-t border-sand/80 p-3">
        {!detail.windowOpen && <p className="mb-2 rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-500">Passaram 24h da última mensagem do cliente: pelo WhatsApp oficial, a mensagem pode não sair até ele responder.</p>}
        {readError && <p className="mb-2 text-xs text-amber-700">{readError}</p>}
        {aiActive && !c.aiPaused && <p className="mb-2 text-xs text-ink/50">A Lia está respondendo. Ao enviar, você assume a conversa.</p>}
        {erro && <p className="mb-2 rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-500">{erro}</p>}
        <InboxAttachments conversationId={c.id} quotes={detail.panel?.orcamentos??[]} onChanged={onChanged} onQuoteSent={()=>setTexto(fillQuickReply(QUOTE_MESSAGE, c.clientName || c.name))}/>
        <div className="flex items-end gap-2">
          <QuickReplies
            query={quickReplyQuery(texto)} open={atalhos} onOpen={() => setAtalhos(true)}
            onClose={() => { setAtalhos(false); if (quickReplyQuery(texto) !== null) setTexto(""); }}
            contactName={c.clientName || c.name} onPick={(t) => setTexto(t)}
          />
          <textarea
            value={texto}
            onChange={(e) => { setTexto(e.target.value); try { sessionStorage.setItem(`inbox-draft:${c.id}`, e.target.value); } catch {} }}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); if (quickReplyQuery(texto) === null) enviar(); } }}
            rows={Math.min(5, Math.max(1, texto.split("\n").length))}
            placeholder="Escreva a mensagem ou / para respostas prontas"
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
      {panel ? <Cliente panel={panel} conversationId={c.id} onChanged={onChanged} /> : <SemCadastro conversationId={c.id} sugestao={c.name} onChanged={onChanged} />}
      {triage && (
        <div className="card p-3">
          <p className="mb-1 flex items-center gap-1 text-xs font-black uppercase text-blue-400"><Bot className="h-4 w-4" /> Triagem da Lia</p>
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

function Cliente({ panel, conversationId, onChanged }: { panel: ClientPanel; conversationId: string; onChanged: () => void }) {
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
        <div className="mb-2"><PixCharge conversationId={conversationId} clientName={client.name} contas={panel.contas} orcamentos={panel.orcamentos} onSent={onChanged} /></div>
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

function ReceberForm({ aberto, pending, onSubmit, onCancel }: { aberto: number; pending: boolean; onCancel: () => void; onSubmit: (v: { amount: number; discount: number; method: string; paidAt: string; accountId?: string; notes?: string }) => void }) {
  const [conta, setConta] = useState("");
  const [obs, setObs] = useState("");
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
        <div className="col-span-2">Conta que recebeu<ReceivingAccountSelect name="conta" value={conta} onChange={setConta} /></div>
        <label className="col-span-2">Observação<input value={obs} onChange={(e) => setObs(e.target.value)} placeholder="Opcional" className="field w-full" /></label>
      </div>
      <p className="text-ink/60">Saldo com desconto: <b>{brl(saldo)}</b>{num(valor) < saldo && ` · ficará em aberto ${brl(saldo - num(valor))}`}</p>
      <div className="flex gap-2">
        <button type="button" onClick={onCancel} className="flex-1 rounded-lg bg-surface px-2 py-1.5 font-bold"><X className="mx-auto h-4 w-4" /></button>
        <button type="button" disabled={pending || num(valor) <= 0} onClick={() => onSubmit({ amount: num(valor), discount: num(desconto), method: forma, paidAt: data, accountId: conta || undefined, notes: obs || undefined })} className="flex-[3] rounded-lg bg-green-600 px-2 py-1.5 font-bold text-white disabled:opacity-50">
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
