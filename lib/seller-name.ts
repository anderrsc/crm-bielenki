/** Primeiro nome do perfil, usado como vendedor padrao do orcamento. */
export function firstName(fullName: string | null | undefined): string {
  return (fullName || "").trim().split(/\s+/)[0] || "";
}
