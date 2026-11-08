"use client";

import { useFormStatus } from "react-dom";

// Botao de envio que trava enquanto o formulario envia: dois toques no celular nao duplicam nada.
export function SubmitButton({
  children,
  pendingText = "Salvando…",
  className,
  disabled,
  formAction,
  title,
}: {
  children: React.ReactNode;
  pendingText?: React.ReactNode;
  className?: string;
  disabled?: boolean;
  formAction?: (fd: FormData) => Promise<void>;
  title?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={className} disabled={disabled || pending} formAction={formAction as never} title={title} aria-busy={pending}>
      {pending ? pendingText : children}
    </button>
  );
}
