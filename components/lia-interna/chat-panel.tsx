"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import type { GeminiContent, LiaActionCard } from "@/lib/lia-interna/types";

type Msg = {
  id: string;
  role: "user" | "assistant" | "action" | "confirm";
  content: string;
  action_card?: LiaActionCard;
  confirmed?: boolean;
};

function newId() { return Math.random().toString(36).slice(2); }

function MarkdownText({ text }: { text: string }) {
  // Simple bold/newline rendering without a full markdown parser
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return (
    <span>
      {parts.map((p, i) =>
        p.startsWith("**") && p.endsWith("**") ? (
          <strong key={i}>{p.slice(2, -2)}</strong>
        ) : (
          p.split("\n").map((line, j, arr) => (
            <span key={j}>{line}{j < arr.length - 1 ? <br /> : null}</span>
          ))
        )
      )}
    </span>
  );
}

function ActionCard({
  card,
  onConfirm,
  onCancel,
  disabled,
}: {
  card: LiaActionCard;
  onConfirm: () => void;
  onCancel: () => void;
  disabled: boolean;
}) {
  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/40 p-3 text-sm">
      <p className="text-amber-700 dark:text-amber-400 font-medium mb-2 text-xs uppercase tracking-wide">Confirmar ação</p>
      <p className="text-foreground mb-3">
        <MarkdownText text={card.preview} />
      </p>
      <div className="flex gap-2">
        <button
          onClick={onConfirm}
          disabled={disabled}
          className="flex-1 rounded-lg bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-white text-xs font-medium px-3 py-1.5 transition-colors"
        >
          {card.confirmLabel ?? "Confirmar"}
        </button>
        <button
          onClick={onCancel}
          disabled={disabled}
          className="flex-1 rounded-lg border border-border hover:bg-muted disabled:opacity-50 text-xs font-medium px-3 py-1.5 transition-colors"
        >
          Cancelar
        </button>
      </div>
    </div>
  );
}

