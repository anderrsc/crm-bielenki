"use client";

import { correctClientPhone } from "@/lib/client-phone";

export function ClientPhoneField({ value }: { value?: string | null }) {
  return (
    <label>
      <span className="label">Telefone / WhatsApp</span>
      <input className="field" name="phone" type="tel" autoComplete="tel" defaultValue={value ?? ""}
        onBlur={event => {
          event.currentTarget.value = correctClientPhone(event.currentTarget.value);
        }} />
    </label>
  );
}
