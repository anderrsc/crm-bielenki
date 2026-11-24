"use client";
import Link from "next/link";
import { Boxes, CircleDollarSign, ClipboardCheck, Factory, HandCoins, Kanban, Receipt, Users, Wrench } from "lucide-react";
import { useCanSee } from "@/components/access-context";

/** Atalhos só com ícone (estilo "stories"): muitas funções a um toque, quase sem texto. Só entram as telas que o cargo pode ver. */
const LINKS = [
  { href: "/clientes", label: "Clientes", Icon: Users },
  { href: "/pedidos", label: "Pedidos", Icon: ClipboardCheck },
  { href: "/producao", label: "Produção", Icon: Factory },
  { href: "/instalacoes", label: "Instalar", Icon: Wrench },
  { href: "/compras", label: "Compras", Icon: HandCoins },
  { href: "/estoque", label: "Estoque", Icon: Boxes },
  { href: "/financeiro", label: "Caixa", Icon: CircleDollarSign },
  { href: "/pipeline", label: "Funil", Icon: Kanban },
  { href: "/vendas", label: "Vendas", Icon: Receipt },
] as const;

export function QuickLinks() {
  const canSee = useCanSee();
  const items = LINKS.filter(l => canSee(l.href));
  if (!items.length) return null;
  return (
    <nav className="mh-stories" aria-label="Atalhos">
      {items.map(({ href, label, Icon }) => (
        <Link key={href} href={href} className="mh-story-link">
          <span className="mh-story"><span><Icon size={22} /></span></span>
          <small>{label}</small>
        </Link>
      ))}
    </nav>
  );
}
