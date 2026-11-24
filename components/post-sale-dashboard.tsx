"use client";

import { useState, useTransition } from "react";
import { AlertTriangle, CheckCircle2, Clock, MessageSquare, Star, TrendingUp } from "lucide-react";
import { SubmitButton } from "@/components/submit-button";
import { createPostSale, resolvePostSale, updatePostSaleStatus } from "@/app/(crm)/post-sale-actions";

export type PostSaleDashboardStats = {
 open_count: number;
 in_progress_count: number;
 resolved_last_30d: number;
 open_problems: number;
 ratings_last_30d: number;
 avg_rating_90d: number | null;
 overdue_followups: number;
};

const TYPE_LABELS: Record<string, string> = {
 avaliacao: "Avaliação",
 problema: "Problema",
 retorno_garantia: "Retorno (Garantia)",
 retorno_fora_garantia: "Retorno (Fora da Garantia)",
 follow_up: "Follow-up",
};

const STATUS_COLORS: Record<string, string> = {
 aberto: "bg-amber-500/15 text-amber-600",
 em_andamento: "bg-blue-500/15 text-blue-600",
 resolvido: "bg-green-500/15 text-green-600",
 cancelado: "bg-ink/10 text-ink/50",
};

/** Dashboard de pós-venda com estatísticas e formulário rápido de criação. */
export function PostSaleDashboard({ stats, back }: { stats: PostSaleDashboardStats | null; back: string }) {
 const [pending, start] = useTransition();
 const [showForm, setShowForm] = useState(false);

 return (
 <div className="space-y-6">
 {/* Cards de estatísticas */}
 <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
 <div className="card p-4">
 <div className="flex items-center gap-2 text-ink/55">
 <AlertTriangle size={16} />
 <span className="text-xs font-semibold ">Problemas abertos</span>
 </div>
 <p className="mt-2 text-3xl font-semibold text-red-600">{stats?.open_problems ?? 0}</p>
 </div>
 <div className="card p-4">
 <div className="flex items-center gap-2 text-ink/55">
 <Clock size={16} />
 <span className="text-xs font-semibold ">Em andamento</span>
 </div>
 <p className="mt-2 text-3xl font-semibold text-blue-600">{stats?.in_progress_count ?? 0}</p>
 </div>
 <div className="card p-4">
 <div className="flex items-center gap-2 text-ink/55">
 <Star size={16} />
 <span className="text-xs font-semibold ">Avaliação média (90d)</span>
 </div>
 <p className="mt-2 text-3xl font-semibold text-amber-500">
 {stats?.avg_rating_90d != null ? stats.avg_rating_90d.toFixed(1) : "—"}
 </p>
 </div>
 <div className="card p-4">
 <div className="flex items-center gap-2 text-ink/55">
 <TrendingUp size={16} />
 <span className="text-xs font-semibold ">Resolvidos (30d)</span>
 </div>
 <p className="mt-2 text-3xl font-semibold text-green-600">{stats?.resolved_last_30d ?? 0}</p>
 </div>
 </div>

 {/* Aviso de follow-ups atrasados */}
 {(stats?.overdue_followups ?? 0) > 0 && (
 <div className="flex items-center gap-2 rounded-lg bg-red-500/10 px-4 py-3 text-sm font-semibold text-red-600">
 <AlertTriangle size={16} />
 {stats!.overdue_followups} follow-up(s) atrasado(s) — verifique a lista abaixo
 </div>
 )}

 {/* Botão para abrir formulário de criação */}
 {!showForm && (
 <button onClick={() => setShowForm(true)} className="button inline-flex items-center gap-2">
 <MessageSquare size={16} /> Novo pós-venda
 </button>
 )}

 {/* Formulário de criação rápida */}
 {showForm && (
 <div className="card space-y-4 p-5">
 <div className="flex items-center justify-between">
 <h3 className="text-lg font-semibold">Novo pós-venda</h3>
 <button onClick={() => setShowForm(false)} className="text-sm text-ink/50 underline">Cancelar</button>
 </div>
 <form action={createPostSale} className="grid gap-3 sm:grid-cols-2">
 <input type="hidden" name="_back" value={back} />
 <label><span className="label">Pedido</span><input name="order_id" className="field" placeholder="UUID do pedido" required /></label>
 <label><span className="label">Cliente</span><input name="client_id" className="field" placeholder="UUID do cliente" required /></label>
 <label><span className="label">Tipo</span>
 <select name="type" className="field" required defaultValue="">
 <option value="" disabled>Escolha…</option>
 {Object.entries(TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
 </select></label>
 <label><span className="label">Prioridade</span>
 <select name="priority" className="field" defaultValue="normal">
 <option value="baixa">Baixa</option><option value="normal">Normal</option>
 <option value="alta">Alta</option><option value="urgente">Urgente</option>
 </select></label>
 <label className="sm:col-span-2"><span className="label">Título</span><input name="title" className="field" maxLength={200} required placeholder="Ex.: Cliente relatou vazamento na calha" /></label>
 <label className="sm:col-span-2"><span className="label">Descrição (opcional)</span><textarea name="description" className="field" rows={3} maxLength={2000} placeholder="Detalhes do problema ou avaliação…" /></label>
 <label><span className="label">Avaliação (1-5, opcional)</span>
 <select name="rating" className="field" defaultValue="">
 <option value="">Sem avaliação</option>
 {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n} estrela{n > 1 ? "s" : ""}</option>)}
 </select></label>
 <SubmitButton className="button sm:col-span-2" disabled={pending}>Criar pós-venda</SubmitButton>
 </form>
 </div>
 )}
 </div>
 );
}

