"use client";

import { createClientRecord } from "@/app/(crm)/actions";
import { Save, UserPlus, X } from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal, useFormStatus } from "react-dom";
import { ClientPhoneField } from "./client-phone-field";
import { ClientPipelineLaunch } from "./client-pipeline-launch";

const states = "AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO".split(" ");

/** Cadastro rápido de cliente direto do Dashboard (já lança no pipeline). */
export function QuickClientDialog({ sources = [] }: { sources?: { id: string; name: string }[] }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent) => event.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", close);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", close); document.body.style.overflow = previous; };
  }, [open]);

  return <>
    <button type="button" onClick={() => setOpen(true)} className="button-ghost flex items-center gap-2">
      <UserPlus className="h-4 w-4" /> Novo cliente
    </button>
    {open && createPortal(
      <div className="fixed inset-0 z-[100] flex items-start justify-center overflow-y-auto bg-cream/70 p-4 sm:items-center" role="presentation" onMouseDown={() => setOpen(false)}>
        <section role="dialog" aria-modal="true" aria-labelledby="quick-client-title" className="my-auto w-full max-w-2xl rounded-2xl border border-sand bg-surface p-5 shadow-2xl sm:p-6" onMouseDown={event => event.stopPropagation()}>
          <div className="mb-5 flex items-center justify-between gap-3">
            <div><h2 id="quick-client-title" className="text-xl font-black">Novo cliente</h2><p className="text-xs text-ink/50">Cadastro rápido. Endereço completo pode ser preenchido depois.</p></div>
            <button type="button" aria-label="Fechar" onClick={() => setOpen(false)} className="button-ghost p-2"><X className="h-4 w-4" /></button>
          </div>
          <form action={createClientRecord} className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2"><label className="label" htmlFor="quick-name">Nome</label><input id="quick-name" className="field" name="name" required autoFocus /></div>
            <ClientPhoneField />
            <div><label className="label" htmlFor="quick-source">Origem do lead</label><select id="quick-source" className="field" name="lead_source_id" defaultValue=""><option value="">Não informado</option>{sources.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
            <div><label className="label" htmlFor="quick-neighborhood">Bairro</label><input id="quick-neighborhood" className="field" name="neighborhood" /></div>
            <div className="grid grid-cols-[1fr_88px] gap-3">
              <div><label className="label" htmlFor="quick-city">Cidade</label><input id="quick-city" className="field" name="city" /></div>
              <div><label className="label" htmlFor="quick-state">UF</label><select id="quick-state" className="field" name="state" defaultValue="SC">{states.map(s => <option key={s}>{s}</option>)}</select></div>
            </div>
            <ClientPipelineLaunch />
            <div className="flex justify-end gap-3 sm:col-span-2">
              <button type="button" onClick={() => setOpen(false)} className="button-ghost">Cancelar</button>
              <SubmitButton />
            </div>
          </form>
        </section>
      </div>,
      document.body,
    )}
  </>;
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return <button className="button" disabled={pending}><Save className="h-4 w-4" />{pending ? "Salvando..." : "Salvar cliente"}</button>;
}
