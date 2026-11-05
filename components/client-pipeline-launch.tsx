"use client";
import { useState } from "react";
import { CalendarClock, Ruler, Sparkles, PhoneCall, Ban } from "lucide-react";

const options = [
  { value: "novo", label: "Nova oportunidade", hint: "Entra em Novo lead", icon: Sparkles },
  { value: "contato", label: "Já conversamos", hint: "Entra em Contato realizado", icon: PhoneCall },
  { value: "medicao", label: "Agendar medição", hint: "Cria a medição na agenda", icon: Ruler },
  { value: "nao", label: "Não lançar", hint: "Só cadastrar o cliente", icon: Ban },
] as const;

/** Bloco do cadastro de cliente que já coloca o cliente no pipeline. */
export function ClientPipelineLaunch() {
  const [mode, setMode] = useState<(typeof options)[number]["value"]>("novo");
  return (
    <fieldset className="rounded-2xl border border-forest/20 bg-forest/[.04] p-4 sm:col-span-2">
      <legend className="px-2 text-sm font-black">Lançar no pipeline</legend>
      <input type="hidden" name="pipeline_mode" value={mode} />
      <div className="grid gap-2 sm:grid-cols-4" role="radiogroup" aria-label="Lançar no pipeline">
        {options.map(({ value, label, hint, icon: Icon }) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={mode === value}
            onClick={() => setMode(value)}
            className={`rounded-xl border p-3 text-left transition ${mode === value ? "border-forest bg-surface shadow-sm ring-2 ring-forest/30" : "border-ink/10 bg-cream/60 hover:border-forest/40"}`}
          >
            <Icon className={`h-4 w-4 ${mode === value ? "text-forest" : "text-ink/40"}`} />
            <span className="mt-2 block text-sm font-bold">{label}</span>
            <span className="block text-[11px] text-ink/50">{hint}</span>
          </button>
        ))}
      </div>
      {mode !== "nao" && (
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          {mode === "medicao" && (
            <div>
              <label className="label" htmlFor="pipeline_scheduled_at"><CalendarClock className="mr-1 inline h-3.5 w-3.5" />Data da medição</label>
              <input id="pipeline_scheduled_at" className="field" type="datetime-local" name="pipeline_scheduled_at" />
            </div>
          )}
          <div>
            <label className="label" htmlFor="pipeline_estimated_value">Valor estimado (opcional)</label>
            <input id="pipeline_estimated_value" className="field" type="number" min="0" step="0.01" name="pipeline_estimated_value" placeholder="0,00" />
          </div>
          {mode !== "medicao" && (
            <>
              <div>
                <label className="label" htmlFor="pipeline_next_action">Próxima ação</label>
                <input id="pipeline_next_action" className="field" name="pipeline_next_action" placeholder="Ex.: ligar, mandar fotos" />
              </div>
              <div>
                <label className="label" htmlFor="pipeline_next_action_date">Quando</label>
                <input id="pipeline_next_action_date" className="field" type="date" name="pipeline_next_action_date" />
              </div>
            </>
          )}
        </div>
      )}
    </fieldset>
  );
}
