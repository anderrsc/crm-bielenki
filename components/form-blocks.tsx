// Blocos visuais dos formulários (venda, compra, LIA): só apresentação, sem regra de negócio.
// Estilos em app/forms.css (classes fx-*).
import type { ElementType, ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Bloco com ícone, título e dica. Use no lugar de "card p-5" nos formulários. */
export function FormBlock({ icon: Icon, title, hint, aside, children, className, id }: {
  icon?: ElementType; title?: ReactNode; hint?: ReactNode; aside?: ReactNode; children: ReactNode; className?: string; id?: string;
}) {
  return (
    <section id={id} className={cn("fx-block", className)}>
      {(title || Icon) && (
        <header className="fx-block-head">
          {Icon && <span className="fx-ico" aria-hidden><Icon className="h-[18px] w-[18px]" /></span>}
          <div className="min-w-0 flex-1">
            {title && <h2 className="fx-block-title">{title}</h2>}
            {hint && <p className="fx-block-hint">{hint}</p>}
          </div>
          {aside}
        </header>
      )}
      {children}
    </section>
  );
}

/** Avisos curtos dentro do formulário: informação, atenção, tudo certo ou erro. */
export function Note({ tone = "info", children, className, role }: { tone?: "info" | "warn" | "ok" | "error"; children: ReactNode; className?: string; role?: string }) {
  return <div role={role} className={cn("fx-note", `fx-note-${tone}`, className)}>{children}</div>;
}

/** Escolha entre poucas opções (no lugar de "bg-cream p-1" feito à mão). */
export function Segmented<T extends string>({ label, value, onChange, options, disabled }: {
  label: string; value: T; onChange: (v: T) => void; options: readonly (readonly [T, string])[]; disabled?: boolean;
}) {
  return (
    <fieldset className="fx-field">
      <legend className="label">{label}</legend>
      <div className="fx-seg" style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
        {options.map(([v, l]) => (
          <button type="button" key={v} disabled={disabled} aria-pressed={value === v} onClick={() => onChange(v)}>{l}</button>
        ))}
      </div>
    </fieldset>
  );
}

/** Número do item ("1", "2"...) em círculo, para listas de itens. */
export function ItemBadge({ n }: { n: number }) {
  return <span className="fx-item-n" aria-hidden>{n}</span>;
}