export function LiaChatPanel({ onClose }: { onClose: () => void }) {
  const [messages, setMessages] = useState<Msg[]>([
    { id: newId(), role: "assistant", content: "Olá! Sou a Lia Interna. Como posso ajudar?" },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [sessionId, setSessionId] = useState<string | undefined>();
  const [pendingCard, setPendingCard] = useState<{ card: LiaActionCard; msgId: string } | null>(null);
  const historyRef = useRef<GeminiContent[]>([]);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  const sendMessage = useCallback(async (text: string) => {
    if (!text.trim() || loading) return;
    setInput("");
    setPendingCard(null);

    const userMsgId = newId();
    setMessages((prev) => [...prev, { id: userMsgId, role: "user", content: text }]);
    setLoading(true);

    // Build history for Gemini (last 20 messages)
    const history = historyRef.current.slice(-20);

    try {
      const res = await fetch("/api/lia-interna/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: sessionId, message: text, history }),
      });
      const data = await res.json() as {
        session_id?: string;
        reply?: string;
        action_card?: LiaActionCard;
        error?: string;
      };

      if (data.session_id) setSessionId(data.session_id);

      if (data.error) {
        setMessages((prev) => [...prev, { id: newId(), role: "assistant", content: `Erro: ${data.error}` }]);
        return;
      }

      // Update history
      historyRef.current = [
        ...history,
        { role: "user", parts: [{ text }] },
        { role: "model", parts: [{ text: data.reply ?? "" }] },
      ];

      const replyId = newId();
      if (data.action_card) {
        setMessages((prev) => [...prev, { id: replyId, role: "action", content: data.reply ?? "Confirme a ação:", action_card: data.action_card }]);
        setPendingCard({ card: data.action_card, msgId: replyId });
      } else if (data.reply) {
        setMessages((prev) => [...prev, { id: replyId, role: "assistant", content: data.reply! }]);
      }
    } catch {
      setMessages((prev) => [...prev, { id: newId(), role: "assistant", content: "Erro de conexão. Tente novamente." }]);
    } finally {
      setLoading(false);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [loading, sessionId]);

  const handleConfirm = useCallback(async () => {
    if (!pendingCard || !sessionId) return;
    setLoading(true);
    const { card, msgId } = pendingCard;
    setPendingCard(null);

    // Mark card as confirmed in messages
    setMessages((prev) => prev.map((m) => m.id === msgId ? { ...m, confirmed: true } : m));

    try {
      const res = await fetch("/api/lia-interna/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: sessionId, params: card.params }),
      });
      const data = await res.json() as { ok?: boolean; message?: string; error?: string };
      if (data.ok) {
        setMessages((prev) => [...prev, { id: newId(), role: "confirm", content: `✓ ${data.message}` }]);
      } else {
        setMessages((prev) => [...prev, { id: newId(), role: "assistant", content: `Erro: ${data.error}` }]);
      }
    } catch {
      setMessages((prev) => [...prev, { id: newId(), role: "assistant", content: "Erro ao confirmar. Tente novamente." }]);
    } finally {
      setLoading(false);
    }
  }, [pendingCard, sessionId]);

  const handleCancel = useCallback(() => {
    if (!pendingCard) return;
    const { msgId } = pendingCard;
    setMessages((prev) => prev.map((m) => m.id === msgId ? { ...m, confirmed: false } : m));
    setPendingCard(null);
    setMessages((prev) => [...prev, { id: newId(), role: "assistant", content: "Ação cancelada." }]);
  }, [pendingCard]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-background">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center text-primary text-xs font-bold">L</div>
          <div>
            <p className="text-sm font-semibold leading-none">Lia Interna</p>
            <p className="text-xs text-muted-foreground">Assistente do CRM</p>
          </div>
        </div>
        <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors" aria-label="Fechar">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M12 4L4 12M4 4l8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {messages.map((msg) => (
          <div key={msg.id} className={msg.role === "user" ? "flex justify-end" : "flex justify-start"}>
            {msg.role === "user" ? (
              <div className="max-w-[80%] rounded-2xl rounded-tr-sm bg-primary text-primary-foreground px-3 py-2 text-sm">
                {msg.content}
              </div>
            ) : msg.role === "confirm" ? (
              <div className="max-w-[80%] rounded-2xl rounded-tl-sm bg-green-50 dark:bg-green-950/40 border border-green-200 dark:border-green-800 text-green-800 dark:text-green-300 px-3 py-2 text-sm font-medium">
                {msg.content}
              </div>
            ) : msg.role === "action" && msg.action_card && !msg.confirmed && !pendingCard?.msgId ? (
              <div className="max-w-[90%] space-y-2">
                {msg.content !== "Confirme a ação:" && (
                  <div className="rounded-2xl rounded-tl-sm bg-muted px-3 py-2 text-sm text-foreground">
                    <MarkdownText text={msg.content} />
                  </div>
                )}
                <ActionCard card={msg.action_card} onConfirm={handleConfirm} onCancel={handleCancel} disabled={loading} />
              </div>
            ) : msg.role === "action" && msg.action_card ? (
              <div className="max-w-[90%] space-y-2">
                {msg.content !== "Confirme a ação:" && (
                  <div className="rounded-2xl rounded-tl-sm bg-muted px-3 py-2 text-sm text-foreground">
                    <MarkdownText text={msg.content} />
                  </div>
                )}
                <div className="text-xs text-muted-foreground px-1">
                  {msg.confirmed === false ? "✕ Cancelado" : msg.confirmed ? "✓ Confirmado" : "Aguardando..."}
                </div>
              </div>
            ) : (
              <div className="max-w-[80%] rounded-2xl rounded-tl-sm bg-muted px-3 py-2 text-sm text-foreground">
                <MarkdownText text={msg.content} />
              </div>
            )}
          </div>
        ))}

        {/* Active action card */}
        {pendingCard && !loading && (
          <div className="flex justify-start">
            <div className="max-w-[90%]">
              <ActionCard card={pendingCard.card} onConfirm={handleConfirm} onCancel={handleCancel} disabled={loading} />
            </div>
          </div>
        )}

        {loading && (
          <div className="flex justify-start">
            <div className="rounded-2xl rounded-tl-sm bg-muted px-3 py-2">
              <span className="flex gap-1 items-center h-4">
                <span className="w-1.5 h-1.5 bg-muted-foreground/50 rounded-full animate-bounce [animation-delay:0ms]" />
                <span className="w-1.5 h-1.5 bg-muted-foreground/50 rounded-full animate-bounce [animation-delay:150ms]" />
                <span className="w-1.5 h-1.5 bg-muted-foreground/50 rounded-full animate-bounce [animation-delay:300ms]" />
              </span>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="px-3 pb-3 pt-2 border-t border-border bg-background">
        <div className="flex gap-2 items-end bg-muted rounded-2xl px-3 py-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={loading}
            placeholder="Pergunte ou dê um comando..."
            rows={1}
            className="flex-1 bg-transparent resize-none text-sm outline-none placeholder:text-muted-foreground disabled:opacity-50 max-h-32 leading-5"
            style={{ minHeight: "20px" }}
          />
          <button
            onClick={() => sendMessage(input)}
            disabled={loading || !input.trim()}
            className="shrink-0 w-7 h-7 rounded-full bg-primary disabled:opacity-30 hover:bg-primary/90 text-primary-foreground flex items-center justify-center transition-colors"
            aria-label="Enviar"
          >
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none"><path d="M1 6.5h11M6.5 1l5.5 5.5-5.5 5.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </button>
        </div>
        <p className="text-center text-xs text-muted-foreground mt-1.5">Enter para enviar · Shift+Enter nova linha</p>
      </div>
    </div>
  );
}

export function LiaFloatingButton() {
  const [open, setOpen] = useState(false);

  return (
    <>
      {/* Floating button */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="fixed bottom-20 right-4 z-40 w-12 h-12 rounded-full bg-primary text-primary-foreground shadow-lg hover:shadow-xl hover:scale-105 active:scale-95 transition-all flex items-center justify-center md:bottom-6 md:right-6"
          aria-label="Abrir Lia Interna"
        >
          <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
            <path d="M11 2C6.03 2 2 5.58 2 10c0 1.85.67 3.56 1.78 4.93L2.5 19l4.3-1.26A9.4 9.4 0 0011 18c4.97 0 9-3.58 9-8s-4.03-8-9-8z" fill="currentColor" opacity=".2"/>
            <path d="M11 2C6.03 2 2 5.58 2 10c0 1.85.67 3.56 1.78 4.93L2.5 19l4.3-1.26A9.4 9.4 0 0011 18c4.97 0 9-3.58 9-8s-4.03-8-9-8z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            <circle cx="8" cy="10" r="1" fill="currentColor"/>
            <circle cx="11" cy="10" r="1" fill="currentColor"/>
            <circle cx="14" cy="10" r="1" fill="currentColor"/>
          </svg>
        </button>
      )}

      {/* Chat panel overlay */}
      {open && (
        <>
          {/* Backdrop (mobile only) */}
          <div
            className="fixed inset-0 z-40 bg-black/20 md:hidden"
            onClick={() => setOpen(false)}
          />
          {/* Panel */}
          <div className="fixed z-50 inset-0 md:inset-auto md:bottom-6 md:right-6 md:w-96 md:h-[600px] md:max-h-[80vh] rounded-none md:rounded-2xl shadow-2xl bg-background border-0 md:border border-border flex flex-col overflow-hidden">
            <LiaChatPanel onClose={() => setOpen(false)} />
          </div>
        </>
      )}
    </>
  );
}
