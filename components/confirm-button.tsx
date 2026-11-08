"use client";

import { useRef } from "react";
import { useFormStatus } from "react-dom";

export function ConfirmButton({
  formAction,
  message = "Tem certeza que deseja excluir? Esta ação não pode ser desfeita.",
  className,
  title,
  children,
}: {
  formAction: (fd: FormData) => Promise<void>;
  message?: string;
  className?: string;
  title?: string;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  // Desabilita enquanto envia: dois toques no celular não executam a ação duas vezes.
  const { pending } = useFormStatus();
  return (
    <button
      ref={ref}
      type="submit"
      disabled={pending}
      formAction={formAction as never}
      className={className}
      title={title}
      onClick={(e) => {
        if (!window.confirm(message)) e.preventDefault();
      }}
    >
      {children}
    </button>
  );
}
