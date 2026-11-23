"use client";

import { useRef } from "react";
import { useFormStatus } from "react-dom";
import { confirmAction } from "@/components/ui-feedback/confirm";

/** Título e tom da confirmação a partir da pergunta: só exclusão diz "exclusão". */
export function confirmKind(message: string): { title: string; danger: boolean } {
  const m = message.toLocaleLowerCase("pt-BR");
  if (/exclu|apagar|remover/.test(m)) return { title: "Confirmar exclusão", danger: true };
  if (/estorn/.test(m)) return { title: "Confirmar estorno", danger: true };
  if (/cancel/.test(m)) return { title: "Confirmar cancelamento", danger: true };
  if (/desfaz|revert/.test(m)) return { title: "Confirmar reversão", danger: true };
  if (/aprova/.test(m)) return { title: "Confirmar aprovação", danger: false };
  return { title: "Confirmar", danger: false };
}

export function ConfirmButton({
  formAction,
  message = "Tem certeza que deseja excluir? Esta ação não pode ser desfeita.",
  className,
  title,
  children,
}: {
  formAction?: (fd: FormData) => Promise<void>;
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
        // Pergunta no diálogo do sistema; se confirmar, envia o mesmo formulário por este botão.
        e.preventDefault();
        const button = ref.current;
        const kind = confirmKind(message);
        void confirmAction({ title: title ?? kind.title, message, confirmLabel: "Sim, continuar", danger: kind.danger }).then((ok) => {
          if (ok && button?.form) button.form.requestSubmit(button);
        });
      }}
    >
      {children}
    </button>
  );
}
