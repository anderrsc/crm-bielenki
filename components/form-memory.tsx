"use client";
import { useRef } from "react";
import { useFormMemory } from "@/lib/form-draft";

/** Coloque dentro de um <form>: se o envio voltar com erro, o que foi digitado reaparece. */
export function FormMemory({ id }: { id: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  useFormMemory(`form-memory:${id}`, ref);
  return <span ref={ref} hidden />;
}
