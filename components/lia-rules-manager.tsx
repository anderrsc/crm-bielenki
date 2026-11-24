"use client";
import { useState, useTransition, useMemo } from "react";
import { ChevronDown, ChevronRight, AlertTriangle, CheckCircle, Circle, Search, Shield, Zap, User, Ban } from "lucide-react";
import { toggleLiaRule, updateRuleAutonomy } from "@/app/(crm)/lia-central-actions";
import type { LiaRuleRow, AutonomyLevel, RiskLevel } from "@/lib/ai/lia-types";
import { AUTONOMY_LABEL, RISK_LABEL, BLOCKS } from "@/lib/ai/lia-types";
import { Note } from "@/components/form-blocks";

const AUTONOMY_ICON: Record<AutonomyLevel, React.ElementType> = { auto: Zap, approval: Shield, human_only: User, forbidden: Ban };
const AUTONOMY_COLOR: Record<AutonomyLevel, string> = {
  auto: "text-green-600",
  approval: "text-amber-600",
  human_only: "text-sky-600",
  forbidden: "text-red-600",
};

const VALIDATION_DOT: Record<string, string> = {
  pending: "bg-ink/25",
  validated: "bg-green-500",
  needs_review: "bg-amber-500",
  archived: "bg-red-400",
};

function RuleRow({ rule, onToggle, onAutonomy }: {
  rule: LiaRuleRow;
  onToggle: (id: string, next: boolean) => void;
  onAutonomy: (id: string, a: AutonomyLevel, r: RiskLevel) => void;
}) {
  const [open, setOpen] = useState(false);
  const AIcon = rule.autonomy_level ? AUTONOMY_ICON[rule.autonomy_level] : Circle;
  const aColor = rule.autonomy_level ? AUTONOMY_COLOR[rule.autonomy_level] : "text-ink/40";
  return (
    <li className="lia-rule">
      <div className="lia-rule-row" role="button" tabIndex={0} aria-expanded={open} onClick={() => setOpen(x => !x)} onKeyDown={e => e.key === "Enter" && setOpen(x => !x)}>
        <span className={`lia-rule-dot ${VALIDATION_DOT[rule.validation_status] ?? "bg-ink/25"}`} aria-hidden />
        <span className="lia-rule-num text-xs text-ink/50 w-9 shrink-0 tabular-nums">#{rule.rule_number ?? "—"}</span>
        <span className="lia-rule-title min-w-0 flex-1 truncate text-sm">{rule.title || rule.name}</span>
        <span className={`lia-rule-auto shrink-0 ${aColor}`} aria-label={rule.autonomy_level ? AUTONOMY_LABEL[rule.autonomy_level] : "sem nível"}>
          <AIcon className="h-3.5 w-3.5" aria-hidden />
        </span>
        {/* Toggle */}
        <button
          type="button"
          role="switch"
          aria-checked={rule.is_active}
          aria-label={rule.is_active ? "Desativar regra" : "Ativar regra"}
          className={`lia-switch shrink-0 ${rule.is_active ? "lia-switch-on" : "lia-switch-off"}`}
          onClick={e => { e.stopPropagation(); onToggle(rule.id, !rule.is_active); }}
        />
      </div>
      {open && (
        <div className="lia-rule-detail px-3 pb-3 pt-1">
          <p className="text-xs text-ink/60 mb-2">
            Validação: <b>{rule.validation_status}</b>
            {rule.risk_level && <> · Risco: <b>{RISK_LABEL[rule.risk_level]}</b></>}
          </p>
          <div className="flex flex-wrap gap-2">
            <div>
              <label className="text-xs text-ink/60 block mb-1">Autonomia</label>
              <select
                className="text-xs border rounded px-2 py-1"
                value={rule.autonomy_level ?? ""}
                onChange={e => onAutonomy(rule.id, e.target.value as AutonomyLevel, rule.risk_level ?? "medium")}
              >
                <option value="">— definir —</option>
                {(Object.entries(AUTONOMY_LABEL) as [AutonomyLevel, string][]).map(([v, l]) => (
                  <option key={v} value={v}>{l}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs text-ink/60 block mb-1">Risco</label>
              <select
                className="text-xs border rounded px-2 py-1"
                value={rule.risk_level ?? ""}
                onChange={e => onAutonomy(rule.id, rule.autonomy_level ?? "approval", e.target.value as RiskLevel)}
              >
                <option value="">— definir —</option>
                {(Object.entries(RISK_LABEL) as [RiskLevel, string][]).map(([v, l]) => (
                  <option key={v} value={v}>{l}</option>
                ))}
              </select>
            </div>
          </div>
          {rule.description && <p className="text-xs text-ink/70 mt-2 line-clamp-3">{rule.description}</p>}
        </div>
      )}
    </li>
  );
}

function CategorySection({ blockN, rules, search, onToggle, onAutonomy }: {
  blockN: number; rules: LiaRuleRow[]; search: string;
  onToggle: (id: string, next: boolean) => void;
  onAutonomy: (id: string, a: AutonomyLevel, r: RiskLevel) => void;
}) {
  const [open, setOpen] = useState(false);
  const block = BLOCKS.find(b => b.n === blockN);
  const filtered = useMemo(() => search
    ? rules.filter(r => r.title.toLowerCase().includes(search) || String(r.rule_number).includes(search))
    : rules, [rules, search]);
  if (search && filtered.length === 0) return null;
  const active = rules.filter(r => r.is_active).length;
  const total = rules.length;
  const ChevronIcon = (open || !!search) ? ChevronDown : ChevronRight;
  const isOpen = open || !!search;
  return (
    <div className="lia-section">
      <button
        type="button"
        className="lia-section-label"
        aria-expanded={isOpen}
        onClick={() => setOpen(x => !x)}
      >
        <ChevronIcon className="h-4 w-4 shrink-0 text-ink/40" aria-hidden />
        <span className="font-semibold text-sm flex-1 text-left">{block?.cat ?? `Bloco ${blockN}`}</span>
        <span className="text-xs text-ink/50 tabular-nums">{active}/{total} ativa{active !== 1 ? "s" : ""}</span>
        <span className="text-xs text-ink/40 tabular-nums">IDs {block?.s}–{block?.e}</span>
      </button>
      {isOpen && (
        <ul className="lia-rule-list">
          {filtered.map(r => (
            <RuleRow key={r.id} rule={r} onToggle={onToggle} onAutonomy={onAutonomy} />
          ))}
        </ul>
      )}
    </div>
  );
}

export function LiaRulesManager({ initialRules }: { initialRules: LiaRuleRow[] }) {
  const [rules, setRules] = useState(initialRules);
  const [search, setSearch] = useState("");
  const [msg, setMsg] = useState<{ text: string; tone: "ok" | "error" } | null>(null);
  const [, startT] = useTransition();

  const q = search.trim().toLowerCase();
  const grouped = useMemo(() => {
    const map = new Map<number, LiaRuleRow[]>();
    for (const r of rules) {
      const b = r.block_id ?? 0;
      if (!map.has(b)) map.set(b, []);
      map.get(b)!.push(r);
    }
    return Array.from(map.entries()).sort((a, b) => a[0] - b[0]);
  }, [rules]);

  const activeTotal = rules.filter(r => r.is_active).length;
  const validatedTotal = rules.filter(r => r.validation_status === "validated").length;

  function handleToggle(id: string, next: boolean) {
    setRules(prev => prev.map(r => r.id === id ? { ...r, is_active: next } : r));
    setMsg(null);
    startT(async () => {
      const result = await toggleLiaRule(id, next);
      if (result.error) {
        setRules(prev => prev.map(r => r.id === id ? { ...r, is_active: !next } : r));
        setMsg({ text: result.error, tone: "error" });
      } else {
        setMsg({ text: next ? "Regra ativada." : "Regra desativada.", tone: "ok" });
        setTimeout(() => setMsg(null), 3000);
      }
    });
  }

  function handleAutonomy(id: string, a: AutonomyLevel, r: RiskLevel) {
    setRules(prev => prev.map(rule => rule.id === id ? { ...rule, autonomy_level: a, risk_level: r } : rule));
    startT(async () => {
      const result = await updateRuleAutonomy(id, a, r);
      if (result.error) setMsg({ text: result.error, tone: "error" });
    });
  }

  return (
    <div className="space-y-3">
      <div className="fx-block">
        <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
          <div>
            <p className="text-sm font-semibold">973 regras de atendimento</p>
            <p className="text-xs text-ink/55">
              {activeTotal} ativa{activeTotal !== 1 ? "s" : ""} · {validatedTotal} validada{validatedTotal !== 1 ? "s" : ""} · ative somente após validar individualmente
            </p>
          </div>
          <div className="flex items-center gap-2 border rounded-lg px-3 py-1.5 bg-cream/50 text-sm">
            <Search className="h-4 w-4 text-ink/40" aria-hidden />
            <input
              type="search"
              placeholder="Buscar regra ou número…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="bg-transparent outline-none w-44 text-sm placeholder:text-ink/40"
              aria-label="Buscar regra"
            />
          </div>
        </div>
        <Note tone="warn">
          <AlertTriangle className="h-4 w-4 inline mr-1" />
          Nenhuma regra está ativa por padrão. Valide cada regra individualmente antes de ativar. Não ative em produção sem aprovação expressa.
        </Note>
      </div>
      {msg && <Note tone={msg.tone} role="status">{msg.text}</Note>}
      <div className="space-y-1">
        {grouped.map(([blockN, blockRules]) => (
          <CategorySection key={blockN} blockN={blockN} rules={blockRules} search={q} onToggle={handleToggle} onAutonomy={handleAutonomy} />
        ))}
        {!grouped.length && (
          <div className="fx-block text-sm text-ink/55 py-6 text-center">
            Nenhuma regra encontrada. A migration precisa ser aplicada no banco.
          </div>
        )}
      </div>
    </div>
  );
}
