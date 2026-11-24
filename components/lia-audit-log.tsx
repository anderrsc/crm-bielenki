"use client";
import { useState, useTransition } from "react";
import { Shield } from "lucide-react";
import { listAuditEvents } from "@/app/(crm)/lia-central-actions";
import type { LiaAuditRow } from "@/lib/ai/lia-types";
import { Note } from "@/components/form-blocks";

const EVENT_LABEL: Record<string, string> = {
  rule_enabled: "Regra ativada",
  rule_disabled: "Regra desativada",
  rule_updated: "Regra atualizada",
  rule_created: "Regra criada",
  kb_updated: "Conhecimento editado",
  approval_created: "Aprovação solicitada",
  approval_decided: "Aprovação decidida",
  lia_action: "LIA executou ação",
  lia_blocked: "LIA bloqueada",
  config_changed: "Configuração alterada",
  kill_switch: "Kill switch",
};

const OUTCOME_COLOR: Record<string, string> = {
  allowed: "text-green-600",
  blocked: "text-red-600",
  approved: "text-green-600",
  rejected: "text-red-600",
  changed: "text-sky-600",
  created: "text-forest",
};

const when = (iso: string) => new Date(iso).toLocaleString("pt-BR", {
  day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo",
});

export function LiaAuditLog({ initialEvents }: { initialEvents: LiaAuditRow[] }) {
  const [events, setEvents] = useState(initialEvents);
  const [loading, startLoad] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  function reload() {
    startLoad(async () => {
      const result = await listAuditEvents(100);
      if (result.error) { setErr(result.error); return; }
      setEvents(result.data);
    });
  }

  return (
    <div className="space-y-3">
      <div className="fx-block">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div>
            <p className="font-semibold text-sm flex items-center gap-2"><Shield className="h-4 w-4 text-forest" /> Auditoria</p>
            <p className="text-xs text-ink/55">Registro imutável de todas as ações sensíveis da LIA e dos gestores.</p>
          </div>
          <button type="button" className="button-ghost text-xs" onClick={reload} disabled={loading}>
            {loading ? "…" : "Atualizar"}
          </button>
        </div>
      </div>
      {err && <Note tone="error">{err}</Note>}
      {events.length === 0 ? (
        <div className="fx-block py-6 text-center text-sm text-ink/55">
          Nenhum evento registrado ainda. Eventos aparecem quando regras são ativadas, aprovações decididas, etc.
        </div>
      ) : (
        <ul className="space-y-1">
          {events.map(e => (
            <li key={e.id} className="fx-block py-2 px-3 flex items-start gap-3">
              <span className="text-xs text-ink/40 w-28 shrink-0 tabular-nums pt-0.5">{when(e.created_at)}</span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{EVENT_LABEL[e.event_type] ?? e.event_type}</p>
                <p className="text-xs text-ink/50">
                  {e.target_type && <span>{e.target_type.charAt(0).toUpperCase() + e.target_type.slice(1)}</span>}
                  {e.actor_role && <> · <span>{e.actor_role.charAt(0).toUpperCase() + e.actor_role.slice(1)}</span></>}
                  {e.outcome && <> · <span className={OUTCOME_COLOR[e.outcome] ?? ""}>{e.outcome}</span></>}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
