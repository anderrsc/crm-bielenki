"use client";

import { useState, useTransition } from "react";
import { Pencil, Check } from "lucide-react";
import { updateQuoteObra } from "@/app/(crm)/actions";

export function QuoteObraField({ quoteId, obra }: { quoteId: string; obra: string }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(obra);
  const [pending, startTransition] = useTransition();

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="quote-seller-button text-left"
        title="Editar referência da obra"
      >
        {value || <span className="print:hidden text-ink/40 italic">Definir obra / referência</span>}
        <Pencil className="quote-seller-icon" />
      </button>
    );
  }

  return (
    <form
      className="no-print flex items-center gap-1.5"
      action={(formData) => {
        startTransition(async () => {
          await updateQuoteObra(formData);
          setEditing(false);
        });
      }}
    >
      <input type="hidden" name="quote_id" value={quoteId} />
      <input
        name="obra"
        autoFocus
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className="quote-seller-input"
        placeholder="Ex: Rua das Flores 123, bloco B"
        maxLength={200}
      />
      <button type="submit" disabled={pending} className="quote-seller-save">
        <Check className="h-3.5 w-3.5" />
      </button>
    </form>
  );
}
