import { CalendarClock, CheckCircle2, Ruler, Scissors } from "lucide-react";
import { SubmitButton } from "@/components/submit-button";
import { answerMeasureDecision, finishMeasureCheck, releaseCut, scheduleMeasureCheck, validateMeasures } from "@/app/(crm)/order-operation-actions";
import { shortDate, todayISO } from "@/lib/utils";

export type OrderOperation = {
  order_id: string; op_stage: string | null; cut_released_at?: string | null;
  check?: { status: string; scheduled_at: string | null; responsible_name?: string | null; notes?: string | null } | null;
};
export type Person = { id: string; full_name: string };

export const OP_STAGE_LABEL: Record<string, string> = {
  aguardando_decisao: "Definir conferência de medidas", aguardando_conferencia: "Aguardando conferência de medidas",
  aguardando_validacao: "Medidas alteradas: aguardando validação", revisar_orcamento: "Revisar orçamento",
  aguardando_liberacao_corte: "Medidas confirmadas: aguardando liberação para corte", liberado_corte: "Liberado para corte",
};

const timeBR = (iso: string) => new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));

/** Etapa operacional do pedido depois do fechamento, com a acao que falta. Nao bloqueia a tela: pode ser retomada depois. */
export function OrderOperationCard({ op, people, canUpdate, isManager, back, compact = false }: { op: OrderOperation; people: Person[]; canUpdate: boolean; isManager: boolean; back: string; compact?: boolean }) {
  const stage = op.op_stage;
  if (!stage) return null;
  const hidden = <><input type="hidden" name="order_id" value={op.order_id} /><input type="hidden" name="_back" value={back} /></>;
  const responsible = <label><span className="label">Responsável</span><select name="responsible_id" className="field"><option value="">Não definido</option>{people.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}</select></label>;
  const notes = (placeholder: string) => <label className="sm:col-span-2"><span className="label">Observações</span><input name="notes" className="field" maxLength={500} placeholder={placeholder} /></label>;
  const scheduled = op.check?.status === "agendada" && op.check.scheduled_at;

  return <section id="etapa-operacional" className={`scroll-mt-28 rounded-2xl border ${stage === "liberado_corte" ? "border-emerald-200 bg-emerald-50/40" : "border-amber-300 bg-amber-50/60"} ${compact ? "p-4" : "p-5 sm:p-7"}`}>
    <p className="text-xs font-semibold text-ink/55">Etapa do pedido</p>
    <h2 className={`mt-1 font-semibold ${compact ? "text-base" : "text-xl"}`}>{OP_STAGE_LABEL[stage] ?? stage}</h2>

    {stage === "aguardando_decisao" && <>
      <p className="mt-2 text-sm">Este pedido precisa de conferência de medidas antes de iniciar a produção?</p>
      {canUpdate ? <div className="mt-4 flex flex-wrap gap-3">
        <form action={answerMeasureDecision}>{hidden}<input type="hidden" name="needs" value="sim" />
          <SubmitButton className="button"><span className="inline-flex items-center gap-2"><Ruler size={16} /> Sim, precisa conferir</span></SubmitButton></form>
        <form action={answerMeasureDecision}>{hidden}<input type="hidden" name="needs" value="nao" />
          <SubmitButton className="button-ghost"><span className="inline-flex items-center gap-2"><CheckCircle2 size={16} /> Não, medidas já conferidas</span></SubmitButton></form>
      </div> : <p className="mt-3 text-sm text-ink/60">Seu acesso não permite responder.</p>}
      <p className="mt-3 text-xs text-ink/55">Você pode responder depois: o pedido continua marcado como pendente na Agenda e na Produção.</p>
    </>}

    {stage === "aguardando_conferencia" && <>
      <p className="mt-2 text-sm">{scheduled ? <>Visita marcada para <strong>{shortDate(op.check!.scheduled_at!)} às {timeBR(op.check!.scheduled_at!)}</strong>{op.check?.responsible_name ? ` · ${op.check.responsible_name}` : ""}.</> : "A conferência ainda não tem data. Agende a visita."}</p>
      {op.check?.notes && <p className="mt-1 text-sm text-ink/60">Obs.: {op.check.notes}</p>}
      {canUpdate && <>
        <details className="mt-4" open={!scheduled}><summary className="cursor-pointer text-sm font-semibold"><span className="inline-flex items-center gap-2"><CalendarClock size={16} /> {scheduled ? "Reagendar conferência" : "Agendar conferência"}</span></summary>
          <form action={scheduleMeasureCheck} className="mt-3 grid gap-3 sm:grid-cols-2">{hidden}
            <label><span className="label">Data</span><input type="date" name="date" className="field" required min={todayISO()} /></label>
            <label><span className="label">Horário</span><input type="time" name="time" className="field" defaultValue="08:00" required /></label>
            {responsible}{notes("Ex.: levar escada, cliente só atende à tarde")}
            <SubmitButton className="button sm:col-span-2">Salvar agendamento</SubmitButton>
          </form>
        </details>
        <details className="mt-4"><summary className="cursor-pointer text-sm font-semibold"><span className="inline-flex items-center gap-2"><CheckCircle2 size={16} /> Registrar resultado da visita</span></summary>
          <form action={finishMeasureCheck} className="mt-3 grid gap-3 sm:grid-cols-2">{hidden}
            <label className="sm:col-span-2"><span className="label">Resultado</span><select name="result" className="field" required defaultValue="">
              <option value="" disabled>Escolha…</option><option value="conferidas">Medidas conferidas (iguais ao orçamento)</option><option value="alteradas">Medidas alteradas</option>
              <option value="revisar_orcamento">Precisa revisar o orçamento</option><option value="nova_visita">Nova visita necessária</option></select></label>
            {notes("O que foi conferido ou o que mudou")}
            <SubmitButton className="button sm:col-span-2">Salvar resultado</SubmitButton>
          </form>
        </details>
      </>}
    </>}

    {(stage === "aguardando_validacao" || stage === "revisar_orcamento") && <>
      <p className="mt-2 text-sm">{stage === "aguardando_validacao" ? "A conferência encontrou medidas diferentes do orçamento." : "A conferência indicou que o orçamento precisa ser revisado."} A gerência precisa validar antes de liberar para corte.</p>
      {isManager && canUpdate ? <form action={validateMeasures} className="mt-4 grid gap-3 sm:grid-cols-2">{hidden}{notes("O que foi ajustado ou combinado com o cliente")}
        <SubmitButton className="button sm:col-span-2">Validar medidas e seguir para o corte</SubmitButton></form>
        : <p className="mt-3 text-sm text-ink/60">Aguardando a gerência validar.</p>}
    </>}

    {stage === "aguardando_liberacao_corte" && <>
      <p className="mt-2 text-sm">As medidas estão confirmadas. Confirme quando o pedido for enviado para corte (confirmar medidas não significa que as peças já foram cortadas).</p>
      {canUpdate ? <form action={releaseCut} className="mt-4 grid gap-3 sm:grid-cols-2">{hidden}
        <label><span className="label">Data da liberação</span><input type="date" name="date" className="field" defaultValue={todayISO()} /></label>
        {responsible}{notes("Ex.: cortar primeiro as peças da fachada")}
        <SubmitButton className="button sm:col-span-2"><span className="inline-flex items-center gap-2"><Scissors size={16} /> Confirmar envio para corte</span></SubmitButton>
      </form> : <p className="mt-3 text-sm text-ink/60">Seu acesso não permite liberar para corte.</p>}
    </>}

    {stage === "liberado_corte" && <p className="mt-2 text-sm">Liberado para corte{op.cut_released_at ? ` em ${shortDate(op.cut_released_at)}` : ""}. Acompanhe as etapas na aba Produção.</p>}

    {canUpdate && stage !== "aguardando_decisao" && stage !== "aguardando_conferencia" && <form action={answerMeasureDecision} className="mt-4">{hidden}
      <input type="hidden" name="needs" value="sim" /><input type="hidden" name="redo" value="1" />
      <button className="text-sm font-semibold text-ink/60 underline">Solicitar nova conferência de medidas</button>
    </form>}
  </section>;
}
