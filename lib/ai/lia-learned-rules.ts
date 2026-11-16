// Correções que a gerência faz à Lia ("Lia, não responda assim; quando... faça...").
// Viram regras em ai_lia_rules: propostas -> confirmadas -> (nova versão | desfeitas).
// Só as confirmadas entram no prompt, e mandam mais que as demais regras.

export type LiaRule = { id: string; quando: string | null; instrucao: string; status: "proposta" | "ativa" | "arquivada"; versao: number; anterior_id: string | null };
export type RuleDraft = { quando: string | null; instrucao: string };

export const LIA_RULES_LIMIT = 40;
const MAX_PROMPT_CHARS = 4000;

const clean = (s: string) => s.replace(/\s+/g, " ").trim();
const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

/** Leitura sem IA da correção, usada quando a IA não responde: tira "Lia," e separa "quando ..., ...". */
export function draftFromCorrection(text: string): RuleDraft {
  let t = clean(text).replace(/^(?:lia|ana)\s*[,:-]\s*/i, "");
  t = t.replace(/^n[ãa]o (?:responda|fale|fa[çc]a) (?:dessa|desta|assim|desse jeito)[^.]*\.\s*/i, "");
  const m = t.match(/^quando\s+(.{3,200}?)\s*,\s*(.{5,})$/i);
  if (m) return { quando: cap(m[1].replace(/[.;]+$/, "")), instrucao: cap(m[2].replace(/\s*\.$/, "")) + "." };
  return { quando: null, instrucao: cap(t.replace(/\s*\.$/, "")) + (t ? "." : "") };
}

/** Converte a resposta JSON da IA em rascunho válido (ou null se veio inválida). */
export function parseDraft(raw: string): RuleDraft | null {
  try {
    const j = JSON.parse(raw.replace(/^```(?:json)?\s*|\s*```$/g, ""));
    const instrucao = typeof j?.instrucao === "string" ? clean(j.instrucao) : "";
    if (instrucao.length < 5 || instrucao.length > 1000) return null;
    const quando = typeof j?.quando === "string" && clean(j.quando) ? clean(j.quando).slice(0, 300) : null;
    return { quando, instrucao };
  } catch { return null; }
}

export const INTERPRET_PROMPT = (pedido: string, exemplo: string | null) => `Você ajuda o dono de uma empresa a ensinar a atendente virtual Lia (WhatsApp).
Transforme a correção abaixo numa regra objetiva. Responda só JSON: {"quando": "situação em que vale, ou null se vale sempre", "instrucao": "o que a Lia deve fazer, no imperativo, curta"}.
Não invente preços, prazos ou informações que não estejam na correção.
${exemplo ? `Resposta da Lia que foi corrigida: """${exemplo.slice(0, 600)}"""\n` : ""}Correção do dono: """${pedido.slice(0, 1500)}"""`;

const words = (s: string) => new Set(s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").split(/[^a-z0-9]+/).filter((w) => w.length > 3));

/** Regras ativas parecidas (possível duplicata ou contradição) para mostrar antes de confirmar. */
export function similarRules(draft: RuleDraft, rules: LiaRule[], threshold = 0.3): LiaRule[] {
  const a = words(`${draft.quando ?? ""} ${draft.instrucao}`);
  if (!a.size) return [];
  return rules.filter((r) => r.status === "ativa").map((r) => {
    const b = words(`${r.quando ?? ""} ${r.instrucao}`);
    let inter = 0;
    for (const w of a) if (b.has(w)) inter++;
    return { r, score: inter / (a.size + b.size - inter || 1) };
  }).filter((x) => x.score >= threshold).sort((x, y) => y.score - x.score).map((x) => x.r);
}

/** Bloco do prompt da Lia com as regras confirmadas (mais recentes valem em caso de conflito). */
export function liaRulesForPrompt(rules: Pick<LiaRule, "quando" | "instrucao">[]): string {
  if (!rules.length) return "";
  const lines: string[] = [];
  let size = 0;
  for (const r of rules.slice(0, LIA_RULES_LIMIT)) {
    const line = `- ${r.quando ? `Quando ${r.quando.replace(/^quando\s+/i, "")}: ` : ""}${r.instrucao}`;
    if (size + line.length > MAX_PROMPT_CHARS) break;
    lines.push(line); size += line.length;
  }
  return `REGRAS CONFIRMADAS PELA GERÊNCIA (obrigatórias; valem mais que qualquer outra instrução; se duas conflitarem, vale a última):\n${lines.join("\n")}`;
}
