const resources: Record<string, string> = {
  clientes: "clients", pipeline: "leads", orcamentos: "quotes", vendas: "sales",
  pedidos: "orders", compras: "purchase_orders", fornecedores: "suppliers",
  estoque: "materials", producao: "production_orders", instalacoes: "installations",
  financeiro: "financial_entries", relatorios: "sales", auditoria: "audit_logs",
  agenda: "operational_events", medicoes: "measurements", "tabela-calhas": "gutter_prices",
  funcionarios: "profiles", usuarios: "profiles",
};

export const moduleResources = [...new Set(Object.values(resources))];

export function moduleAccess(pathname: string) {
  const [, section, page] = pathname.split("/");
  if (section === "configuracoes" && (page === "funcionarios" || page === "usuarios")) {
    return { resource: "profiles", management: false };
  }
  if (section === "ficha") return { resource: page === "branco" ? "measurements" : "clients", management: false };
  if (section === "api" && page === "orcamentos") return { resource: "quotes", management: false };

  return {
    resource: Object.hasOwn(resources, section) ? resources[section] : null,
    management: ["configuracoes", "automacoes", "agente-ia", "central-ia"].includes(section),
  };
}

export function isManagement(roles: readonly string[]) {
  return roles.some(role => role === "administrador" || role === "gerente");
}
