"use client";

import { useState, useTransition } from "react";
import { Pencil, Check } from "lucide-react";
import { updateQuoteSeller } from "@/app/(crm)/actions";

export function QuoteSellerField({ quoteId, sellerName }: { quoteId: string; sellerName: string }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(sellerName);
  const [pending, startTransition] = useTransition();

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="quote-bar-value quote-seller-button no-print"
        title="Editar vendedor"
      >
        {value || "Definir vendedor"}
        <Pencil className="quote-seller-icon" />
      </button>
    );
  }

  return (
    <form
      className="no-print flex items-center gap-1.5"
      action={(formData) => {
        startTransition(async () => {
          await updateQuoteSeller(formData);
          setEditing(false);
        });
      }}
    >
      <input type="hidden" name="quote_id" value={quoteId} />
      <input
        name="seller_name"
        autoFocus
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className="quote-seller-input"
        placeholder="Nome do vendedor"
      />
      <button type="submit" disabled={pending} className="quote-seller-save">
        <Check className="h-3.5 w-3.5" />
      </button>
    </form>
  );
}
