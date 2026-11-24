"use client";
// Simulador WhatsApp da LIA — ambiente fictício, sem mensagens reais, sem alteração de dados de produção.
import { useState, useTransition, useRef, useEffect } from "react";
import { Send, Bot, User, AlertTriangle, CheckCircle, Shield, Ban, Zap } from "lucide-react";
import { simulateMessage } from "@/app/(crm)/lia-simulator-actions";
import type { SimulatorResult } from "@/app/(crm)/lia-simulator-actions";
import { Note } from "@/components/form-blocks";
import { BLOCKS } from "@/lib/ai/lia-types";

type ChatMsg = { from: "user" | "lia"; text: string; result?: SimulatorResult };

const LEVEL_ICON = { auto: Zap, approval: Shield, human_only: User, forbidden: Ban };
const LEVEL_COLOR = { auto: "text-green-600", approval: "text-amber-600", human_only: "text-sky-600", forbidden: "text-red-600" };
const LEVEL_BG = { auto: "bg-green-50 border-green-200", approval: "bg-amber-50 border-amber-200", human_only: "bg-sky-50 border-sky-200", forbidden: "bg-red-50 border-red-200" };

const EXAMPLES = [
  "Quanto custa instalar calhas na minha casa?",
  "Quero fazer um orçamento para janelas de alumínio",
  "Pode fazer desconto no valor?",
  "Quando posso agendar uma visita técnica?",
  "Como faço o pagamento? Aceita Pix?",
  "Tenho uma reclamação sobre a instalação",
];

function PolicyBadge({ result }: { result: SimulatorResult }) {
  const level = result.decision.level;
  const Icon = LEVEL_ICON[level];
  return (
    <div className={`mt-2 rounded-xl border p-3 text-xs ${LEVEL_BG[level]}`}>
      <p className={`font-semibold flex items-center gap-1.5 mb-1 ${LEVEL_COLOR[level]}`}>
        <Icon className="h-3.5 w-3.5" />
        {result.detectedCategory} — {result.decision.message}
      </p>
      {result.decision.rule && (
        <p className="text-ink/60 truncate">Regra: {result.decision.rule.title}</p>
      )}
      <p className="text-ink/70 mt-1 italic">{result.suggestedResponse}</p>
    </div>
  );
}

export function LiaSimulator() {
  const [msgs, setMsgs] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [sending, startSend] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs]);

  function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed) return;
    setInput("");
    setErr(null);
    setMsgs(prev => [...prev, { from: "user", text: trimmed }]);
    startSend(async () => {
      const result = await simulateMessage(trimmed);
      if (result.error) { setErr(result.error); return; }
      setMsgs(prev => [...prev, { from: "lia", text: result.data!.suggestedResponse, result: result.data }]);
    });
  }

  return (
    <div className="space-y-3">
      <div className="fx-block">
        <p className="font-semibold text-sm flex items-center gap-2"><Bot className="h-4 w-4 text-forest" /> Simulador LIA</p>
        <p className="text-xs text-ink/55 mt-1">Ambiente fictício: nenhuma mensagem real é enviada, nenhum dado de produção é alterado. Teste como a LIA classificaria uma mensagem e quais regras seriam aplicadas.</p>
        <Note tone="warn" className="mt-2">
          <AlertTriangle className="h-4 w-4 inline mr-1" /> Este simulador usa somente as regras já ativas no banco. Regras inativas não são avaliadas.
        </Note>
      </div>

      {err && <Note tone="error">{err}</Note>}

      {/* Chat */}
      <div className="fx-block p-0 overflow-hidden flex flex-col" style={{ minHeight: 320 }}>
        {/* Header estilo WhatsApp */}
        <div className="flex items-center gap-3 p-3 bg-forest text-white">
          <div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center shrink-0">
            <Bot className="h-5 w-5" />
          </div>
          <div>
            <p className="text-sm font-semibold">LIA — Simulação</p>
            <p className="text-[11px] text-white/70">Ambiente fictício · nenhuma mensagem real</p>
          </div>
        </div>

        {/* Mensagens */}
        <div className="flex-1 p-3 space-y-3 overflow-y-auto bg-[#ECE5DD]" style={{ maxHeight: 380 }}>
          {msgs.length === 0 && (
            <p className="text-center text-xs text-ink/50 py-6">Digite uma mensagem para simular como a LIA responderia.</p>
          )}
          {msgs.map((m, i) => (
            <div key={i} className={`flex ${m.from === "user" ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm shadow-sm ${m.from === "user" ? "bg-[#DCF8C6] rounded-br-sm" : "bg-white rounded-bl-sm"}`}>
                <p>{m.from === "user" ? m.text : m.result?.suggestedResponse ?? m.text}</p>
                {m.result && <PolicyBadge result={m.result} />}
              </div>
            </div>
          ))}
          {sending && (
            <div className="flex justify-start">
              <div className="bg-white rounded-2xl rounded-bl-sm px-3 py-2 text-sm shadow-sm text-ink/50">Classificando…</div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        {/* Input */}
        <form className="flex gap-2 p-3 border-t bg-[#F0F0F0]" onSubmit={e => { e.preventDefault(); send(input); }}>
          <input
            type="text"
            className="flex-1 rounded-full bg-white border-0 px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-forest/40"
            placeholder="Digite uma mensagem de teste…"
            value={input}
            onChange={e => setInput(e.target.value)}
            disabled={sending}
            maxLength={500}
          />
          <button type="submit" disabled={sending || !input.trim()} className="w-10 h-10 rounded-full bg-forest text-white flex items-center justify-center shrink-0 disabled:opacity-40">
            <Send className="h-4 w-4" />
          </button>
        </form>
      </div>

      {/* Exemplos */}
      <div className="fx-block">
        <p className="text-xs text-ink/50 mb-2 font-medium">Exemplos rápidos:</p>
        <div className="flex flex-wrap gap-2">
          {EXAMPLES.map(ex => (
            <button key={ex} type="button" className="text-xs px-3 py-1.5 rounded-full border bg-cream hover:bg-ink/5 transition-colors" onClick={() => send(ex)}>
              {ex}
            </button>
          ))}
        </div>
      </div>

      {/* Legenda */}
      <div className="fx-block">
        <p className="text-xs text-ink/50 font-medium mb-2">Legenda de autonomia:</p>
        <div className="grid grid-cols-2 gap-2 text-xs">
          {([["auto","Zap","Automático — LIA executa sozinha"],["approval","Shield","Aprovação — LIA cria pedido e aguarda"],["human_only","User","Só humano — LIA encaminha, não age"],["forbidden","Ban","Proibido — LIA bloqueia a operação"]] as const).map(([level, , label]) => {
            const Icon = LEVEL_ICON[level as keyof typeof LEVEL_ICON];
            return (
              <div key={level} className={`flex items-center gap-1.5 p-2 rounded-lg border ${LEVEL_BG[level as keyof typeof LEVEL_BG]}`}>
                <Icon className={`h-3.5 w-3.5 shrink-0 ${LEVEL_COLOR[level as keyof typeof LEVEL_COLOR]}`} />
                <span className={LEVEL_COLOR[level as keyof typeof LEVEL_COLOR]}>{label}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