/** Card individual de pós-venda com ações de resolução e mudança de status. */
export function PostSaleCard({ ps, canEdit, back }: { ps: { id: string; type: string; status: string; priority: string; title: string; description: string | null; rating: number | null; created_at: string; resolved_at: string | null }; canEdit: boolean; back: string }) {
 const [pending, start] = useTransition();

 return (
 <div className="card space-y-3 p-4">
 <div className="flex items-start justify-between gap-3">
 <div className="min-w-0 flex-1">
 <div className="flex flex-wrap items-center gap-2">
 <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATUS_COLORS[ps.status] ?? STATUS_COLORS.aberto}`}>{ps.status.replace("_", " ")}</span>
 <span className="rounded-full bg-ink/5 px-2 py-0.5 text-[11px] font-semibold text-ink/60">{TYPE_LABELS[ps.type] ?? ps.type}</span>
 {ps.priority !== "normal" && <span className="rounded-full bg-red-500/10 px-2 py-0.5 text-[11px] font-semibold text-red-600">{ps.priority}</span>}
 {ps.rating != null && <span className="inline-flex items-center gap-0.5 text-xs font-semibold text-amber-500"><Star size={12} fill="currentColor" /> {ps.rating}</span>}
 </div>
 <h3 className="mt-1 truncate font-semibold">{ps.title}</h3>
 {ps.description && <p className="mt-1 line-clamp-2 text-sm text-ink/60">{ps.description}</p>}
 <p className="mt-1 text-[11px] text-ink/40">Criado em {new Date(ps.created_at).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}{ps.resolved_at ? ` · Resolvido em ${new Date(ps.resolved_at).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}` : ""}</p>
 </div>
 </div>

 {canEdit && ps.status !== "resolvido" && ps.status !== "cancelado" && (
 <div className="flex flex-wrap gap-2 border-t border-ink/5 pt-3">
 {ps.status === "aberto" && (
 <form action={updatePostSaleStatus}>
 <input type="hidden" name="post_sale_id" value={ps.id} />
 <input type="hidden" name="status" value="em_andamento" />
 <input type="hidden" name="_back" value={back} />
 <SubmitButton className="button-ghost text-xs" disabled={pending}>Iniciar atendimento</SubmitButton>
 </form>
 )}
 <form action={resolvePostSale} className="inline-flex items-center gap-2">
 <input type="hidden" name="post_sale_id" value={ps.id} />
 <input type="hidden" name="_back" value={back} />
 <input name="resolution_notes" className="field w-48 text-xs" placeholder="Notas de resolução…" />
 <SubmitButton className="button text-xs" disabled={pending}><CheckCircle2 size={14} className="mr-1 inline" /> Resolver</SubmitButton>
 </form>
 </div>
 )}
 </div>
 );
}