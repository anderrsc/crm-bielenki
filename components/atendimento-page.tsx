"use client";
// Atendimento estilo Octadesk: conversas do WhatsApp, nome de quem respondeu em cima
// de cada mensagem e, ao lado, a ficha do cliente com orçamentos e financeiro.
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { InboxAttachments } from "@/components/inbox-attachments";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Archive, ArchiveRestore, ArrowLeft, ArrowRightLeft, Bot, StickyNote, Check, CheckCheck, RefreshCw, CircleAlert, Link2, Search, Send, UserPlus, Wallet, X, MoreVertical, Mail, MailOpen, MessageCircle, Phone, Plus, Pencil, Copy, MapPin, FileText, CalendarDays, Package, Coins, PanelRightOpen, ArrowDown, Reply, SlidersHorizontal } from "lucide-react";
import {
  closeQuoteFromInbox, createClientFromConversation, linkConversationClient, loadConversation, loadInbox, loadOlderMessages, setConversationArchived,
  addInboxNote, approveLiaSuggestion, discardLiaSuggestion, listInboxTeam, searchInboxHistory, setConversationStatus, transferConversation, markInboxRead, markConversationRead, markConversationUnread, syncInboxContacts, receiveFromInbox, searchClientsForLink, sendInboxMessage, setConversationAi,
  type ClientPanel, type ConversationDetail, type ConversationStatus, type InboxEvent, type InboxItem, type InboxMessage,
} from "@/app/(crm)/atendimento-actions";
import { StatusBadge } from "@/components/status-badge";
import { cn } from "@/lib/utils";
import { LabelChip, LabelMenu } from "@/components/conversation-labels";
import { waitingLabel, waitingSince } from "@/lib/inbox-waiting";
import { formatBrPhone } from "@/lib/whatsapp/phone";
import { QuickReplies } from "@/components/quick-replies";
import { ReceivingAccountSelect } from "@/components/receiving-account-select";
import { PixCharge } from "@/components/pix-charge";
import { fillQuickReply, QUOTE_MESSAGE, quickReplyQuery } from "@/lib/quick-replies";
import { inboxClock, inboxDay, inboxDayLabel, inboxListTime } from "@/lib/whatsapp/inbox-display";

const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const hora = inboxListTime;
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

export const STATUS_LABEL: Record<ConversationStatus, string> = { aberta: "Aberta", aguardando_cliente: "Aguardando cliente", resolvida: "Resolvida" };
export const SETORES: Array<[string, string]> = [["comercial", "Comercial"], ["pos_venda", "Pós-venda"], ["financeiro", "Financeiro"], ["producao", "Produção/Instalação"]];
const setorNome = (v: string | null) => SETORES.find(([k]) => k === v)?.[1] ?? null;

