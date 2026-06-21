"use client";

import { useTransition } from "react";
import { updateQuotePaymentMethods } from "@/app/(crm)/actions";

export function QuotePaymentMethods({
  quoteId,
  available,
  selected,
  labels,
}: {
  quoteId: string;
  available: string[];
  selected: string[];
  labels: Record<string, string>;
}) {
  const [pending, startTransition] = useTransition();

  function toggle(method: string, checked: boolean) {
    const next = checked ? [...new Set([...selected, method])] : selected.filter((m) => m !== method);
    const formData = new FormData();
    formData.set("quote_id", quoteId);
    formData.set("payment_methods", JSON.stringify(next));
    startTransition(() => updateQuotePaymentMethods(formData));
  }

  return (
    <div className="quote-pay-icons">
      {available.map((method) => {
        const isChecked = selected.includes(method);
        return (
          <label key={method} className="quote-pay-item" data-checked={isChecked}>
            <input
              type="checkbox"
              className="no-print"
              checked={isChecked}
              disabled={pending}
              onChange={(e) => toggle(method, e.target.checked)}
            />
            <span>{labels[method] || method}</span>
          </label>
        );
      })}
    </div>
  );
}
