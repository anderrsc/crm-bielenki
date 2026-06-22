"use client";

import { useRef } from "react";

export function ConfirmButton({
  formAction,
  message = "Tem certeza que deseja excluir? Esta ação não pode ser desfeita.",
  className,
  children,
}: {
  formAction: (fd: FormData) => Promise<void>;
  message?: string;
  className?: string;
  title?: string;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  return (
    <button
      ref={ref}
      type="submit"
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
