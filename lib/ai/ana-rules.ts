// Regras da Lia preenchidas pelo dono (Central de IA) + o que ela aprendeu das conversas da equipe.
// Ficam em ai_agent_config.system_prompt (texto livre) e entram no prompt de cada atendimento.

export const LEARNED_HEADER = "## Aprendido das conversas da equipe";

/** Perguntas para o dono responder. O que já foi dito ao montar a Lia vem preenchido. */
export const ANA_RULES_TEMPLATE = `## Regras da empresa (responda embaixo de cada pergunta; o que ficar em branco a Lia ignora)

1. Peça avulsa / chapa lisa (cliente compra e instala sozinho): o que a Lia precisa perguntar?
R: Qual a peça (rufo, calha, pingadeira, chapa lisa), comprimento, largura (ou corte), espessura e material, cor e quantidade. Não precisa de visita.

2. Quais espessuras, materiais e cores vocês trabalham nas peças dobradas?
R:

3. Calhas, rufos, pingadeiras e condutores COM instalação: o que perguntar?
R: Se já tem as medidas, o local da obra (cidade e bairro) e pedir foto do local e/ou projeto. Sem medidas: visita técnica.

4. Esquadrias (janelas, portas, fachadas): o que perguntar?
R:

5. Portões, guarda-corpos, coberturas, pergolados e estruturas: o que perguntar?
R:

6. Quais cidades vocês atendem? Fora delas, o que dizer?
R:

7. A visita técnica é cobrada? Como agenda (dias, horários)?
R:

8. Peça avulsa: retira na empresa, entrega, ou os dois? Endereço e horário para retirada:
R:

9. Prazo médio de fabricação/instalação que a Lia pode informar (ou "não informar"):
R:

10. Formas de pagamento que a Lia pode informar (ou "não informar"):
R:

11. Quando a Lia deve parar e chamar alguém da equipe?
R: Conserto, garantia, vazamento, reclamação, cliente pedindo preço na hora ou pedindo para falar com uma pessoa.

12. Palavras, jeitos de falar ou assuntos que a Lia NUNCA deve usar:
R: Não falar preço. Não mandar lista de opções. Não pedir "responda sim ou não".

13. Outras regras:
R:
`;

/** Junta as regras escritas com a seção aprendida (troca a seção antiga). */
export function withLearned(rules: string, learned: string): string {
  const base = rulesWithoutLearned(rules);
  return `${base}\n\n${LEARNED_HEADER}\n${learned.trim()}\n`.trimStart();
}

export function rulesWithoutLearned(rules: string): string {
  const i = rules.indexOf(LEARNED_HEADER);
  return (i >= 0 ? rules.slice(0, i) : rules).trim();
}

/** Texto que vai para o prompt: só perguntas respondidas + aprendizado. */
export function rulesForPrompt(rules: string | null | undefined): string {
  if (!rules?.trim()) return "";
  const out: string[] = [];
  const [own, learned] = [rulesWithoutLearned(rules), rules.includes(LEARNED_HEADER) ? rules.slice(rules.indexOf(LEARNED_HEADER) + LEARNED_HEADER.length).trim() : ""];
  const blocks = own.split(/\n(?=\d+\.\s)/);
  for (const b of blocks) {
    const q = b.match(/^\d+\.\s*(.+?)\n\s*R:\s*([\s\S]*)$/);
    if (q) { if (q[2].trim()) out.push(`- ${q[1].trim()} → ${q[2].trim()}`); }
    else if (!/^##/.test(b.trim()) && b.trim()) out.push(b.trim());
  }
  // Regras antigas falam "a Ana": o nome da assistente mudou para Lia.
  for (let i = 0; i < out.length; i++) out[i] = out[i].replace(/\bAna\b/g, "Lia");
  let text = out.length ? `REGRAS DA EMPRESA (mandam mais que qualquer outra instrução):\n${out.join("\n")}` : "";
  if (learned) text += `${text ? "\n\n" : ""}COMO A EQUIPE COSTUMA ATENDER (use como referência de tom e de perguntas; nunca cite preços daqui):\n${learned.slice(0, 3000)}`;
  return text;
}
