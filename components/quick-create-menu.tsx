"use client";
// Botão "+ Novo" da barra superior: começar orçamento, cliente, venda ou compra de qualquer tela.
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import Link from "next/link";
import { Plus } from "lucide-react";

export type QuickCreateItem = { label: string; href: string };

export function QuickCreateMenu({ items }: { items: QuickCreateItem[] }) {
  if (!items.length) return null;
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button className="button hidden min-h-0 gap-1 px-3 py-2 text-sm sm:inline-flex" aria-label="Criar novo"><Plus className="h-4 w-4" /> Novo</button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align="end" sideOffset={8} className="z-50 min-w-56 rounded-xl border border-sand bg-surface p-1.5 text-sm text-ink shadow-xl">
          {items.map((i) => (
            <DropdownMenu.Item key={i.href} asChild>
              <Link href={i.href} className="flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2.5 outline-none focus:bg-cream"><Plus className="h-4 w-4 text-forest" />{i.label}</Link>
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