export function AtendimentoPage({ initial, initialError, initialOpen, initialNumero }: { initial: InboxItem[]; initialError?: string; initialOpen?: string; initialNumero?: string }) {
  const [items, setItems] = useState(initial);
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const [listError, setListError] = useState(initialError);
  const [busca, setBusca] = useState("");
  const [filtro, setFiltro] = useState<"todas" | "naolidas" | "lidas" | "semresposta" | "ana" | "equipe">("todas");
  // Relógio da lista: atualiza o "esperando há…" a cada minuto.
  const [agora, setAgora] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setAgora(Date.now()), 60_000); return () => clearInterval(t); }, []);
  const [verArquivadas, setVerArquivadas] = useState(false);
  // Conversas ja carregadas ficam guardadas: abrir de novo mostra na hora e atualiza por tras.
  const cache = useRef(new Map<string, ConversationDetail>());
  const [openId, setOpenId] = useState<string | null>(initialOpen ?? null);
  const [status, setStatus] = useState<"" | ConversationStatus>("");
  // Vindo de "Ver conversas" na tela de números: já abre filtrado naquele número.
  const [numero, setNumero] = useState(initialNumero && /^[0-9a-f-]{36}$/i.test(initialNumero) ? initialNumero : "");
  const [etiqueta, setEtiqueta] = useState("");
  const [setor, setSetor] = useState("");
  const [filtrosAbertos, setFiltrosAbertos] = useState(false);
  const [historico, setHistorico] = useState<Array<{ conversationId: string; snippet: string; at: string }> | null>(null);
  const [buscandoHistorico, startHistorico] = useTransition();
  const [detail, setDetail] = useState<ConversationDetail | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [showPanel, setShowPanel] = useState(false);

  const [companyId, setCompanyId] = useState<string>();
  const [aiActive, setAiActive] = useState(false);
  const [provider, setProvider] = useState<"meta" | "evolution">();
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
    if (r.provider) setProvider(r.provider);
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
    refresh();
    // A assinatura pode continuar conectada e perder um evento: reconcilia também nesse caso.
    let ticks = 0;
    const timer = setInterval(() => { if (!live.current || ++ticks % 2 === 0) refresh(); }, 15000);
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("online", refresh);
    window.addEventListener("focus", refresh);
    return () => { clearInterval(timer); document.removeEventListener("visibilitychange", refresh); window.removeEventListener("online", refresh); window.removeEventListener("focus", refresh); };
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
      if (!current || current.clientId !== ((row.client_id as string | null) ?? null) || current.assignedTo !== ((row.assigned_to as string | null) ?? null)) { listSoon(); if (selected.current === id) detailSoon(id); return; }
      // Transferência de setor ou troca de status na conversa aberta: mostra no histórico.
      if (selected.current === id && (current.status !== (row.status ?? "aberta") || current.department !== ((row.department as string | null) ?? null))) detailSoon(id);
      // Conversa aberta voltou a ter não lidas (mensagem nova ou corrida com o webhook):
      // recarrega a conversa para a leitura ser confirmada de novo com o estado atual.
      if (selected.current === id && Number(row.unread_count ?? 0) > 0) detailSoon(id);
      // A Lia deixou (ou trocou) uma sugestão na conversa aberta.
      else if (selected.current === id && row.ai_suggestion) detailSoon(id);
      setItems((prev) => {
        const i = prev.findIndex((c) => c.id === id);
        if (i < 0) return prev;
        const next = [...prev];
        next[i] = {
          ...prev[i],
          preview: String(row.last_message_preview ?? prev[i].preview ?? ""),
          lastAt: (row.last_message_at as string | null) ?? prev[i].lastAt,
          waitingSince: "last_inbound_at" in row ? waitingSince(row.last_inbound_at as string | null, (row.last_message_at as string | null) ?? prev[i].lastAt) : prev[i].waitingSince,
          unread: Number(row.unread_count ?? 0),
          aiPaused: !!row.ai_paused,
          archived: !!row.archived_at,
          status: row.status === "aguardando_cliente" || row.status === "resolvida" ? row.status : "aberta",
          department: (row.department as string | null | undefined) ?? null,
          assignedTo: (row.assigned_to as string | null | undefined) ?? null,
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

  const totalNaoLidas = useMemo(() => items.filter((c) => !c.archived && c.unread > 0).length, [items]);
  const totalSemResposta = useMemo(() => items.filter((c) => !c.archived && c.waitingSince && c.status !== "resolvida").length, [items]);
  const visiveis = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return items.filter((c) => {
      if (c.archived !== verArquivadas) return false;
      if (filtro === "naolidas" && c.unread === 0) return false;
      if (filtro === "lidas" && c.unread > 0) return false;
      if (filtro === "semresposta" && (!c.waitingSince || c.status === "resolvida")) return false;
      if (filtro === "ana" && (c.aiPaused || !aiActive || c.channelAi === false)) return false;
      if (filtro === "equipe" && !c.aiPaused && aiActive && c.channelAi !== false) return false;
      if (status && c.status !== status) return false;
      if (setor && c.department !== setor) return false;
      if (numero && c.channelId !== numero) return false;
      if (etiqueta && !(c.labels ?? []).some((l) => l.id === etiqueta)) return false;
      return !q || c.name.toLowerCase().includes(q) || c.phone.includes(q.replace(/\D/g, "") || "§");
    });
  }, [items, busca, filtro, aiActive, verArquivadas, status, setor, numero, etiqueta]);
  // Etiquetas em uso na lista (para o filtro).
  const etiquetas = useMemo(() => [...new Map(items.flatMap((c) => c.labels ?? []).map((l) => [l.id, l])).values()].sort((a, b) => a.name.localeCompare(b.name)), [items]);
  // Números de WhatsApp presentes na lista (só mostra o filtro quando há mais de um).
  const numeros = useMemo(() => [...new Map(items.filter((c) => c.channelId).map((c) => [c.channelId as string, c.channelName ?? "WhatsApp"])).entries()], [items]);
  const numeroCards = useMemo(() => [...new Map(items.filter((c) => c.channelId).map((c) => [c.channelId as string, { name: c.channelName ?? "WhatsApp", phone: c.channelPhone ?? "" }])).entries()], [items]);
  const arquivadas = useMemo(() => items.filter((c) => c.archived), [items]);

  const abrir = (id: string) => {
    selected.current = id;
    setOpenId(id);
    setDetail((d) => (d?.conversation.id === id ? d : cache.current.get(id) ?? null));
    setDetailError(null);
    setShowPanel(false);

  };

  const atual = detail && detail.conversation.id === openId ? detail : null;
  const [organizing, setOrganizing] = useState<string | null>(null);
  const organizar = async (c: InboxItem, unread: boolean) => {
    if (unread && selected.current === c.id) { selected.current = null; setOpenId(null); setDetail(null); }
    setOrganizing(c.id);
    try {
      const r = unread ? await markConversationUnread(c.id) : await markConversationRead(c.id);
      if (r.error) setListError(r.error);
      else {
        setItems(prev => prev.map(item => item.id === c.id ? { ...item, unread: unread ? Math.max(1, item.unread) : item.unread } : item));
        await refreshList();
        const warning = "warning" in r ? r.warning : "receiptError" in r ? r.receiptError : null;
        if (warning) setListError(String(warning));
      }
      cache.current.delete(c.id);
      if (selected.current === c.id) await refreshDetail(c.id);
    } finally { setOrganizing(null); }
  };

  return (
    <div className="wa-inbox mobile-inbox flex h-[calc(100dvh-11.5rem)] min-h-[460px] lg:h-[calc(100dvh-7.5rem)] overflow-hidden rounded-2xl border">
      {/* Lista */}
      <aside className={cn("wa-line flex w-full flex-col border-r md:w-[320px] md:shrink-0 xl:w-[360px]", openId && "hidden md:flex")}>
        <div className="wa-list-head space-y-3 p-3">
          <div className="flex items-center gap-3">
            <span className="wa-logo" aria-hidden><MessageCircle className="h-6 w-6" /></span>
            <div className="min-w-0 flex-1"><h1 className="text-[20px] font-bold leading-tight">WhatsApp</h1><p className="wa-muted truncate text-xs">Central de atendimento integrada ao CRM</p></div>
            <button aria-label="Sincronizar mensagens e contatos" title="Sincronizar mensagens e contatos" disabled={syncing} onClick={async () => {
              setSyncing(true);
              try { const r = await syncInboxContacts(); await refreshList(); if (selected.current) await refreshDetail(selected.current); if (r.error) setListError(r.error); }
              finally { setSyncing(false); }
            }} className="wa-row rounded-full p-2"><RefreshCw className={cn("h-4 w-4", syncing && "animate-spin")} /></button>
          </div>
          <p className="wa-muted flex items-center justify-between text-[11px]"><span>{connection}</span><Link href="/atendimento/canais" className="font-bold underline">Gerenciar números</Link></p>
          {!aiActive && <p className="rounded-lg bg-amber-500/10 p-2 text-xs font-bold text-amber-700">IA pausada · atendimento pela equipe</p>}
          {numeroCards.length > 0 && (
            <div className="wa-numbers flex gap-2 overflow-x-auto" role="group" aria-label="Números de WhatsApp">
              {numeroCards.map(([k, n]) => (
                <button key={k} type="button" onClick={() => setNumero(numero === k ? "" : k)} aria-pressed={numero === k} className="wa-number">
                  <span className="block truncate text-[14px] font-bold">{n.name}</span>
                  <span className="wa-muted flex items-center gap-1.5 text-[13px]"><span className="truncate">{n.phone || "Conectado"}</span><i className="wa-dot" aria-hidden /></span>
                </button>
              ))}
              <Link href="/atendimento/canais" aria-label="Adicionar ou gerenciar números" className="wa-number wa-number-add"><Plus className="h-5 w-5" /></Link>
            </div>
          )}
          <div className="wa-chips flex gap-2 overflow-x-auto pb-0.5 text-[14px] font-medium">
            {([["todas", "Todas", items.filter((c) => !c.archived).length], ["naolidas", "Não lidas", totalNaoLidas], ["semresposta", "Sem resposta", totalSemResposta], ["ana", "Lia", 0], ["equipe", "Equipe", 0], ["lidas", "Lidas", 0]] as const).map(([k, l, n]) => (
              <button key={k} onClick={() => setFiltro(k)} aria-pressed={filtro === k} className="wa-chip shrink-0 rounded-full px-3.5 py-1.5">{l}{n > 0 && " "}{n > 0 && <span className="wa-chip-count">{n}</span>}</button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <div className="wa-search flex min-w-0 flex-1 items-center gap-3 rounded-xl px-3 py-2.5">
              <Search className="wa-muted h-4 w-4" />
              <input value={busca} onChange={(e) => { setBusca(e.target.value); setHistorico(null); }} placeholder="Buscar conversas…" aria-label="Pesquisar conversas" className="w-full bg-transparent text-sm outline-none" />
            </div>
            <button type="button" onClick={() => setFiltrosAbertos(v => !v)} aria-expanded={filtrosAbertos} aria-controls="wa-filtros" aria-label="Filtros" className="wa-search wa-filter-toggle relative flex h-11 w-11 shrink-0 items-center justify-center rounded-xl md:hidden">
              <SlidersHorizontal className="h-4 w-4" />
              {[status, setor, etiqueta, numero].filter(Boolean).length > 0 && <span className="wa-badge absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-bold">{[status, setor, etiqueta, numero].filter(Boolean).length}</span>}
            </button>
          </div>
          {busca.trim().length >= 3 && (
            <button disabled={buscandoHistorico} onClick={() => startHistorico(async () => setHistorico((await searchInboxHistory(busca)).results))} className="text-xs font-bold" style={{ color: "var(--wa-green)" }}>
              {buscandoHistorico ? "Buscando nas mensagens…" : `Buscar "${busca.trim()}" no texto das mensagens`}
            </button>
          )}
          <div id="wa-filtros" className={cn("flex flex-wrap gap-2 md:flex-nowrap", !filtrosAbertos && "hidden md:flex")}>
            <select value={status} onChange={(e) => setStatus(e.target.value as "" | ConversationStatus)} className="wa-search min-w-0 flex-1 rounded-lg px-2 py-1.5 text-xs outline-none" aria-label="Status">
              <option value="">Todos os status</option>
              {Object.entries(STATUS_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
            <select value={setor} onChange={(e) => setSetor(e.target.value)} className="wa-search min-w-0 flex-1 rounded-lg px-2 py-1.5 text-xs outline-none" aria-label="Setor">
              <option value="">Todos os setores</option>
              {SETORES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
            {etiquetas.length > 0 && (
              <select value={etiqueta} onChange={(e) => setEtiqueta(e.target.value)} className="wa-search min-w-0 flex-1 rounded-lg px-2 py-1.5 text-xs outline-none" aria-label="Etiqueta">
                <option value="">Todas as etiquetas</option>
                {etiquetas.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
            )}
            {(numeros.length > 1 || numero) && (
              <select value={numero} onChange={(e) => setNumero(e.target.value)} className="wa-search min-w-0 flex-1 rounded-lg px-2 py-1.5 text-xs outline-none" aria-label="Número">
                <option value="">Todos os números</option>
                {numeros.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
            )}
          </div>
        </div>
        {listError && <p className="m-3 rounded-xl bg-red-500/10 p-3 text-sm text-red-500">{listError}</p>}
        <ul className="flex-1 overflow-y-auto">
          {historico && (
            <li className="wa-line border-b p-2">
              <div className="flex items-center justify-between px-1"><p className="text-xs font-bold">Nas mensagens ({historico.length})</p><button onClick={() => setHistorico(null)} aria-label="Fechar busca"><X className="h-4 w-4" /></button></div>
              {historico.length === 0 && <p className="wa-muted p-2 text-xs">Nada encontrado no histórico.</p>}
              {historico.map(h => {
                const conv = items.find(i => i.id === h.conversationId);
                return (
                  <button key={h.conversationId} onClick={() => abrir(h.conversationId)} className="wa-row block w-full rounded-lg px-2 py-1.5 text-left">
                    <p className="truncate text-sm font-bold">{conv?.name ?? "Conversa"} <span suppressHydrationWarning className="wa-muted text-[11px] font-normal">{hora(h.at, new Date(agora))}</span></p>
                    <p className="wa-muted truncate text-xs">{h.snippet}</p>
                  </button>
                );
              })}
            </li>
          )}
          {verArquivadas ? (
            <li><button onClick={() => setVerArquivadas(false)} className="wa-row flex w-full items-center gap-3 px-4 py-3 text-left font-bold"><ArrowLeft className="h-4 w-4" /> Arquivadas</button></li>
          ) : arquivadas.length > 0 && (
            <li><button onClick={() => setVerArquivadas(true)} className="wa-row flex w-full items-center gap-3 px-4 py-3 text-left">
              <span className="flex h-12 w-12 shrink-0 items-center justify-center" style={{ color: "var(--wa-green)" }}><Archive className="h-5 w-5" /></span>
              <span className="flex-1 font-medium">Arquivadas</span>
              <span className="text-xs font-bold" style={{ color: "var(--wa-green)" }}>{arquivadas.reduce((n, c) => n + c.unread, 0) || arquivadas.length}</span>
            </button></li>
          )}
          {visiveis.length === 0 && !listError && <li className="wa-muted p-8 text-center text-sm">{busca ? "Nenhuma conversa encontrada." : verArquivadas ? "Nenhuma conversa arquivada." : filtro === "naolidas" ? "Você está em dia. Nenhuma conversa não lida." : filtro === "lidas" ? "Nenhuma conversa lida neste filtro." : filtro === "semresposta" ? "Nenhum cliente esperando resposta." : "Quando um cliente chamar no WhatsApp, a conversa aparece aqui."}</li>}
          {visiveis.map((c) => (
            <li key={c.id} className="group relative">
              <button onClick={() => abrir(c.id)} aria-current={openId === c.id} className="wa-row flex w-full items-center gap-3 px-3 text-left">
                <div className="wa-avatar flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-lg font-medium">{c.name.slice(0, 1).toUpperCase()}</div>
                <div className="wa-line min-w-0 flex-1 border-b py-3 pr-6">
                  <div className="flex items-center justify-between gap-2">
                    <p className={cn("truncate text-[15px]", c.unread > 0 ? "font-bold" : "font-medium")}>{c.name}</p>
                    <span suppressHydrationWarning className={cn("shrink-0 text-xs", c.unread > 0 ? "wa-unread-time" : "wa-muted")}>{hora(c.lastAt, new Date(agora))}</span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <p className="wa-muted truncate text-sm">{c.preview || "—"}</p>
                    {(() => { const espera = !c.archived && c.status !== "resolvida" && c.waitingSince ? waitingLabel(c.waitingSince, agora) : null;
                      return espera ? <span suppressHydrationWarning title="Cliente esperando resposta" className={cn("shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-bold", /h|dia/.test(espera) ? "bg-red-500/15 text-red-500" : "bg-amber-500/15 text-amber-600")}>{espera}</span> : null; })()}
                    {c.unread > 0 && <span className="wa-badge flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full px-1.5 text-[11px] font-bold">{c.unread}</span>}
                  </div>
                  {(c.labels?.length ?? 0) > 0 && <div className="mt-0.5 flex flex-wrap gap-1">{c.labels!.map((l) => <LabelChip key={l.id} label={l} />)}</div>}
                  {(numeros.length > 1 && c.channelName) || (!c.aiPaused && aiActive && c.channelAi !== false) || c.assignedName || c.department || c.status !== "aberta" ? <p className="mt-0.5 text-[10px] font-bold uppercase tracking-wide" style={{ color: "var(--wa-green)" }}>{[numeros.length > 1 ? c.channelName : null, !c.aiPaused && aiActive && c.channelAi !== false ? "Lia" : c.assignedName, setorNome(c.department), c.status !== "aberta" ? STATUS_LABEL[c.status] : null].filter(Boolean).join(" · ")}</p> : null}
                </div>
              </button>
              <DropdownMenu.Root>
                <DropdownMenu.Trigger asChild><button aria-label={`Opções da conversa com ${c.name}`} disabled={organizing === c.id} className="wa-muted wa-row absolute right-1 top-6 rounded-full p-1.5 opacity-70 md:opacity-0 md:group-hover:opacity-100 md:focus:opacity-100 data-[state=open]:opacity-100"><MoreVertical className="h-4 w-4" /></button></DropdownMenu.Trigger>
                <DropdownMenu.Portal><DropdownMenu.Content align="end" sideOffset={4} className="z-50 min-w-52 rounded-xl border border-sand bg-surface p-1.5 text-sm text-ink shadow-xl">
                  <DropdownMenu.Item onSelect={() => void organizar(c, c.unread === 0)} className="flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 outline-none focus:bg-cream">{c.unread > 0 ? <MailOpen className="h-4 w-4" /> : <Mail className="h-4 w-4" />}{c.unread > 0 ? "Marcar como lida" : "Marcar como não lida"}</DropdownMenu.Item>
                  <DropdownMenu.Item onSelect={() => void setConversationArchived(c.id, !c.archived).then(r => { if (r.error) setListError(r.error); else void refreshList(); })} className="flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 outline-none focus:bg-cream"><Archive className="h-4 w-4" />{c.archived ? "Desarquivar conversa" : "Arquivar conversa"}</DropdownMenu.Item>
                </DropdownMenu.Content></DropdownMenu.Portal>
              </DropdownMenu.Root>
            </li>
          ))}
        </ul>
      </aside>

      {/* Conversa */}
      <section data-chat-open={openId ? "true" : undefined} className={cn("flex min-w-0 flex-1 flex-col", !openId && "hidden md:flex", showPanel && "hidden xl:flex")}>
        {!openId ? (
          <div className="wa-head m-auto flex h-full w-full flex-col items-center justify-center gap-4 border-b-4 px-6 text-center" style={{ borderColor: "var(--wa-green)" }}><span className="wa-avatar flex h-24 w-24 items-center justify-center rounded-full"><MessageCircle className="h-12 w-12" strokeWidth={1.25} /></span><p className="text-[28px] font-light">Atendimento Marquinhos</p><p className="wa-muted max-w-sm text-sm leading-6">Suas conversas do WhatsApp, organizadas em um só lugar. Escolha um contato para conversar ou acompanhar o atendimento.</p></div>
        ) : !atual ? (
          <div className="m-auto text-sm text-ink/50">{detailError ?? "Carregando…"}</div>
        ) : (
          <Conversa key={atual.conversation.id} detail={atual} aiActive={aiActive} officialWindow={provider === "meta"} visible={!showPanel} onBack={() => setOpenId(null)} labels={items.find((i) => i.id === atual.conversation.id)?.labels ?? []} onUnread={() => void organizar(atual.conversation, true)} onPanel={() => setShowPanel(v => !v)} onChanged={() => { refreshDetail(atual.conversation.id); refreshList(); }} />
        )}
      </section>

      {/* Ficha do cliente */}
      {atual && showPanel && (
        <aside className="wa-line flex w-full flex-col overflow-y-auto border-l bg-surface text-ink xl:w-[320px] xl:shrink-0">
          <div className="flex items-center gap-2 border-b border-sand/80 p-3">
            <button aria-label="Fechar ficha do cliente" onClick={() => setShowPanel(false)} className="rounded-lg p-1 hover:bg-cream"><X className="h-5 w-5" /></button>
            <p className="font-bold">Ficha do cliente</p>
          </div>
          <Ficha detail={atual} onChanged={() => { refreshDetail(atual.conversation.id); refreshList(); }} />
        </aside>
      )}
    </div>
  );
}

function Conversa({ detail, aiActive, officialWindow, visible, labels, onBack, onUnread, onPanel, onChanged }: { labels: Array<{ id: string; name: string; color: string }>; aiActive: boolean; officialWindow: boolean; visible: boolean; detail: ConversationDetail; onBack: () => void; onUnread: () => void; onPanel: () => void; onChanged: () => void }) {
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
  const [sugerindo, startSugestao] = useTransition();
  const [modoNota, setModoNota] = useState(false);
  // Mensagem que está sendo respondida (citação, como o "Responder" do WhatsApp).
  const [respondendo, setRespondendo] = useState<InboxMessage | null>(null);
  useEffect(() => { setRespondendo(null); }, [c.id]);
  const [transferir, setTransferir] = useState(false);
  const [mudandoStatus, startStatus] = useTransition();
  const mudarStatus = (v: ConversationStatus) => startStatus(async () => { const r = await setConversationStatus(c.id, v); setErro(r.error ?? null); onChanged(); });
  const fim = useRef<HTMLDivElement>(null);
  const ultimo = messages.at(-1)?.id;
  const [pesquisando, setPesquisando] = useState(false);
  const [buscaMensagem, setBuscaMensagem] = useState("");
  const termo = buscaMensagem.trim().toLocaleLowerCase("pt-BR");
  const exibidas = useMemo(() => termo ? messages.filter(m => m.body.toLocaleLowerCase("pt-BR").includes(termo)) : messages, [messages, termo]);
  const primeiraNaoLida = useRef(c.unread > 0 ? messages.filter(m => m.direction === "inbound").slice(-c.unread)[0]?.id : null);

  const [atBottom, setAtBottom] = useState(true);
  const readBusy = useRef(false);
  const [readError, setReadError] = useState<string | null>(null);
  const [readRetry, setReadRetry] = useState(0);
  const readKey = useRef("");
  const changed = useRef(onChanged);
  changed.current = onChanged;
  useEffect(() => { if (atBottom) fim.current?.scrollIntoView({ block: "end" }); }, [ultimo, c.id, atBottom]);
  useEffect(() => {
    const read = async () => {
      if (!visible || !atBottom || termo || document.visibilityState !== "visible" || readBusy.current) return;
      const inbound = messages.filter(m => m.direction === "inbound").slice(-200);
      if (!c.unread && !inbound.some(m => m.deliveryStatus !== "lida")) return;
      const key = `${c.id}:${ultimo}:${detail.readSnapshot.count}:${detail.readSnapshot.lastInbound}:${detail.readSnapshot.generation}`;
      if (readKey.current === key) return;
      readBusy.current = true;
      const r = await markInboxRead(c.id, inbound.map(m => m.id), detail.readSnapshot);
      readBusy.current = false;
      if (r.error) { setReadError(`Confirmação de leitura pendente: ${r.error}`); return; }
      readKey.current = key;
      setReadError(r.receiptError ? "Lida no Atendimento. A confirmação de leitura no WhatsApp está pendente." : null);
      changed.current();
    };
    void read();
    document.addEventListener("visibilitychange", read);
    return () => document.removeEventListener("visibilitychange", read);
  }, [messages, c.id, c.unread, ultimo, detail.readSnapshot, visible, atBottom, termo, readRetry]);

  const enviar = () => {
    const t = texto.trim();
    if (!t || enviando) return;
    startEnvio(async () => {
      const r: { error?: string; warning?: string } = modoNota ? await addInboxNote(c.id, t) : await sendInboxMessage(c.id, t, { clientRef: crypto.randomUUID(), replyTo: respondendo?.id });
      if (r.error) setErro(r.error); else { setErro(r.warning ?? null); setTexto(""); if (!modoNota) setRespondendo(null); try { sessionStorage.removeItem(`inbox-draft:${c.id}`); } catch {} }
      onChanged();
    });
  };

  return (
    <>
      <header className="wa-head wa-chat-head flex items-center gap-1.5 px-2 py-2 sm:gap-3 sm:px-3">
        <button onClick={onBack} className="wa-row rounded-full p-1.5 md:hidden" aria-label="Voltar"><ArrowLeft className="h-6 w-6" /></button>
        <button onClick={onPanel} className="flex min-w-0 flex-1 items-center gap-3 text-left" title="Ficha do cliente">
          <span className="wa-avatar flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-lg font-medium">{c.name.slice(0, 1).toUpperCase()}</span>
          <span className="min-w-0">
            <span className="block truncate text-[17px] font-bold leading-tight">{c.name}</span>
            <span className="wa-muted block truncate text-[13px]">{formatBrPhone(c.phone)}{!aiActive || c.aiPaused ? ` · com ${c.assignedName ?? "a equipe"}` : " · Lia respondendo"}</span>
          </span>
        </button>
        <button
          disabled={mudandoIa || (!aiActive && c.aiPaused)}
          onClick={() => startIa(async () => { const r = await setConversationAi(c.id, c.aiPaused); setErro(r.error ?? null); onChanged(); })}
          className={cn("hidden items-center gap-1 rounded-full px-3 py-1.5 text-xs font-bold md:flex", c.aiPaused ? "wa-chip" : "wa-send")}
          title={c.aiPaused ? "A Lia volta a responder este cliente" : "Você assume e a Lia para de responder"}
        >
          <Bot className="h-4 w-4" /> <span className="hidden sm:inline">{c.aiPaused ? "Devolver p/ Lia" : "Assumir"}</span>
        </button>
        <select value={c.status} disabled={mudandoStatus} aria-label="Status da conversa" onChange={(e) => mudarStatus(e.target.value as ConversationStatus)}
          className="wa-chip hidden rounded-full px-2 py-1.5 text-xs font-bold lg:block">
          {Object.entries(STATUS_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        <LabelMenu conversationId={c.id} current={labels} onChanged={onChanged} />
        {c.phone && !c.phone.includes("@") && <a href={`tel:+${c.phone.replace(/\D/g, "")}`} className="wa-row wa-muted rounded-full p-2" title="Ligar" aria-label={`Ligar para ${c.name}`}><Phone className="h-5 w-5" /></a>}
<div className="hidden items-center gap-0.5 md:flex">
        <button onClick={() => setTransferir(v => !v)} className="wa-row wa-muted rounded-full p-2" title="Transferir conversa" aria-label="Transferir conversa"><ArrowRightLeft className="h-4 w-4" /></button>
        <button aria-label="Pesquisar nesta conversa" title="Pesquisar nesta conversa" onClick={() => { setPesquisando(v => !v); setBuscaMensagem(""); }} className="wa-row wa-muted rounded-full p-2"><Search className="h-4 w-4" /></button>
        <button aria-label="Marcar como não lida" title="Marcar como não lida" onClick={onUnread} className="wa-row wa-muted rounded-full p-2"><Mail className="h-4 w-4" /></button>
        <button
          disabled={arquivando}
          onClick={() => startArquivo(async () => { const r = await setConversationArchived(c.id, !c.archived); setErro(r.error ?? null); onChanged(); })}
          className="wa-row wa-muted hidden rounded-full p-2 sm:block"
          title={c.archived ? "Desarquivar conversa" : "Arquivar conversa"} aria-label={c.archived ? "Desarquivar conversa" : "Arquivar conversa"}
        >
          {c.archived ? <ArchiveRestore className="h-4 w-4" /> : <Archive className="h-4 w-4" />}
        </button>
        <button onClick={onPanel} aria-label="Abrir ficha do cliente" title="Ficha do cliente" className="wa-row wa-muted rounded-full p-2"><PanelRightOpen className="h-4 w-4" /></button>
        </div>
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild><button aria-label="Mais ações da conversa" className="wa-row wa-muted rounded-full p-2 md:hidden"><MoreVertical className="h-5 w-5" /></button></DropdownMenu.Trigger>
          <DropdownMenu.Portal><DropdownMenu.Content align="end" sideOffset={4} className="z-50 min-w-56 rounded-xl border border-sand bg-surface p-1.5 text-sm text-ink shadow-xl">
            <DropdownMenu.Item onSelect={onPanel} className="flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 outline-none focus:bg-cream"><PanelRightOpen className="h-4 w-4" />Ficha do cliente</DropdownMenu.Item>
            {(aiActive || !c.aiPaused) && <DropdownMenu.Item onSelect={() => startIa(async () => { const r = await setConversationAi(c.id, c.aiPaused); setErro(r.error ?? null); onChanged(); })} className="flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 outline-none focus:bg-cream"><Bot className="h-4 w-4" />{c.aiPaused ? "Devolver para a Lia" : "Assumir conversa"}</DropdownMenu.Item>}
            <DropdownMenu.Item onSelect={() => { setPesquisando(v => !v); setBuscaMensagem(""); }} className="flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 outline-none focus:bg-cream"><Search className="h-4 w-4" />Pesquisar na conversa</DropdownMenu.Item>
            <DropdownMenu.Item onSelect={() => setModoNota(v => !v)} className="flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 outline-none focus:bg-cream"><StickyNote className="h-4 w-4" />{modoNota ? "Voltar a escrever ao cliente" : "Escrever nota interna"}</DropdownMenu.Item>
            <DropdownMenu.Item onSelect={() => setTransferir(v => !v)} className="flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 outline-none focus:bg-cream"><ArrowRightLeft className="h-4 w-4" />Transferir conversa</DropdownMenu.Item>
            <DropdownMenu.Item onSelect={onUnread} className="flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 outline-none focus:bg-cream"><Mail className="h-4 w-4" />Marcar como não lida</DropdownMenu.Item>
            <DropdownMenu.Item onSelect={() => startArquivo(async () => { const r = await setConversationArchived(c.id, !c.archived); setErro(r.error ?? null); onChanged(); })} className="flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 outline-none focus:bg-cream">{c.archived ? <ArchiveRestore className="h-4 w-4" /> : <Archive className="h-4 w-4" />}{c.archived ? "Desarquivar conversa" : "Arquivar conversa"}</DropdownMenu.Item>
          </DropdownMenu.Content></DropdownMenu.Portal>
        </DropdownMenu.Root>
      </header>
      {transferir && <Transferencia conversation={c} onStatus={mudarStatus} onDone={(error) => { setErro(error); if (!error) setTransferir(false); onChanged(); }} />}
      {pesquisando && <div className="wa-head wa-line flex items-center gap-2 border-t px-4 py-2"><Search className="wa-muted h-4 w-4" /><input aria-label="Buscar mensagens nesta conversa" autoFocus value={buscaMensagem} onChange={e => setBuscaMensagem(e.target.value)} placeholder="Pesquisar nesta conversa" className="wa-input min-w-0 flex-1 rounded-lg px-3 py-2 text-sm outline-none" /><span role="status" className="wa-muted text-xs">{termo ? `${exibidas.length} encontradas` : ""}</span><button aria-label="Fechar busca de mensagens" onClick={() => { setPesquisando(false); setBuscaMensagem(""); }} className="wa-muted rounded-full p-2"><X className="h-4 w-4" /></button></div>}

      <div ref={caixa} onScroll={e => { const el = e.currentTarget; setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 80); if (el.scrollTop < 150) void carregarAntigas(); }} className="wa-chat flex-1 space-y-1.5 overflow-y-auto px-[5%] py-3">
        {temAntigas && <p className="wa-muted text-center text-xs">{carregandoAntigas ? "Carregando mensagens anteriores…" : <button onClick={() => void carregarAntigas()} className="underline">Mensagens anteriores</button>}</p>}
        {exibidas.length === 0 && <p className="wa-muted p-6 text-center text-sm">{termo ? "Nenhuma mensagem encontrada nas mensagens carregadas." : "Sem mensagens."}</p>}
        {exibidas.map((m, index) => {
          const eventosAntes = termo ? [] : eventosEntre(detail.events ?? [], index === 0 ? (temAntigas ? m.at : "") : exibidas[index - 1].at, m.at);
          const nome = quemEnviou(m);
          const saida = m.direction === "outbound";
          const anterior = exibidas[index - 1];
          const novoDia = !anterior || inboxDay(anterior.at) !== inboxDay(m.at);
          const mesmoGrupo = !novoDia && anterior.direction === m.direction && anterior.senderName === m.senderName && anterior.author === m.author;
          return (
            <Fragment key={m.id}>
            {eventosAntes.map(ev => <Evento key={`e-${ev.id}`} e={ev} />)}
            {novoDia && <div className="sticky top-1 z-10 flex justify-center py-3"><span suppressHydrationWarning className="wa-date rounded-lg px-3 py-1.5 text-xs shadow-sm">{inboxDayLabel(m.at)}</span></div>}
            {!termo && primeiraNaoLida.current === m.id && <div role="separator" aria-label="Mensagens não lidas" className="wa-unread-divider -mx-[5%] my-4 flex justify-center py-2"><span className="wa-date rounded-full px-4 py-1.5 text-xs uppercase tracking-wide shadow-sm">Mensagens não lidas</span></div>}
            <div className={cn("flex", saida ? "justify-end" : "justify-start", !mesmoGrupo && "pt-1.5")}>
              <div className={cn("max-w-[88%] rounded-lg px-2.5 pb-1 pt-1.5 text-[14.2px] shadow-[0_1px_0.5px_rgba(11,20,26,.13)] sm:max-w-[78%]", saida ? "wa-out" : "wa-in", !mesmoGrupo && (saida ? "rounded-tr-none" : "rounded-tl-none"), m.failed && "ring-2 ring-red-400")}>
                {nome && !mesmoGrupo && <p className={cn("mb-0.5 text-xs font-bold", m.author === "ana" ? "text-blue-400" : "wa-sender")}>{nome}</p>}
                {m.quotedPreview && <p className="wa-quote mb-1 line-clamp-2 rounded border-l-4 border-[var(--wa-green)] bg-black/5 px-2 py-1 text-[12.5px] opacity-80" title="Respondendo a">{m.quotedPreview}</p>}
                <Midia id={m.id} body={saida ? semAssinatura(m.body) : m.body} />
                {(saida ? semAssinatura(m.body) : m.body).replace(MIDIA, "") && <p className="whitespace-pre-wrap break-words"><Formatado text={(saida ? semAssinatura(m.body) : m.body).replace(MIDIA, "")} /></p>}
                <p className="wa-muted -mt-0.5 flex items-center justify-end gap-1 text-[11px]">
                  {!m.pending && !m.failed && <button type="button" aria-label="Responder esta mensagem" title="Responder citando esta mensagem" className="mr-auto rounded p-0.5 opacity-60 hover:opacity-100"
                    onClick={() => { setRespondendo(m); setModoNota(false); }}><Reply className="h-3.5 w-3.5" /></button>}
                  {inboxClock(m.at)} {m.pending && "Aguardando envio…"} {saida && !m.failed && !m.pending && m.deliveryStatus !== "desconhecido" && (m.deliveryStatus === "lida" || m.deliveryStatus === "entregue" ? <CheckCheck aria-label={m.deliveryStatus} className={cn("h-3.5 w-3.5", m.deliveryStatus === "lida" && "text-sky-400")} /> : <Check aria-label="Enviada" className="h-3.5 w-3.5" />)}
                </p>
                {m.failed && <p className="mt-1 flex items-start gap-1 text-[11px] text-red-500"><CircleAlert className="mt-0.5 h-3 w-3 shrink-0" /> Não enviada: {m.error}</p>}
                {m.failed && saida && !MIDIA.test(m.body) && semAssinatura(m.body).trim() && (
                  <button disabled={enviando} className="mt-1 text-[11px] font-bold text-red-500 underline disabled:opacity-50"
                    onClick={() => startEnvio(async () => {
                      // A original falhou de vez (não saiu): reenvia o mesmo texto como mensagem nova.
                      const r = await sendInboxMessage(c.id, semAssinatura(m.body), { clientRef: crypto.randomUUID() });
                      setErro(r.error ?? r.warning ?? null);
                      onChanged();
                    })}>Reenviar</button>
                )}
                {m.deliveryStatus === "desconhecido" && <p className="mt-1 flex items-start gap-1 text-[11px] text-amber-600"><CircleAlert className="mt-0.5 h-3 w-3 shrink-0" /> Sem confirmação do WhatsApp: confira no celular antes de reenviar.</p>}
              </div>
            </div>
            {(m.reactionCustomer || m.reactionTeam) && (
              <div className={cn("-mt-1.5 mb-1 flex", saida ? "justify-end pr-2" : "justify-start pl-2")}>
                <span className="wa-in rounded-full border px-1.5 py-0.5 text-sm leading-none shadow-sm" title={[m.reactionCustomer && "Cliente", m.reactionTeam && "Equipe"].filter(Boolean).join(" e ") + " reagiu"}>
                  {m.reactionCustomer}{m.reactionTeam}
                </span>
              </div>
            )}
            </Fragment>
          );
        })}
        {!termo && (detail.events ?? []).filter(e => e.at >= (exibidas.at(-1)?.at ?? "")).map(ev => <Evento key={`e-${ev.id}`} e={ev} />)}
        <div ref={fim} />
      </div>

      {!atBottom && <button className="wa-head flex items-center justify-center gap-2 py-2 text-xs font-bold" style={{ color: "var(--wa-green)" }} onClick={() => { setAtBottom(true); fim.current?.scrollIntoView({ block: "end" }); }}><ArrowDown className="h-4 w-4" />Ir para mensagens recentes ↓{c.unread > 0 && <span className="wa-badge rounded-full px-2 py-0.5">{c.unread}</span>}</button>}
      <footer className="wa-head px-3 py-2">
        {officialWindow && !detail.windowOpen && <p className="mb-2 rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-500">Passaram 24h da última mensagem do cliente: pelo WhatsApp oficial, a mensagem pode não sair até ele responder.</p>}
        {readError && <div className="mb-2 flex items-center gap-2 rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-600"><CircleAlert className="h-3.5 w-3.5 shrink-0" /><span>{readError}</span><button className="ml-auto shrink-0 font-bold underline" onClick={() => { readKey.current = ""; setReadRetry(n => n + 1); }}>Tentar novamente</button></div>}
        {modoNota ? <p className="mb-2 text-xs font-bold text-amber-600">Nota interna: fica no histórico só para a equipe. Não vai para o cliente.</p>
          : aiActive && !c.aiPaused && <p className="mb-2 text-xs text-ink/50">A Lia está respondendo. Ao enviar, você assume a conversa.</p>}
        {erro && <p className="mb-2 rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-500">{erro}</p>}
        {detail.suggestion && (
          <div className="mb-2 rounded-xl border border-blue-400/40 bg-blue-500/10 p-3" aria-label="Sugestão da Lia">
            <p className="mb-1 flex items-center gap-1 text-xs font-black text-blue-400"><Bot className="h-3.5 w-3.5" /> Sugestão da Lia · aguarda aprovação</p>
            <p className="whitespace-pre-wrap break-words text-sm">{detail.suggestion.text}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <button disabled={sugerindo} className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50"
                onClick={() => startSugestao(async () => { const r = await approveLiaSuggestion(c.id, detail.suggestion!.at); setErro(r.error ?? r.warning ?? null); onChanged(); })}>
                {sugerindo ? "Enviando…" : "Usar"}
              </button>
              <button disabled={sugerindo} className="rounded-lg bg-surface px-3 py-1.5 text-xs font-bold"
                title="Você edita e envia; a conversa passa para você"
                onClick={() => startSugestao(async () => { setTexto(detail.suggestion!.text); await discardLiaSuggestion(c.id); onChanged(); })}>Editar</button>
              <button disabled={sugerindo} className="rounded-lg px-3 py-1.5 text-xs font-bold text-ink/60"
                onClick={() => startSugestao(async () => { const r = await discardLiaSuggestion(c.id); setErro(r.error ?? null); onChanged(); })}>Descartar</button>
            </div>
          </div>
        )}
        {respondendo && !modoNota && (
          <div className="mb-2 flex items-start gap-2 rounded-lg border-l-4 border-[var(--wa-green)] bg-black/5 px-3 py-2 text-xs" role="status" aria-label="Respondendo a">
            <Reply className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <p className="line-clamp-2 flex-1">{(respondendo.direction === "outbound" ? semAssinatura(respondendo.body) : respondendo.body) || "Mensagem"}</p>
            <button type="button" aria-label="Cancelar resposta" onClick={() => setRespondendo(null)} className="rounded p-0.5"><X className="h-3.5 w-3.5" /></button>
          </div>
        )}
        <div className="flex items-end gap-1.5">
          <InboxAttachments conversationId={c.id} quotes={detail.panel?.orcamentos??[]} onChanged={onChanged} onQuoteSent={()=>setTexto(fillQuickReply(QUOTE_MESSAGE, c.clientName || c.name))}/>
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
            placeholder={modoNota ? "Nota interna: só a equipe vê" : "Digite uma mensagem…"}
            title="Digite / para respostas prontas"
            className={cn("wa-input max-h-40 flex-1 resize-none rounded-3xl px-4 py-2.5 text-[16px] outline-none", modoNota && "ring-1 ring-amber-500/60")}
          />
          <button onClick={() => setModoNota(v => !v)} aria-pressed={modoNota} title={modoNota ? "Voltar a escrever para o cliente" : "Escrever nota interna (o cliente não vê)"}
            className={cn("hidden rounded-full p-3 md:block", modoNota ? "bg-amber-500 text-white" : "wa-row wa-muted")} aria-label="Nota interna">
            <StickyNote className="h-5 w-5" />
          </button>
          <button onClick={enviar} disabled={enviando || !texto.trim()} className={cn("flex h-11 w-11 shrink-0 items-center justify-center rounded-full disabled:opacity-50", modoNota ? "bg-amber-600 text-white" : "wa-send")} aria-label={modoNota ? "Salvar nota" : "Enviar"}>
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
  const [aba, setAba] = useState<"resumo" | "orcamentos" | "financeiro">("resumo");
  const [pending, start] = useTransition();
  const abertas = panel.contas.filter((e) => e.aberto > 0);

  return (
    <div className="space-y-4">
      <div className="wa-client-head">
        <div className="flex items-start gap-3">
          <span className="wa-avatar flex h-16 w-16 shrink-0 items-center justify-center rounded-full text-2xl font-medium">{client.name.slice(0, 1).toUpperCase()}</span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-xl font-bold leading-tight">{client.name}</p>
            <span className="mt-1 inline-block rounded-md bg-[var(--success-soft)] px-2 py-0.5 text-xs font-semibold text-[var(--success-text)]">Cliente</span>
          </div>
          <Link href={`/clientes/${client.id}`} className="wa-edit-button shrink-0"><Pencil className="h-3.5 w-3.5" />Editar</Link>
        </div>
        <ul className="mt-3 space-y-1.5 text-sm">
          {client.phone && <li className="flex items-center gap-2"><Phone className="h-4 w-4 text-ink/50" /><span className="flex-1">{client.phone}</span><button type="button" aria-label="Copiar telefone" onClick={() => { try { void navigator.clipboard.writeText(client.phone ?? ""); } catch {} }} className="rounded p-1 text-ink/50 hover:bg-cream"><Copy className="h-4 w-4" /></button></li>}
          {(client.city || client.address) && <li className="flex items-start gap-2"><MapPin className="mt-0.5 h-4 w-4 shrink-0 text-ink/50" /><span>{[client.address, client.city].filter(Boolean).join(" · ")}</span></li>}
        </ul>
      </div>

      <div className="wa-client-actions grid grid-cols-4 gap-2">
        <Link href="/orcamentos/calhas"><FileText className="h-6 w-6" />Orçamento</Link>
        <Link href="/agenda"><CalendarDays className="h-6 w-6" />Agendar</Link>
        <Link href="/pedidos"><Package className="h-6 w-6" />Pedido</Link>
        {panel.canViewFinancial === true ? <button type="button" onClick={() => setAba("financeiro")}><Coins className="h-6 w-6" />Financeiro</button> : <Link href={`/clientes/${client.id}`}><UserPlus className="h-6 w-6" />Cadastro</Link>}
      </div>

      <div role="tablist" aria-label="Seções do cliente" className="wa-client-tabs flex gap-5 border-b">
        {([["resumo", "Resumo"], ["orcamentos", "Orçamentos"], ...(panel.canViewFinancial === true ? [["financeiro", "Financeiro"]] : [])] as [string, string][]).map(([k, l]) => (
          <button key={k} role="tab" aria-selected={aba === k} onClick={() => setAba(k as typeof aba)} className="wa-tab">{l}</button>
        ))}
      </div>

      {aba === "resumo" && <>
        {panel.pipeline && (
          <div className="wa-info-card">
            <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2.5 text-sm">
              <dt className="text-ink/60">Etapa no CRM</dt><dd className="font-semibold">{panel.pipeline.etapa ?? "—"}</dd>
              {panel.pipeline.valor ? <><dt className="text-ink/60">Valor</dt><dd className="font-semibold">{brl(Number(panel.pipeline.valor))}</dd></> : null}
              {panel.pipeline.proximaAcao ? <><dt className="text-ink/60">Próxima ação</dt><dd className="font-semibold">{panel.pipeline.proximaAcao}{panel.pipeline.data ? ` (${dataBr(panel.pipeline.data)})` : ""}</dd></> : null}
            </dl>
          </div>
        )}
        <div className="grid grid-cols-3 gap-2 text-center">
          <Mini label="Orçamentos" value={String(r.feitos)} />
          <Mini label="Enviados" value={String(r.enviados)} />
          <Mini label="Fechados" value={String(r.fechados)} />
          <Mini label="Fechado" value={brl(r.valorFechado)} />
          {panel.canViewFinancial === true && <Mini label="Recebido" value={brl(r.recebido)} tone="ok" />}
          {panel.canViewFinancial === true && <Mini label={r.vencido > 0 ? "Vencido" : "A receber"} value={brl(r.vencido > 0 ? r.vencido : r.aReceber)} tone={r.vencido > 0 ? "bad" : r.aReceber > 0 ? "warn" : undefined} />}
        </div>
        {client.notes && <div className="wa-info-card"><p className="mb-1.5 flex items-center gap-2 font-semibold"><StickyNote className="h-4 w-4" />Anotações</p><p className="whitespace-pre-wrap text-sm text-ink/70">{client.notes}</p></div>}
      </>}

      {erro && <p className="rounded-lg bg-red-500/10 p-2 text-xs text-red-500">{erro}</p>}

      {aba === "financeiro" && panel.canViewFinancial === true && <div className="card p-3">
        <p className="mb-2 flex items-center gap-1 font-black"><Wallet className="h-4 w-4" /> Financeiro</p>
        <div className="mb-2"><PixCharge conversationId={conversationId} clientId={client.id} clientName={client.name} contas={panel.contas} orcamentos={panel.orcamentos} onSent={onChanged} /></div>
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
      </div>}

      {aba === "orcamentos" && <div className="card p-3">
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
      </div>}
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

/** Notas e transferências que aconteceram entre duas mensagens (depois de `desde`, até `ate`). */
function eventosEntre(eventos: InboxEvent[], desde: string, ate: string) {
  return eventos.filter(e => (!desde || e.at > desde) && e.at <= ate);
}

function Evento({ e }: { e: InboxEvent }) {
  const quem = e.byName ?? "Equipe";
  if (e.kind === "nota") return (
    <div className="mx-auto my-2 max-w-[90%] rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm">
      <p className="mb-0.5 flex items-center gap-1 text-xs font-bold text-amber-600"><StickyNote className="h-3 w-3" /> Nota interna · {quem}</p>
      <p className="whitespace-pre-wrap break-words">{e.body}</p>
      <p className="wa-muted mt-1 text-right text-[10px]">{inboxClock(e.at)}</p>
    </div>
  );
  const texto = e.kind === "status"
    ? `${quem} marcou como ${STATUS_LABEL[(e.status as ConversationStatus) ?? "aberta"] ?? e.status}`
    : `${quem} transferiu${e.toName ? ` para ${e.toName}` : ""}${e.department ? ` (${setorNome(e.department)})` : ""}`;
  return <div className="flex justify-center py-1.5"><span className="wa-date rounded-lg px-3 py-1 text-[11.5px] shadow-sm">{texto}{e.body ? `: ${e.body}` : ""} · {inboxClock(e.at)}</span></div>;
}

function Transferencia({ conversation: c, onStatus, onDone }: { conversation: InboxItem; onStatus: (s: ConversationStatus) => void; onDone: (error: string | null) => void }) {
  const [equipe, setEquipe] = useState<Array<{ id: string; name: string }>>([]);
  const [para, setPara] = useState("");
  const [setor, setSetor] = useState(c.department ?? "");
  const [obs, setObs] = useState("");
  const [salvando, startSalvar] = useTransition();
  useEffect(() => { let vivo = true; void listInboxTeam().then(r => { if (vivo) setEquipe(r); }); return () => { vivo = false; }; }, []);
  return (
    <div className="wa-head wa-line space-y-2 border-t px-4 py-3 text-sm">
      <div className="flex flex-wrap gap-2">
        <select value={para} onChange={e => setPara(e.target.value)} className="wa-input min-w-0 flex-1 rounded-lg px-2 py-2" aria-label="Transferir para">
          <option value="">Pessoa (opcional)</option>
          {equipe.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <select value={setor} onChange={e => setSetor(e.target.value)} className="wa-input min-w-0 flex-1 rounded-lg px-2 py-2" aria-label="Setor">
          <option value="">Setor (opcional)</option>
          {SETORES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
      </div>
      <input value={obs} onChange={e => setObs(e.target.value)} maxLength={1000} placeholder="Observação para quem recebe (opcional)" className="wa-input w-full rounded-lg px-3 py-2" />
      <div className="flex flex-wrap items-center gap-2">
        <button disabled={salvando || (!para && !setor)} className="wa-send rounded-full px-4 py-2 text-xs font-bold disabled:opacity-50"
          onClick={() => startSalvar(async () => { const r = await transferConversation(c.id, { toProfile: para || null, department: setor || null, note: obs }); onDone(r.error ?? null); })}>
          {salvando ? "Transferindo…" : "Transferir"}
        </button>
        <span className="wa-muted text-xs">Com pessoa escolhida, a Lia para de responder e ela recebe um aviso.</span>
        <select value={c.status} onChange={e => onStatus(e.target.value as ConversationStatus)} className="wa-input ml-auto rounded-lg px-2 py-1.5 text-xs lg:hidden" aria-label="Status da conversa">
          {Object.entries(STATUS_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
      </div>
    </div>
  );
}
