"use client";
// Marcar ja salva: envia o formulario do item na hora (sem apertar "Salvar").
export function AutoSubmitCheckbox({ name, defaultChecked, className }: { name: string; defaultChecked?: boolean; className?: string }) {
  return <input className={className} type="checkbox" name={name} defaultChecked={defaultChecked}
    onChange={(e) => e.currentTarget.form?.requestSubmit()} />;
}
