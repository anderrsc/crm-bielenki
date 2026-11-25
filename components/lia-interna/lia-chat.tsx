"use client";
import { useState, useRef, useEffect, useCallback } from "react";
import { X, Send, Loader2, CheckCircle2, XCircle, Sparkles, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { GeminiContent, LiaActionCard } from "@/lib/lia-interna/types";

type Msg = {
  id: string;
  role: "user" | "assistant";
  content: string;
  pending?: boolean;
  error?: boolean;
  action_card?: LiaActionCard;
  card_state?: "pending" | "confirmed" | "cancelled";
};

const QUICK_SUGGESTIONS = [
  "Clientes com saldo em aberto",
  "Orçamentos enviados esta semana",
  "Contas a pagar vencendo hoje",
  "Resumo financeiro do mês",
];

function MarkdownText({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return (
    <>
      {parts.map((p, i) =>
        p.startsWith("**") && p.endsWith("**") ? (
          <strong key={i}>{p.slice(2, -2)}</strong>
        ) : (
          p.split("\n").map((line, j, arr) => (
            <span key={i + "-" + j}>{line}{j < arr.length - 1 ? <br /> : null}</span>
          ))
        )
      )}
    </>
  );
}

export function LiaChat({ onClose }: { onClose: () => void }) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [sessionId, setSessionId] = useState<string | undefined>();
  const [activeMsgId, setActiveMsgId] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const historyRef = useRef<GeminiContent[]>([]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs, sending]);

  const send = useCallback(async (overrideText?: string) => {
    const text = (overrideText ?? input).trim();
    if (!text || sending) return;

    setSending(true);
    setActiveMsgId(null);
    setInput("");

    const uid = Date.now().toString();
    const tid = "think-" + uid;
    setMsgs(prev => [...prev, { id: uid, role: "user", content: text }, { id: tid, role: "assistant", content: "", pending: true }]);

    const history = historyRef.current.slice(-20);

    try {
      const res = await fetch("/api/lia-interna/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: sessionId, message: text, history }),
      });
      const data = await res.json() as { session_id?: string; reply?: string; action_card?: LiaActionCard; error?: string };

      setMsgs(prev => prev.filter(m => m.id !== tid));
      if (data.session_id) setSessionId(data.session_id);

      if (!res.ok || data.error) {
        setMsgs(prev => [...prev, { id: Date.now().toString(), role: "assistant", content: data.error ?? "Erro ao conectar com a Lia.", error: true }]);
      } else {
        const rid = "r-" + Date.now();
        historyRef.current = [...history, { role: "user", parts: [{ text }] }, { role: "model", parts: [{ text: data.reply ?? "" }] }];
        if (data.action_card) {
          setMsgs(prev => [...prev, { id: rid, role: "assistant", content: data.reply ?? "Confirme a ação:", action_card: data.action_card, card_state: "pending" }]);
          setActiveMsgId(rid);
        } else {
          setMsgs(prev => [...prev, { id: rid, role: "assistant", content: data.reply ?? "(sem resposta)" }]);
        }
      }
    } catch {
      setMsgs(prev => prev.filter(m => m.id !== tid));
      setMsgs(prev => [...prev, { id: Date.now().toString(), role: "assistant", content: "Sem conexão. Tente novamente.", error: true }]);
    } finally {
      setSending(false);
      setTimeout(() => textareaRef.current?.focus(), 50);
    }
  }, [input, sending, sessionId]);

  const confirm = useCallback(async (msgId: string, card: LiaActionCard) => {
    if (confirming || !sessionId) return;
    setConfirming(true);
    setActiveMsgId(null);
    setMsgs(prev => prev.map(m => m.id === msgId ? { ...m, card_state: "confirmed" } : m));

    try {
      const res = await fetch("/api/lia-interna/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: sessionId, params: card.params }),
      });
      const data = await res.json() as { ok?: boolean; message?: string; error?: string };
      setMsgs(prev => [...prev, {
        id: Date.now().toString(),
        role: "assistant",
        content: data.ok ? `✓ ${data.message}` : `Erro: ${data.error}`,
        error: !data.ok,
      }]);
    } catch {
      setMsgs(prev => [...prev, { id: Date.now().toString(), role: "assistant", content: "Erro ao confirmar. Tente novamente.", error: true }]);
    } finally {
      setConfirming(false);
    }
  }, [confirming, sessionId]);

  const cancel = useCallback((msgId: string) => {
    setActiveMsgId(null);
    setMsgs(prev => prev.map(m => m.id === msgId ? { ...m, card_state: "cancelled" } : m));
    setMsgs(prev => [...prev, { id: Date.now().toString(), role: "assistant", content: "Ação cancelada." }]);
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
  };

  return (
    <div className="flex flex-col h-full bg-[var(--bg-base)] text-[var(--text-primary)]">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-[var(--border)] bg-[var(--bg-surface)] shrink-0">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <div className="w-8 h-8 rounded-full bg-[var(--color-brand)] flex items-center justify-center shrink-0">
            <Sparkles className="w-4 h-4 text-white" />
          </div>
          <div>
            <p className="font-semibold text-sm leading-tight">Lia</p>
            <p className="text-xs text-[var(--text-muted)]">Assistente interna</p>
          </div>
        </div>
        <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-[var(--bg-raised)] transition-colors" aria-label="Fechar">
          <X className="w-4 h-4 text-[var(--text-muted)]" />
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {msgs.length === 0 && (
          <div className="space-y-4">
            <div className="text-center pt-6">
              <div className="w-12 h-12 rounded-full bg-[var(--color-brand)]/10 flex items-center justify-center mx-auto mb-3">
                <Sparkles className="w-6 h-6 text-[var(--color-brand)]" />
              </div>
              <p className="font-semibold">Olá! Sou a Lia.</p>
              <p className="text-sm text-[var(--text-muted)] mt-1">Como posso ajudar a equipe hoje?</p>
            </div>
            <div className="grid grid-cols-1 gap-2">
              {QUICK_SUGGESTIONS.map(s => (
                <button key={s} onClick={() => send(s)} className="text-left text-sm px-3 py-2 rounded-lg bg-[var(--bg-surface)] border border-[var(--border)] hover:bg-[var(--bg-raised)] transition-colors text-[var(--text-secondary)]">
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {msgs.map(msg => (
          <div key={msg.id} className={cn("flex gap-2", msg.role === "user" ? "justify-end" : "justify-start")}>
            {msg.role === "assistant" && (
              <div className="w-7 h-7 rounded-full bg-[var(--color-brand)] flex items-center justify-center shrink-0 mt-0.5">
                <Sparkles className="w-3.5 h-3.5 text-white" />
              </div>
            )}
            <div className="max-w-[85%] space-y-2">
              {(msg.content || msg.pending) && (
                <div className={cn(
                  "rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed",
                  msg.role === "user"
                    ? "bg-[var(--color-brand)] text-white rounded-tr-sm"
                    : msg.error
                      ? "bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800 rounded-tl-sm"
                      : "bg-[var(--bg-surface)] border border-[var(--border)] rounded-tl-sm",
                )}>
                  {msg.pending ? (
                    <span className="flex items-center gap-1.5 text-[var(--text-muted)]">
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>Pensando…</span>
                    </span>
                  ) : msg.error ? (
                    <span className="flex items-center gap-1.5">
                      <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                      <span>{msg.content}</span>
                    </span>
                  ) : (
                    <span className="whitespace-pre-wrap"><MarkdownText text={msg.content} /></span>
                  )}
                </div>
              )}

              {/* Action card */}
              {msg.action_card && msg.card_state === "pending" && activeMsgId === msg.id && (
                <div className="border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20 rounded-xl p-3.5 space-y-2.5">
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                    <p className="text-sm text-amber-800 dark:text-amber-300 whitespace-pre-wrap">
                      <MarkdownText text={msg.action_card.preview} />
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => confirm(msg.id, msg.action_card!)}
                      disabled={confirming}
                      className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--color-brand)] text-white text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
                    >
                      {confirming ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                      {msg.action_card.confirmLabel ?? "Confirmar"}
                    </button>
                    <button
                      onClick={() => cancel(msg.id)}
                      disabled={confirming}
                      className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg border border-[var(--border)] text-sm font-medium hover:bg-[var(--bg-raised)] transition-colors disabled:opacity-50"
                    >
                      <XCircle className="w-3.5 h-3.5" />
                      Cancelar
                    </button>
                  </div>
                </div>
              )}

              {msg.action_card && msg.card_state !== "pending" && (
                <p className="text-xs text-[var(--text-muted)] px-1">
                  {msg.card_state === "cancelled" ? "✕ Cancelado" : "✓ Confirmado"}
                </p>
              )}
            </div>
          </div>
        ))}

        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="px-4 pb-4 pt-2 border-t border-[var(--border)] shrink-0 space-y-2">
        <div className="flex gap-2 items-end">
          <div className="flex-1 relative">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Pergunte ou peça uma ação…"
              rows={1}
              className="w-full resize-none rounded-xl border border-[var(--border)] bg-[var(--bg-surface)] px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-brand)]/30 focus:border-[var(--color-brand)]/50 max-h-32 overflow-y-auto leading-relaxed"
              style={{ height: "auto", minHeight: "42px" }}
              onInput={e => { const t = e.target as HTMLTextAreaElement; t.style.height = "auto"; t.style.height = Math.min(t.scrollHeight, 128) + "px"; }}
              disabled={sending}
            />
          </div>
          <button
            onClick={() => send()}
            disabled={sending || !input.trim()}
            className="p-2.5 rounded-xl bg-[var(--color-brand)] text-white hover:opacity-90 transition-opacity disabled:opacity-40 shrink-0"
          >
            {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          </button>
        </div>
        <p className="text-[10px] text-[var(--text-muted)] text-center">Enter para enviar · Shift+Enter para nova linha</p>
      </div>
    </div>
  );
}

// Wrapper com botão flutuante
export function LiaInterna() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        onClick={() => setOpen(o => !o)}
        className={cn(
          "fixed bottom-20 right-4 z-40 md:bottom-6 md:right-6",
          "flex items-center gap-2 px-4 py-2.5 rounded-full shadow-lg",
          "bg-[var(--color-brand)] text-white font-medium text-sm",
          "hover:opacity-90 active:scale-95 transition-all duration-150",
          open && "opacity-0 pointer-events-none",
        )}
        aria-label="Abrir Lia Interna"
      >
        <Sparkles className="w-4 h-4" />
        <span>Lia</span>
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40 bg-black/40 md:hidden" onClick={() => setOpen(false)} />
          <div className={cn(
            "fixed z-50 shadow-2xl",
            "inset-0 md:inset-auto",
            "md:bottom-6 md:right-6 md:w-[380px] md:h-[600px] md:max-h-[calc(100vh-5rem)]",
            "md:rounded-2xl overflow-hidden",
            "border border-[var(--border)]",
          )}>
            <LiaChat onClose={() => setOpen(false)} />
          </div>
        </>
      )}
    </>
  );
}
