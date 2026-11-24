"use client";
import { useState, useTransition } from "react";
import { CheckCircle, XCircle, Clock, AlertTriangle } from "lucide-react";
import { decideActionRequest, listActionRequests } from "@/app/(crm)/lia-central-actions";
import type { LiaActionRequestRow } from "@/lib/ai/lia-types";
import { Note } from "@/components/form-blocks";

const REQUEST_TYPE_LABEL: Record<string, string> = {
  orcamento: "Orçamento",
  contrato: "Contrato",
  cobranca: "Cobrança",
  desconto: "Desconto",
  agendamento: "Agendamento",
  pagamento: "Pagamento",
  producao: "Produção",
  pos_venda: "Pós-venda",
  follow_up: "Follow-up",
  outro: "Outro",
};

const when = (iso: string) => new Date(iso).toLocaleString("pt-BR", {
  day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo",
});

function RequestCard({ req, onDecide }: {
  req: LiaActionRequestRow;
  onDecide: (id: string, decision: "approved" | "rejected", reason?: string) => void;
}) {
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const expired = req.expires_at && new Date(req.expires_at) < new Date();

  return (
    <li className="fx-block">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-semibold text-sm truncate">{req.title}</p>
          <p className="text-xs text-ink/50">
            {REQUEST_TYPE_LABEL[req.request_type] ?? req.request_type}
            {req.approver_role && <> · Aprovador: <b>{req.approver_role}</b></>}
            {req.expires_at && (
              <> · {expired ? <span className="text-red-600">Expirado em {when(req.expires_at)}</span> : `Expira ${when(req.expires_at)}`}</>
            )}
          </p>
          {req.description && <p className="text-xs text-ink/60 mt-1 line-clamp-2">{req.description}</p>}
          <p className="text-xs text-ink/40 mt-1">{when(req.created_at)}</p>
        </div>
        {req.status === "pending" && !expired && (
          <div className="shrink-0 flex gap-2">
            {!rejecting && (
              <>
                <button type="button" className="button text-xs" onClick={() => onDecide(req.id, "approved")}>
                  <CheckCircle className="h-3.5 w-3.5" /> Aprovar
                </button>
                <button type="button" className="button-ghost text-xs" onClick={() => setRejecting(true)}>
                  <XCircle className="h-3.5 w-3.5" /> Rejeitar
                </button>
              </>
            )}
            {rejecting && (
              <div className="flex flex-col gap-2 w-56">
                <input
                  type="text"
                  className="text-xs border rounded px-2 py-1"
                  placeholder="Motivo (opcional)"
                  value={reason}
                  onChange={e => setReason(e.target.value)}
                  maxLength={200}
                />
                <div className="flex gap-2">
                  <button type="button" className="button text-xs" onClick={() => { onDecide(req.id, "rejected", reason); setRejecting(false); }}>
                    Confirmar
                  </button>
                  <button type="button" className="button-ghost text-xs" onClick={() => setRejecting(false)}>
                    Cancelar
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
        {req.status !== "pending" && (
          <span className={`text-xs font-semibold shrink-0 ${req.status === "approved" ? "text-green-600" : "text-red-600"}`}>
            {req.status === "approved" ? "Aprovado" : req.status === "rejected" ? "Rejeitado" : req.status === "expired" ? "Expirado" : "Cancelado"}
            {req.decided_at && <> em {when(req.decided_at)}</>}
          </span>
        )}
      </div>
      {req.rejection_reason && (
        <p className="text-xs text-red-600 mt-1">Motivo: {req.rejection_reason}</p>
      )}
    </li>
  );
}

export function LiaApprovalsQueue({ initialRequests }: { initialRequests: LiaActionRequestRow[] }) {
  const [requests, setRequests] = useState(initialRequests);
  const [filter, setFilter] = useState<"pending" | "all">("pending");
  const [msg, setMsg] = useState<{ text: string; tone: "ok" | "error" } | null>(null);
  const [loading, setLoading] = useState(false);
  const [, startT] = useTransition();

  const visible = filter === "pending" ? requests.filter(r => r.status === "pending") : requests;
  const pendingCount = requests.filter(r => r.status === "pending").length;

  async function reload() {
    setLoading(true);
    const result = await listActionRequests();
    setLoading(false);
    if (!result.error) setRequests(result.data);
  }

  function handleDecide(id: string, decision: "approved" | "rejected", reason?: string) {
    startT(async () => {
      const result = await decideActionRequest(id, decision, reason);
      if (result.error) {
        setMsg({ text: result.error, tone: "error" });
      } else {
        setRequests(prev => prev.map(r => r.id === id ? { ...r, status: decision, decided_at: new Date().toISOString(), rejection_reason: reason ?? null } : r));
        setMsg({ text: decision === "approved" ? "Aprovado." : "Rejeitado.", tone: "ok" });
        setTimeout(() => setMsg(null), 3000);
      }
    });
  }

  return (
    <div className="space-y-3">
      <div className="fx-block">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <p className="font-semibold text-sm flex items-center gap-2">
              <Clock className="h-4 w-4 text-amber-600" />
              Fila de Aprovações
              {pendingCount > 0 && (
                <span className="inline-flex items-center justify-center rounded-full bg-amber-500 text-white text-[10px] font-bold w-5 h-5">{pendingCount}</span>
              )}
            </p>
            <p className="text-xs text-ink/55">Pedidos que precisam de aprovação do gerente ou administrador.</p>
          </div>
          <div className="flex gap-2">
            <button type="button" className={`text-xs px-3 py-1 rounded-full border transition-colors ${filter === "pending" ? "bg-forest text-white border-forest" : "bg-transparent border-ink/20"}`} onClick={() => setFilter("pending")}>
              Pendentes
            </button>
            <button type="button" className={`text-xs px-3 py-1 rounded-full border transition-colors ${filter === "all" ? "bg-forest text-white border-forest" : "bg-transparent border-ink/20"}`} onClick={() => setFilter("all")}>
              Todos
            </button>
            <button type="button" className="button-ghost text-xs" onClick={reload} disabled={loading}>
              {loading ? "…" : "Atualizar"}
            </button>
          </div>
        </div>
      </div>
      {msg && <Note tone={msg.tone} role="status">{msg.text}</Note>}
      {visible.length === 0 ? (
        <div className="fx-block py-6 text-center text-sm text-ink/55">
          {filter === "pending" ? (
            <><CheckCircle className="h-5 w-5 inline mr-1 text-green-500" />Nenhum pedido pendente.</>
          ) : (
            "Nenhum pedido registrado ainda."
          )}
        </div>
      ) : (
        <ul className="space-y-2">
          {visible.map(r => <RequestCard key={r.id} req={r} onDecide={handleDecide} />)}
        </ul>
      )}
      {pendingCount === 0 && filter === "pending" && requests.length === 0 && (
        <Note tone="info">
          <AlertTriangle className="h-4 w-4 inline mr-1" />
          A fila de aprovações é preenchida automaticamente quando a LIA identifica uma operação que precisa de autorização humana.
        </Note>
      )}
    </div>
  );
}
