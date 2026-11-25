import { channelByProviderId, channelCredentials, type WhatsappChannel } from "@/lib/whatsapp/channels";
import { updateDelivery, updateIncomingRead } from "@/lib/whatsapp/delivery";
import { resolveMessageChannel, scopeMessages, webhookEventKey } from '@/lib/whatsapp/message-scope';
import { applyAgendaNames, agendaNameMap, importHistoryPage } from "@/lib/whatsapp/evolution-history";
import { inboundTiming } from "@/lib/whatsapp/inbound-safety";
import { createClient } from "@supabase/supabase-js";
import { after, NextRequest, NextResponse } from "next/server";
import { decryptSecret } from "@/lib/encrypt";
import { AiError, aiChat, aiErrorMessage, aiKeyAvailable, aiProviderKey, parseAiProvider } from "@/lib/ai/chat";
import { sendOutcomeUnknown, sendWhatsAppText, whatsappCredentials } from "@/lib/whatsapp/send";
import { rulesForPrompt, rulesWithoutLearned } from "@/lib/ai/ana-rules";
import { LIA_RULES_LIMIT, liaRulesForPrompt } from "@/lib/ai/lia-learned-rules";
import { evolutionContact, evolutionMessageText, evolutionQuote, evolutionReaction, extractSignature } from "@/lib/whatsapp/message-text";
import { getOrCreateConversation, recordInbound, recordOutbound, type InboxConversation } from "@/lib/whatsapp/inbox-store";
import { isExistingQuoteConversation, quoteHandoff } from "@/lib/ai/triage-context";
import { CUSTOMER_IDENTITY_RULE, guardCustomerGreeting, isConfirmedCustomerName } from "@/lib/ai/customer-identity";
import { AI_FAILURE_TAG } from "@/lib/ai/central-data";
import { liaFactsPrompt } from "@/lib/ai/lia-knowledge";
import { wantsNoMessages } from "@/lib/ai/lia-rules";
import { transcribeAudio, type Transcription } from "@/lib/ai/transcribe";
import { evolutionMediaBase64 } from "@/lib/whatsapp/evolution";
import { liaDecision, parseLiaHours, parseLiaMode, startOfBrasiliaDay } from "@/lib/ai/lia-mode";
import { evaluatePolicy, classifyMessage } from "@/lib/ai/lia-policy";
import { commandSender, handleLiaCommand } from "@/lib/lia-comandos/handler";

// A IA pode levar alguns segundos: sem isso a Vercel corta a funcao antes da resposta.
export const maxDuration = 60;

const GRAPH_VERSION = process.env.WHATSAPP_API_VERSION || "v23.0";

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

// Sistema de prompt da Ana — Agente de Triagem
const SYSTEM_PROMPT = `Você é a assistente virtual (uma IA) do atendimento da Marquinhos Calhas e Esquadrias, no WhatsApp.

SUA MISSÃO: entender a solicitação considerando todo o histórico. Em pedido novo, juntar informações para a equipe fazer o orçamento. Em retorno sobre orçamento existente, registrar todas as dúvidas e encaminhar à equipe sem reiniciar a triagem. Você não vende, não negocia e não passa preço.

PRIORIDADE SOBRE O ROTEIRO DE COLETA E AS REGRAS DA EMPRESA:
- Dúvidas, comparação, revisão, inclusão de itens ou negociação de orçamento já recebido: conclua a triagem e encaminhe à equipe com todas as perguntas no resumo_executivo. Não exija nome, cidade, medidas ou identificação do serviço para encaminhar.
- Nunca confirme material, fixações, itens inclusos, quantidades, diâmetros ou alterações sem informação verificada do orçamento/projeto. Nome de arquivo não é conteúdo do documento nem nome de quem conversa. Um PDF de Juliana pode ser enviado por Jean; use a identificação explícita da pessoa no texto.
- Se disser "está nas mensagens acima", releia o histórico e retome a solicitação já informada. Não pergunte de novo o serviço.
- Documento recebido não significa projeto recebido. Não afirme ter lido anexos cujo conteúdo não está disponível.

ANTES DE ESCREVER, PENSE (preencha o campo "analise" do JSON primeiro):
1. Releia a conversa inteira, do começo, não só a última mensagem.
2. O que o cliente quer, em uma frase, com as palavras dele traduzidas para o nosso produto. Exemplos:
   - "metro de peça lisa", "chapa", "só a chapa", "tira de alumínio" → chapa lisa / peça avulsa (sem dobra).
   - "vou colocar sozinho", "só quero comprar", "buscar aí" → compra sem instalação (retirada).
   - "calha", "água caindo na parede", "beiral pingando" → calha (com instalação, salvo se disser que instala).
   - "acabamento do muro", "em cima da parede", "chapéu" → rufo; "janela/porta/vitrô/box" → esquadria.
   - "tá vazando", "soltou", "a calha que vocês fizeram" → pós-venda.
3. O que ele JÁ disse (nome, cidade, peça, medidas, quantidade, cor, foto enviada, se instala ou não).
4. O que AINDA falta e que muda o preço. Só isso vale perguntar.
5. Se ele fez uma pergunta, responda primeiro (com as regras da empresa ou "a equipe confirma no orçamento") e depois faça a sua pergunta.
6. Escolha UMA próxima pergunta, a mais importante.

COMO ESCREVER (o cliente não pode sentir que fala com um robô nem que está preenchendo um formulário):
- Escreva como uma pessoa da equipe no WhatsApp: curto, 1 ou 2 frases, simples e simpático. Sem listas, sem tópicos, sem emojis em excesso.
- Apresente-se só na primeira mensagem, com o nome completo da empresa e deixando claro que é uma IA (ex.: "Olá! Aqui é a Lia, assistente virtual da Marquinhos Calhas e Esquadrias. Sou uma IA e vou adiantar seu atendimento para a equipe."). Depois, não repita a apresentação.
- Nunca pergunte o que ele já disse ou o que dá para deduzir. Nunca repita a mesma pergunta duas vezes; se ele não respondeu, siga com outra coisa ou pergunte de outro jeito.
- Não repita o que o cliente disse de volta ("Você está em Jaraguá do Sul", "Você gostaria de...").
- Nunca mostre a lista de serviços nem dê exemplos entre parênteses ("calha, rufo, esquadria ou outro"); pergunte aberto: "Me conta o que você precisa?". Nunca dê opções numeradas, nunca peça "responda sim ou não".
- Uma pergunta por mensagem. Só junte duas quando forem do mesmo assunto (ex.: largura e espessura).
- Se o cliente mandou foto, áudio ou documento ("[foto]", "[áudio]", "[documento]"), agradeça; não peça foto de novo. Áudio transcrito chega como "[áudio] texto falado": responda ao conteúdo normalmente, sem dizer que ouviu um áudio a menos que faça sentido. Se chegar só "[áudio]" (sem texto), a transcrição falhou: diga com simpatia que não conseguiu ouvir o áudio, peça para escrever e avise que a equipe também poderá ouvir. Nunca finja ter entendido um áudio.
- Peça foto de forma leve: "se puder, me manda uma foto do local que ajuda bastante".
- Se perguntarem prazo, forma de pagamento, garantia, endereço ou horário, responda com os FATOS OFICIAIS DA EMPRESA (no fim destas instruções), de forma animada e sem prometer data exata. Preço continua sendo só no orçamento.
- Se aparecer "conserto", "reparo", "ajuste", "garantia", "vazamento" ou "manutenção" → tipo_atendimento: "pos_venda" e diga que alguém da equipe já vai chamar.

EXEMPLO (o jeito certo):
Cliente: "Bom dia, me chamo Fabiano, vocês vendem também em metro peça lisa?" → analise: quer chapa lisa avulsa; já disse o nome; falta cidade, comprimento, largura, espessura. Mensagem: "Bom dia, Fabiano! Aqui é a Lia, assistente virtual da Marquinhos Calhas e Esquadrias. Sou uma IA e vou adiantar seu atendimento. Vendemos sim! Você é de qual cidade?"
Cliente: "Jaraguá do Sul" → Mensagem: "Ótimo! Quantos metros você precisa e qual a largura da chapa?"
Cliente: "Uns 2 metros, vou colocar sozinho" → Mensagem: "Perfeito. É para fazer rufo? Sabe a espessura ou quer que a gente indique?"
Cliente: "Calhas, rufo com pingadeira" → Mensagem: "Certo! Você sabe mais ou menos quantos metros de calha e de rufo vai precisar, e a largura?" (ERRADO: "quantas unidades")
ERRADO: listar todos os serviços, perguntar "qual o tipo de serviço" depois que ele já disse, repetir "Você está em Jaraguá do Sul", pedir "responda sim ou não".

O QUE DESCOBRIR, CONFORME O CASO (só o que faz sentido para o caso; as REGRAS DA EMPRESA no fim mandam mais que isto):
- Em pedido NOVO: o nome (se ele não disse) e a cidade; não bloqueie encaminhamentos por esses dados.
- Peça avulsa / chapa lisa / compra para instalar sozinho: qual peça, metragem (metros), largura (ou corte), espessura/material e cor. Não fale de visita, linha, tipo de obra nem endereço completo.
- Calhas, rufos, pingadeiras, condutores com instalação: a METRAGEM (quantos metros lineares) e a LARGURA (ou corte) de cada peça, o local da obra (cidade e bairro) e foto do local e/ou projeto. Sem medidas → necessita_visita: true.
- Calhas, rufos, pingadeiras e chapas são vendidos por METRO, nunca por unidade: nunca pergunte "quantas unidades" ou "quantas peças"; pergunte "quantos metros" e "qual a largura".
- Esquadrias (janelas, portas, fachadas): quais peças e medidas dos vãos, linha e cor se ele já tiver ideia, projeto ou planta, local e fase da obra.
- Outros (portões, guarda-corpos, coberturas, pergolados, estruturas): o que é, medidas aproximadas, local e foto ou projeto.
Quando tiver o essencial do caso, conclua: agradeça em uma frase, diga que a equipe vai montar o orçamento e chamar por aqui, e defina triagem_concluida: true. Não estique a conversa com perguntas que não mudam o orçamento.
Se o cliente pedir para falar com uma pessoa, ou estiver irritado, diga que já vai chamar alguém da equipe e defina triagem_concluida: true.

No resumo_executivo (para a equipe, não para o cliente) escreva em poucas linhas o que o cliente quer e os dados que ele passou.

RESPONDA SEMPRE EM FORMATO JSON com esta estrutura:
{
  "analise": {
    "o_que_o_cliente_quer": "uma frase",
    "ja_sabemos": "o que ele já informou",
    "falta": "o que ainda muda o orçamento",
    "proxima_pergunta": "a única pergunta desta mensagem (ou vazio se for concluir)"
  },
  "mensagem": "texto da mensagem para o cliente",
  "dados_coletados": {
    "nome": null,
    "cidade": null,
    "tipo_servico": null,
    "produto": null,
    "possui_medidas": null,
    "medidas": null,
    "itens": [],
    "peca_avulsa": null,
    "comprimento": null,
    "largura": null,
    "espessura_material": null,
    "quantidade": null,
    "tipo_obra": null,
    "linha": null,
    "cor": null,
    "cidade_obra": null,
    "bairro": null,
    "rua": null,
    "numero": null,
    "prazo": null,
    "referencia_valor": null,
    "possui_fotos": null,
    "possui_projeto": null,
    "necessita_visita": null
  },
  "triagem_concluida": false,
  "tipo_atendimento": "comercial",
  "resumo_executivo": null,
  "prioridade": null,
  "score": null,
  "proxima_acao": null
}

Em dados_coletados.itens, mantenha uma lista das peças confirmadas: {"produto":"nome", "medidas":"medidas e unidades informadas", "quantidade":1, "unidade":"un"}. Não invente medidas, quantidades ou unidades.
Preencha APENAS os campos que o cliente acabou de informar ou que já foram confirmados anteriormente. Mantenha null para campos ainda não informados.
Quando a triagem estiver completa, defina triagem_concluida: true e gere o resumo_executivo.
Classifique prioridade como: "baixa", "media", "alta" ou "maxima".
Score de 0 a 100 baseado na qualidade e completude das informações.`;

// Verifica assinatura do webhook do WhatsApp
function verifySignature(payload: string, signature: string, secret: string): boolean {
  if (!secret) {
    // Sem secret configurado: rejeita em produção, aceita apenas em dev
    if (process.env.NODE_ENV === "production") return false;
    console.warn("[DEV] WHATSAPP_APP_SECRET não configurado — verificação de assinatura ignorada.");
    return true;
  }
  if (!signature) return false;
  const crypto = require("crypto");
  const expected = "sha256=" + crypto.createHmac("sha256", secret).update(payload).digest("hex");
  if (signature.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

function sameSecret(value: string, expected: string): boolean {
  if (!expected || value.length !== expected.length) return false;
  const crypto = require("crypto");
  return crypto.timingSafeEqual(Buffer.from(value), Buffer.from(expected));
}

/** Segredo do webhook: o da Vercel ou o gerado pelo CRM ao conectar a Evolution. */
function validEvolutionSecret(value: string, companySecret?: string | null): boolean {
  if (sameSecret(value, process.env.EVOLUTION_WEBHOOK_SECRET ?? "")) return true;
  return !!companySecret && sameSecret(value, secretValue(companySecret));
}

/** Telefone do contato. Contas novas do WhatsApp chegam como "@lid": o número vem em outro campo. */
function evolutionPhone(key: Record<string, unknown> | undefined): string | null {
  const jid = String(key?.remoteJid ?? "");
  if (/@s\.whatsapp\.net$|@c\.us$/.test(jid)) return jid.split("@")[0];
  if (jid.endsWith("@lid")) {
    const alt = [key?.senderPn, key?.remoteJidAlt, key?.participantPn].find((v) => typeof v === "string" && /@s\.whatsapp\.net$/.test(v as string));
    return alt ? String(alt).split("@")[0] : null;
  }
  return null;
}



const secretValue = (value?: string | null) => value ? decryptSecret(value) : "";

// GET: verificação do webhook pelo Meta
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const mode = searchParams.get("hub.mode");
  const token = searchParams.get("hub.verify_token");
  const challenge = searchParams.get("hub.challenge");

  // Sem token padrao: um valor fixo no codigo deixaria qualquer um assinar o webhook.
  const verifyToken = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN;
  if (verifyToken && mode === "subscribe" && token === verifyToken && challenge) {
    return new NextResponse(challenge, { status: 200 });
  }
  return NextResponse.json({ error: "Forbidden" }, { status: 403 });
}

// POST: recebe mensagens do WhatsApp
export async function POST(req: NextRequest) {
  const body = await req.text();
  let payload: any;
  try { payload = JSON.parse(body); } catch { return NextResponse.json({ error: "JSON inválido" }, { status: 400 }); }
  const res = await handleWebhook(req, body, payload, false);
  await logWebhook(payload, res).catch(() => undefined);
  return res;
}

// Registro tecnico do resultado (sem texto, nome ou telefone) para diagnosticar mensagens que nao entram.
async function logWebhook(payload: any, res: NextResponse) {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return;
  const isEvolution = !!(payload?.data?.key || payload?.event);
  const data = Array.isArray(payload?.data) ? payload.data[0] : payload?.data;
  const metaMsg = payload?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
  const key = (isEvolution ? data?.key : null) ?? {};
  const jid = String(key.remoteJid ?? "");
  const status = await res.clone().json().then((b: any) => String(b?.status ?? b?.error ?? "")).catch(() => "");
  await getSupabase().rpc("log_whatsapp_webhook", { p: {
    provider: isEvolution ? "evolution" : "meta",
    event: isEvolution ? String(payload?.event ?? "") + (Array.isArray(payload?.data) ? `[${payload.data.length}]` : "") : metaMsg ? "message" : "status",
    status: status.slice(0, 60), http: res.status,
    from_me: isEvolution ? !!key.fromMe : false,
    jid_kind: jid ? jid.replace(/^[^@]*/, "") : metaMsg ? "meta" : "",
    message_types: isEvolution && data?.message && typeof data.message === "object" ? Object.keys(data.message).join(",") : metaMsg ? String(metaMsg.type ?? "") : "",
    key_fields: Object.keys(key).filter((k) => key[k] !== null && key[k] !== undefined && key[k] !== "").join(","),
  } });
}

async function handleWebhook(req: NextRequest, body: string, payload: any, trusted: boolean): Promise<NextResponse> {
  // Evento gravado na trava contra repetidos: se o processamento falhar, a trava
  // e desfeita para que o reenvio do provedor seja processado (antes a mensagem sumia).
  let lockedEvent: { provider: string; event_id: string } | null = null;
  try {

    // Detecta formato: Evolution API ou Meta
    const isEvolution = !!(payload?.data?.key || payload?.event);
    let fromMe = false;
    // Número da empresa (canal) que recebeu o evento: cada número tem sua conversa e responde por si.
    let channel: WhatsappChannel | null = null;
    // Evolution: confere o segredo antes de qualquer outra coisa (o da Vercel ou o gerado pelo CRM).
    if (isEvolution) {
      const headerSecret = req.headers.get("x-webhook-secret") ?? req.headers.get("apikey") ?? "";
      if (payload?.instance) channel = await channelByProviderId(getSupabase(), "evolution", String(payload.instance)).catch(() => null);
      let companySecret: string | null = null;
      if (!sameSecret(headerSecret, process.env.EVOLUTION_WEBHOOK_SECRET ?? "") && payload?.instance) {
        if (channel?.webhook_secret) companySecret = channel.webhook_secret;
        else try {
          const { data } = channel
            ? await getSupabase().from("ai_agent_config").select("evolution_webhook_secret").eq("company_id", channel.company_id).maybeSingle()
            : await getSupabase().from("ai_agent_config").select("evolution_webhook_secret").eq("evolution_instance", String(payload.instance)).maybeSingle();
          companySecret = data?.evolution_webhook_secret ?? null;
        } catch { companySecret = null; }
      }
      if (!validEvolutionSecret(headerSecret, companySecret)) {
        return NextResponse.json({ error: "Invalid Evolution webhook secret" }, { status: 401 });
      }
      if (channel && channel.active === false) return NextResponse.json({ status: "channel_inactive" });
      if (channel) {
        // Evento de conexão não prova que as mensagens estão chegando: o vigia olha só os de mensagem.
        const now = new Date().toISOString();
        const isConnection = /connection/i.test(String(payload?.event ?? ""));
        await getSupabase().from("whatsapp_channels").update(isConnection ? { last_event_at: now } : { last_event_at: now, last_message_event_at: now })
          .eq("id", channel.id).then(() => undefined, () => undefined);
      }
    }
    // Empresa dona da instância da Evolution (canal novo ou conexão antiga).
    const instanceCompany = async (): Promise<{ company_id: string } | null> => {
      if (channel) return { company_id: channel.company_id };
      const { data } = await getSupabase().from("ai_agent_config").select("company_id").eq("evolution_instance", String(payload.instance ?? "")).maybeSingle();
      return data ?? null;
    };

    if (isEvolution && ["messages.update", "MESSAGES_UPDATE"].includes(payload.event)) {
      const db = getSupabase();
      const cfg = await instanceCompany();
      if (cfg) for (const event of (Array.isArray(payload.data) ? payload.data : [payload.data])) {
        const id = String(event?.keyId ?? event?.key?.id ?? "");
        const status = event?.status ?? event?.update?.status;
        if (event?.fromMe === false || event?.key?.fromMe === false) await updateIncomingRead(db, cfg.company_id, id, status, channel?.id);
        else await updateDelivery(db, cfg.company_id, id, status, channel?.id);
      }
      return NextResponse.json({ status: "receipts_updated" });
    }

    // Sync batches and contact changes must never enter the AI workflow.
    if (isEvolution && (Array.isArray(payload.data) || /^(contacts\.(upsert|update)|CONTACTS_(UPSERT|UPDATE))$/.test(payload.event))) {
      const db = getSupabase();
      const cfg = await instanceCompany();
      if (!cfg) return NextResponse.json({ status: "company_not_found" });
      const records = Array.isArray(payload.data) ? payload.data : [payload.data];
      if (/contacts/i.test(payload.event)) await applyAgendaNames(db, cfg.company_id, agendaNameMap(records));
      else if (["messages.upsert", "MESSAGES_UPSERT"].includes(payload.event)) await importHistoryPage(db, cfg.company_id, records, channel?.id);
      return NextResponse.json({ status: "sync_only" });
    }

    // ── Registro de eventos de conexão (B2): grava no histórico antes de descartar ──────────
    // Eventos como connection.update, qrcode.updated, status.change etc. eram ignorados.
    // Agora são persistidos para diagnóstico e monitoramento da estabilidade do WhatsApp.
    if (isEvolution && channel && /connection|qrcode|status\.change/i.test(String(payload?.event ?? ""))) {
      const eventType = String(payload?.event ?? "unknown");
      const connState = payload?.data?.state ?? payload?.data?.connection ?? null;
      const errorMsg = payload?.data?.reason ?? payload?.data?.error ?? null;
      await getSupabase().rpc("record_whatsapp_connection_event", {
        p_company_id: channel.company_id,
        p_channel_id: channel.id,
        p_provider: "evolution",
        p_event_type: eventType,
        p_status: typeof connState === "string" ? connState : null,
        p_error_message: typeof errorMsg === "string" ? String(errorMsg).slice(0, 500) : null,
        p_metadata: payload?.data && typeof payload.data === "object" ? payload.data as Record<string, unknown> : null,
      }).then(() => undefined, () => undefined);
      // Eventos de conexão não seguem para o fluxo de mensagens
      if (!["messages.upsert", "MESSAGES_UPSERT"].includes(payload.event)) {
        return NextResponse.json({ status: "connection_event_recorded" });
      }
    }

    let from = "";
    let phoneNumberId = "";
    let clientText = "";
    let mediaInfo: string | null = null;
    let contactName: string | null = null;
    let quote: { id: string; preview: string } | null = null;

    if (isEvolution) {
      // Evolution API webhook format
      // event: "messages.upsert", data.key.remoteJid: "5547999999999@s.whatsapp.net"
      if (!["messages.upsert", "MESSAGES_UPSERT"].includes(payload.event)) return NextResponse.json({ status: "ignored" });
      const data = Array.isArray(payload.data) ? payload.data[0] : payload.data;
      payload.data = data;
      fromMe = !!data?.key?.fromMe;
      contactName = !fromMe && typeof data?.pushName === "string" ? data.pushName : null;
      const jid = String(data?.key?.remoteJid ?? "");
      // Grupos, listas de transmissao e status nao sao clientes: a Ana nao responde.
      if (/@g\.us$|@broadcast$|^status@|@newsletter$/.test(jid)) return NextResponse.json({ status: "ignored_group" });
      // Reação (👍): marca a mensagem reagida. Não é mensagem nova: não conta como não lida nem chama a Lia.
      const reaction = evolutionReaction(data?.message);
      if (reaction) {
        const cfgReaction = await instanceCompany();
        if (!cfgReaction) return NextResponse.json({ status: "company_not_found" });
        const reactionChannel=await resolveMessageChannel(getSupabase(),cfgReaction.company_id,channel?.id);
        const { error: reactionError } = await scopeMessages(getSupabase().from("messages")
          .update(fromMe ? { reaction_team: reaction.emoji || null } : { reaction_customer: reaction.emoji || null })
          .eq("company_id", cfgReaction.company_id).eq("external_id", reaction.targetId),reactionChannel);
        if (reactionError) throw new Error(`Reação não gravada: ${reactionError.message}`);
        return NextResponse.json({ status: "reaction" });
      }
      // Contas novas do WhatsApp chegam como "@lid", as vezes sem o numero: antes eram descartadas.
      const contact = evolutionContact(data?.key);
      let phone = contact?.id ?? null;
      if (contact?.lid) {
        const db = getSupabase();
        const cfgLid = await instanceCompany();
        if (cfgLid?.company_id) {
          if (contact.phone) await db.rpc("link_whatsapp_lid", { p_company: cfgLid.company_id, p_lid: contact.lid, p_phone: contact.phone }).then(() => undefined, () => undefined);
          else {
            const { data: known } = await db.from("whatsapp_lid_map").select("phone").eq("company_id", cfgLid.company_id).eq("lid", contact.lid).maybeSingle();
            if (known?.phone) phone = known.phone;
          }
        }
      }
      if (!phone) return NextResponse.json({ status: fromMe ? "own_message" : "no_phone" });
      from = phone;
      phoneNumberId = payload.instance ?? process.env.EVOLUTION_INSTANCE ?? "";
      const extracted = evolutionMessageText(data?.message);
      if (!extracted.text) return NextResponse.json({ status: "unsupported_type" });
      clientText = extracted.text;
      mediaInfo = extracted.media;
      quote = evolutionQuote(data?.message, data?.contextInfo);
    } else {
      // Meta WhatsApp Business API format
      const signature = req.headers.get("x-hub-signature-256") ?? "";
      const appSecret = process.env.WHATSAPP_APP_SECRET ?? "";
      if (!trusted && !verifySignature(body, signature, appSecret)) {
        return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
      }
      const entry = payload?.entry?.[0];
      const change = entry?.changes?.[0];
      const value = change?.value;
      if (value?.statuses?.length) {
        const db = getSupabase();
        const phoneId = value.metadata?.phone_number_id;
        const { data: company } = await db.from("companies").select("id").eq("whatsapp_phone_number_id", phoneId).maybeSingle();
        const { data: cfg } = company ? { data: null } : await db.from("ai_agent_config").select("company_id").eq("whatsapp_number_id", phoneId).maybeSingle();
        const companyId = company?.id ?? cfg?.company_id;
        const receiptChannel=phoneId?await channelByProviderId(db,'meta',String(phoneId)):null;
        if (companyId) for (const status of value.statuses) await updateDelivery(db, companyId, String(status.id ?? ""), status.status,receiptChannel?.id);
      }
      // Lote com varias mensagens (ou varias entradas): cada uma e processada.
      const batch = (payload?.entry ?? []).flatMap((e: any) => (e?.changes ?? []).flatMap((c: any) =>
        (c?.value?.messages ?? []).map((m: any) => ({ e, c, m }))));
      if (!trusted && batch.length > 1) {
        let failed = 0;
        for (const { e, c, m } of batch) {
          const single = { ...payload, entry: [{ ...e, changes: [{ ...c, value: { ...c.value, statuses: undefined, messages: [m],
            contacts: (c.value?.contacts ?? []).filter((x: any) => x?.wa_id === m?.from) } }] }] };
          const res = await handleWebhook(req, body, single, true);
          if (res.status >= 500) failed++;
        }
        return failed ? NextResponse.json({ error: `${failed} mensagens falharam` }, { status: 500 }) : NextResponse.json({ status: "batch", count: batch.length });
      }
      const messages = value?.messages;
      if (!messages?.length) return NextResponse.json({ status: "no_messages" });
      const msg = messages[0];
      from = msg.from;
      phoneNumberId = value.metadata?.phone_number_id;
      contactName = value.contacts?.[0]?.profile?.name ?? null;
      const msgType = msg.type;
      if (msgType === "text") {
        clientText = msg.text?.body ?? "";
      } else if (["image", "video", "document", "audio"].includes(msgType)) {
        const mediaTypes: Record<string, string> = {
          image: "foto/imagem", video: "vídeo", document: "documento/projeto", audio: "áudio"
        };
        clientText = `[${mediaTypes[msgType] ?? msgType} recebido]`;
        mediaInfo = msgType;
      } else {
        return NextResponse.json({ status: "unsupported_type" });
      }
    }

    if (!from || !clientText) return NextResponse.json({ status: "no_content" });
    const supabase = getSupabase();

    // Provedores reenviam o mesmo evento: cada mensagem e processada uma vez.
    const eventId = String((isEvolution ? payload?.data?.key?.id : payload?.entry?.[0]?.changes?.[0]?.value?.messages?.[0]?.id) ?? "");

    // Busca empresa — por phone_number_id (Meta) ou instance (Evolution)
    let company: { id: string; name: string; trade_name: string; whatsapp_phone_number_id: string } | null = null;
    if (!isEvolution && phoneNumberId) channel = await channelByProviderId(supabase, "meta", phoneNumberId).catch(() => null);
    if (channel) {
      const { data: byChannel } = await supabase.from("companies").select("id, name, trade_name, whatsapp_phone_number_id").eq("id", channel.company_id).maybeSingle();
      company = byChannel;
    } else if (isEvolution) {
      const { data: configByInstance } = await supabase
        .from("ai_agent_config")
        .select("company:companies(id,name,trade_name,whatsapp_phone_number_id)")
        .eq("evolution_instance", phoneNumberId)
        .maybeSingle();
      company = configByInstance?.company as unknown as typeof company;
    } else {
      const { data: byPhone } = await supabase
        .from("companies")
        .select("id, name, trade_name, whatsapp_phone_number_id")
        .eq("whatsapp_phone_number_id", phoneNumberId)
        .maybeSingle();
      company = byPhone;
      // O numero digitado na tela do Agente IA fica em ai_agent_config.whatsapp_number_id.
      if (!company && phoneNumberId) {
        const { data: byAgent } = await supabase
          .from("ai_agent_config")
          .select("company:companies(id,name,trade_name,whatsapp_phone_number_id)")
          .eq("whatsapp_number_id", phoneNumberId)
          .maybeSingle();
        company = byAgent?.company as unknown as typeof company;
      }
    }

    if (!company) {
      console.error("Empresa não encontrada para phone_number_id:", phoneNumberId);
      return NextResponse.json({ status: "company_not_found" });
    }

    const messageChannelId=await resolveMessageChannel(supabase,company.id,channel?.id);
    if(eventId){
      const scopedEventId=webhookEventKey(messageChannelId??`legacy:${company.id}:${phoneNumberId}`,eventId);
      const provider=isEvolution?'evolution':'meta';
      const {data:novo,error:dedupeError}=await supabase.from('whatsapp_webhook_events')
        .upsert({provider,event_id:scopedEventId,channel_id:messageChannelId},{onConflict:'provider,event_id',ignoreDuplicates:true}).select('event_id');
      if(dedupeError)throw new Error(`Deduplicação indisponível: ${dedupeError.message}`);
      if(!novo?.length)return NextResponse.json({status:'duplicate'});
      lockedEvent={provider,event_id:scopedEventId};
    }

    const { data: agentConfig } = await supabase
      .from("ai_agent_config")
      .select("*")
      .eq("company_id", company.id)
      .single();

    // Mensagem enviada pelo celular/WhatsApp Web da empresa (Evolution).
    if (fromMe) {
      await recordOwnMessage(supabase, company.id, from, clientText, eventId, inboundTiming(payload.data?.messageTimestamp).at, messageChannelId);
      await saveQuote(supabase, company.id, eventId, quote,messageChannelId);
      return NextResponse.json({ status: "own_message" });
    }

    const timing = inboundTiming(isEvolution ? payload.data?.messageTimestamp : payload.entry?.[0]?.changes?.[0]?.value?.messages?.[0]?.timestamp);
    // Toda mensagem entra no Atendimento, com ou sem a Ana.
    let conversation: InboxConversation | null = null;
    try {
      conversation = await recordInbound(supabase, { companyId: company.id, phone: from, contactName, body: clientText, externalId: eventId || null, at: timing.at, historical: !timing.live, channelId: messageChannelId });
      if (!conversation) return NextResponse.json({ status: "duplicate" });
      await saveQuote(supabase, company.id, eventId, quote,messageChannelId);
      // Armazena áudio no Storage e transcreve após responder para que o player e o texto funcionem indefinidamente.
      if (isEvolution && mediaInfo === "audio" && eventId && timing.live) {
        const cacheCId = company.id, cacheEId = eventId;
        const cacheCreds = channel
          ? channelCredentials(agentConfig, channel)
          : whatsappCredentials(agentConfig, { provider: "evolution", phoneNumberId });
        if (cacheCreds.evolutionUrl && cacheCreds.evolutionKey && cacheCreds.evolutionInstance) {
          const eu = cacheCreds.evolutionUrl, ek = cacheCreds.evolutionKey, ei = cacheCreds.evolutionInstance;
          const cacheGeminiKey = agentConfig?.gemini_api_key ? decryptSecret(agentConfig.gemini_api_key) : null;
          try {
            after(async () => {
              try {
                const db = getSupabase();
                const { data: m } = await db.from("messages").select("id,conversation_id,media_url,body")
                  .eq("company_id", cacheCId).eq("external_id", cacheEId).eq("direction", "inbound").maybeSingle();
                if (!m) return;
                const needCache = !m.media_url;
                const needTranscription = !!cacheGeminiKey && m.body === "[áudio]";
                if (!needCache && !needTranscription) return;
                const { base64 } = await evolutionMediaBase64(eu, ek, ei, cacheEId, { convertToMp4: true });
                if (needCache) {
                  const bytes = Buffer.from(base64, "base64");
                  const storagePath = `${cacheCId}/${m.conversation_id}/${m.id}`;
                  const { error: upErr } = await db.storage.from("atendimento-files").upload(storagePath, bytes, { contentType: "audio/mp4", upsert: false });
                  if (!upErr) await db.from("messages").update({ media_url: storagePath, media_type: "audio/mp4" }).eq("id", m.id).is("media_url", null);
                }
                if (needTranscription) {
                  const tr = await transcribeAudio({ base64, mimetype: "audio/mp4" }, cacheGeminiKey);
                  if (tr.ok) await db.from("messages").update({ body: `[áudio] ${tr.text}` }).eq("id", m.id).eq("body", "[áudio]");
                }
              } catch (e) { console.error("Áudio: falha ao armazenar/transcrever mídia:", e); }
            });
          } catch { /* fora de requisição (testes) */ }
        }
      }
    } catch (error) {
      throw error;
    }
    // Cliente pediu para parar (ou desistiu): nenhuma automação escreve para ele depois disso.
    if (timing.live && conversation && wantsNoMessages(clientText)) {
      await supabase.from("conversations").update({ ai_opt_out: true }).eq("id", conversation.id).eq("company_id", company.id).then(() => undefined, () => undefined);
    }
    if (!timing.live || !eventId) return NextResponse.json({ status: "history_only" });
    // Comandos da Lia (/entrada, /baixa...): só dos números liberados (Anderson e financeiro).
    // Vale com ou sem a Lia de atendimento ligada e mesmo com a conversa assumida pela equipe.
    const sender = conversation ? await commandSender(supabase, company.id, from).catch(() => null) : null;
    if (sender && conversation) {
      const cmdCredentials = channel ? channelCredentials(agentConfig, channel) : whatsappCredentials(agentConfig, { provider: isEvolution ? "evolution" : "meta", phoneNumberId });
      const cmdProvider = parseAiProvider(agentConfig?.ai_provider);
      const cmdKey = aiProviderKey(cmdProvider, agentConfig);
      const cmdConversation = conversation;
      const say = async (to: string, text: string, record: boolean) => {
        let externalId: string | null = null; let failure: string | null = null;
        try { externalId = await sendWhatsAppText(cmdCredentials, to, text); }
        catch (error) { failure = error instanceof Error ? error.message : String(error); console.error("Lia comandos: falha ao enviar:", failure); }
        if (record) await recordOutbound(supabase, { companyId: company.id, conversationId: cmdConversation.id, body: text, author: "ana", senderName: "Lia", externalId,
          deliveryStatus: failure ? "falhou" : "enviada", error: failure }).catch(() => undefined);
        if (failure) throw new Error(failure);
      };
      const handled = await handleLiaCommand({
        db: supabase, companyId: company.id, phone: from, text: clientText,
        reply: (text) => say(from, text, true),
        sendTo: (to, text) => say(to, text, false),
        ai: aiKeyAvailable(cmdProvider, cmdKey) ? { provider: cmdProvider, apiKey: secretValue(cmdKey), model: agentConfig?.openai_model as string | null } : null,
      }, sender).catch((error) => { console.error("Lia comandos:", error); return true; });
      if (handled) return NextResponse.json({ status: "lia_command" });
    }
    // Alguém da equipe assumiu a conversa: a Ana fica quieta.
    if (conversation?.ai_paused) return NextResponse.json({ status: "human_handling" });
    // A Ana só atende contato novo: quem já é cliente fala com a equipe.
    if (conversation?.client_id) return NextResponse.json({ status: "known_client" });
    // Números novos (calha/esquadrias de cada usuária) começam sem IA: a Lia só atende o
    // número principal até ser ligada por número (nunca liga sozinha).
    if (channel && !channel.is_default) return NextResponse.json({ status: "channel_without_ai" });

    const aiProvider = parseAiProvider(agentConfig?.ai_provider);
    const companyAiKey = aiProviderKey(aiProvider, agentConfig);
    if (!agentConfig?.active || !aiKeyAvailable(aiProvider, companyAiKey)) {
      console.log("Agente IA não configurado/ativo para empresa:", company.id);
      return NextResponse.json({ status: "agent_inactive" });
    }

    // A mensagem já está gravada no Atendimento. A Lia (transcrição + IA, de segundos a 1 min) roda
    // depois de responder ao provedor: o webhook devolve na hora e a Evolution não fica esperando a
    // IA para entregar as próximas mensagens. Fora de uma requisição (testes), roda na hora.
    const lia = async (): Promise<NextResponse> => {
    // Busca sessão de triagem ativa para este número
    let { data: session } = await supabase
      .from("triage_sessions")
      .select("*")
      .eq("company_id", company.id)
      .eq("phone", from)
      .eq("status", "em_andamento")
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    const companyName = company.trade_name || company.name;
    const agentName = agentConfig.agent_name && agentConfig.agent_name !== "Ana" ? agentConfig.agent_name : "Lia";
    // Responde pelo mesmo canal que trouxe a mensagem (antes uma config "evolution"
    // padrao fazia as respostas de quem usa a API da Meta nunca sairem).
    const wppProvider = isEvolution ? "evolution" : "meta";
    // Resposta sai pelo número que recebeu a mensagem.
    const credentials = channel ? channelCredentials(agentConfig, channel) : whatsappCredentials(agentConfig, { provider: wppProvider, phoneNumberId });
    const canReply = async () => {
      if (!conversation?.generation) return false;
      const [config, current] = await Promise.all([
        supabase.from("ai_agent_config").select("active").eq("company_id", company.id).single(),
        supabase.from("conversations").select("ai_paused,client_id,ai_generation_id").eq("id", conversation.id).eq("company_id", company.id).single(),
      ]);
      return !config.error && !current.error && config.data?.active === true
        && !current.data?.ai_paused && !current.data?.client_id
        && current.data?.ai_generation_id === conversation.generation;
    };
    const liaMode = parseLiaMode(agentConfig.lia_mode);
    // Registro de cada decisão da Lia (Central de IA). Nunca derruba o atendimento.
    const logDecision = async (decisao: "respondeu" | "sugeriu" | "encaminhou" | "ignorou" | "falhou", motivo: string) => {
      const { error } = await supabase.from("ai_decisions").insert({ company_id: company.id, conversation_id: conversation?.id ?? null, phone: from, decisao, motivo: motivo.slice(0, 300), modo: liaMode });
      if (error) console.error("Lia: falha ao registrar decisão:", error.message);
    };
    let sendFailure: string | null = null;
    const reply = async (text: string) => {
      if (!await canReply()) return false;
      // Reserva atômica: só um processo envia por mensagem do cliente, e nada sai se a
      // equipe assumiu, a Lia foi pausada ou chegou mensagem nova nesse meio-tempo.
      const { data: claimed, error: claimError } = await supabase.rpc("claim_ai_reply", { p_conversation: conversation?.id, p_company: company.id, p_generation: conversation?.generation });
      if (claimError || claimed !== true) return false;
      let externalId: string | null = null;
      let failure: string | null = null;
      let unknown = false;
      try { externalId = await sendWhatsAppText(credentials, from, text); }
      catch (error) { failure = error instanceof Error ? error.message : String(error); unknown = sendOutcomeUnknown(error, failure); console.error("Falha ao enviar WhatsApp:", failure); }
      sendFailure = unknown ? null : failure;
      if (conversation) {
        // Tempo esgotado: pode ter saído. Fica "sem confirmação" e o eco do celular confirma depois.
        await recordOutbound(supabase, { companyId: company.id, conversationId: conversation.id, body: text, author: "ana", senderName: agentName, externalId,
          deliveryStatus: failure ? (unknown ? "desconhecido" : "falhou") : "enviada",
          error: failure ? (unknown ? `Sem confirmação do WhatsApp (${failure}). Confira no celular antes de reenviar.` : failure) : null })
          .catch((error) => console.error("Atendimento: falha ao gravar resposta:", error instanceof Error ? error.message : error));
      }
      return !failure || unknown;
    };

    // Áudio: a Lia só "ouve" se a transcrição funcionar. Se falhar, segue com "[áudio]" puro e a
    // instrução do prompt manda pedir que escrevam (nunca finge ter entendido).
    if (isEvolution && mediaInfo === "audio" && eventId) {
      let result: Transcription = { ok: false, reason: "sem_chave" };
      try {
        const geminiKey = agentConfig.gemini_api_key ? decryptSecret(agentConfig.gemini_api_key) : "";
        if (geminiKey && credentials.evolutionUrl && credentials.evolutionKey && credentials.evolutionInstance) {
          const media = await evolutionMediaBase64(credentials.evolutionUrl, credentials.evolutionKey, credentials.evolutionInstance, eventId);
          result = await transcribeAudio(media, geminiKey);
        }
      } catch { result = { ok: false, reason: "falha" }; }
      if (result.ok) {
        clientText = `[áudio] ${result.text}`;
        // A equipe também passa a ver o que foi dito no áudio.
        await scopeMessages(supabase.from("messages").update({ body: clientText }).eq("company_id", company.id).eq("external_id", eventId).eq("direction", "inbound"),messageChannelId)
          .then(() => undefined, () => undefined);
      } else {
        await logDecision("falhou", `Áudio não transcrito (${result.reason}). ${result.reason === "sem_chave" ? "Cadastre a chave do Gemini na Central de IA." : ""}`.trim());
      }
    }

    // Primeiro contato: cria a sessao e segue para a IA, que ja responde ao que o
    // cliente escreveu (antes a primeira mensagem era descartada).
    const isNewSession = !session;
    if (!session) {
      const { data: newSession, error: sessionError } = await supabase
        .from("triage_sessions")
        .insert({
          company_id: company.id,
          phone: from,
          conversation_id: conversation?.id ?? null,
          messages: [],
          current_step: "identificacao",
          dados_coletados: {}
        })
        .select()
        .single();

      if (sessionError || !newSession) {
        console.error("Erro ao criar sessão:", sessionError);
        return NextResponse.json({ error: sessionError?.message ?? "session_error" }, { status: 500 });
      }
      session = newSession;
    }

    // Recupera mensagens anteriores do Atendimento quando a triagem ainda não tem histórico.
    // Inclui textos e anexos importados antes da criação desta sessão.
    let previousMessages = Array.isArray(session.messages) ? session.messages : [];
    if (conversation) {
      const { data: inboxHistory, error: historyError } = await supabase.from("messages")
        .select("direction,body,sent_at,external_id,author")
        .eq("company_id", company.id).eq("conversation_id", conversation.id)
        .order("sent_at", { ascending: false }).order("id", { ascending: false }).limit(60);
      if (historyError) throw new Error(`Falha ao carregar histórico: ${historyError.message}`);
      if ((inboxHistory ?? []).some(m => m.direction === "outbound" && m.author === "equipe")) {
        await supabase.from("conversations").update({ ai_paused: true }).eq("id", conversation.id);
        return NextResponse.json({ status: "human_history" });
      }
      previousMessages = (inboxHistory ?? []).filter(m => !eventId || m.external_id !== eventId).reverse()
        .map(m => ({ role: m.direction === "inbound" ? "user" : "assistant", content: m.body, timestamp: m.sent_at }));
    }

    // Adiciona mensagem do cliente ao histórico
    const updatedMessages = [
      ...(previousMessages as Array<{ role: string; content: string; timestamp: string }>),
      { role: "user", content: clientText, timestamp: new Date().toISOString() }
    ];

    // Monta histórico da conversa para a IA
    const conversationHistory = updatedMessages.filter(m => m.role === "user" || m.role === "assistant").map(m => ({
      role: m.role as "user" | "assistant" | "system",
      content: m.content
    }));

    // Adiciona contexto dos dados já coletados
    const dadosAtuais = (session.dados_coletados && typeof session.dados_coletados === "object" ? session.dados_coletados : {}) as Record<string, unknown>;
    // Previously generated names cannot become identity evidence on later turns.
    if (!isConfirmedCustomerName(dadosAtuais.nome, updatedMessages)) delete dadosAtuais.nome;
    const contextMsg = `\n\nVocê se chama ${agentName} e atende pela ${companyName}.`
      + (isNewSession && !previousMessages.length ? ` Este é o primeiro contato do cliente: cumprimente, diga que é a ${agentName}, assistente virtual (IA) da Marquinhos Calhas e Esquadrias, e já responda ao que ele escreveu, com a próxima pergunta que fizer sentido.` : "")
      + (Object.keys(dadosAtuais).length > 0 ? `\n\nDADOS JÁ COLETADOS NESTA TRIAGEM: ${JSON.stringify(dadosAtuais)}\n\nContinue de onde parou.` : "");

    // Regras confirmadas pela gerência (correções feitas à Lia). Falha ao ler não trava o atendimento.
    const { data: learnedRows, error: learnedError } = await supabase.from("ai_lia_rules").select("quando,instrucao")
      .eq("company_id", company.id).eq("status", "ativa").order("ativada_em", { ascending: true }).limit(LIA_RULES_LIMIT);
    if (learnedError) console.error("Regras da Lia não carregadas:", learnedError.message);
    const confirmedRules = liaRulesForPrompt(learnedRows ?? []);
    const companyRules = [rulesForPrompt(typeof agentConfig?.system_prompt === "string" ? agentConfig.system_prompt : null), confirmedRules].filter(Boolean).join("\n\n");

    // Chama a IA configurada (Ollama Cloud, Groq ou OpenAI). Se falhar (limite por minuto,
    // resposta cortada), tenta de novo mais enxuta com o modelo menor, que tem cota separada.
    // Regras fixas primeiro e dados da conversa depois: no Claude a parte fixa fica em cache
    // (cobrada ~90% mais barato nas mensagens seguintes).
    const systemFull = SYSTEM_PROMPT + (companyRules ? `\n\n${companyRules}` : "") + `\n\n${liaFactsPrompt()}` + `\n\n${CUSTOMER_IDENTITY_RULE}`;
    const rulesShort = [rulesForPrompt(typeof agentConfig?.system_prompt === "string" ? rulesWithoutLearned(agentConfig.system_prompt) : null), confirmedRules].filter(Boolean).join("\n\n");
    const systemShort = SYSTEM_PROMPT + (rulesShort ? `\n\n${rulesShort}` : "") + `\n\n${liaFactsPrompt()}` + `\n\n${CUSTOMER_IDENTITY_RULE}`;
    const attempts = [
      { model: agentConfig.openai_model as string | null, system: systemFull, history: conversationHistory },
      { model: aiProvider === "groq" ? "openai/gpt-oss-20b" : (agentConfig.openai_model as string | null), system: systemShort, history: conversationHistory },
    ];
    let aiContent = "";
    let aiFailure: unknown = null;
    // O encaminhamento de orçamento existente não depende de o modelo obedecer ao roteiro.
    const existingQuote = isExistingQuoteConversation(updatedMessages);
    if (existingQuote) aiContent = JSON.stringify(quoteHandoff(updatedMessages));
    for (const [i, attempt] of (existingQuote ? [] : attempts).entries()) {
      try {
        aiContent = await aiChat({
          provider: aiProvider,
          model: attempt.model,
          apiKey: secretValue(companyAiKey),
          temperature: Number(agentConfig.temperature ?? 0.3),
          json: true,
          maxTokens: 1500,
          messages: [{ role: "system", content: attempt.system }, { role: "system", content: contextMsg.trim() }, ...attempt.history],
        });
        JSON.parse(aiContent);
        aiFailure = null;
        break;
      } catch (error) {
        aiFailure = error;
        console.error(`Erro do provedor de IA (tentativa ${i + 1}):`, error instanceof AiError ? `${error.provider} ${error.status}: ${error.message}` : error);
        if (i === 0 && error instanceof AiError && error.status === 429) await new Promise((r) => setTimeout(r, 1500));
      }
    }
    if (aiFailure) {
      // Sem mensagem automática para o cliente: a conversa fica no Atendimento para a equipe
      // responder, e a Central mostra o motivo da falha.
      await supabase.from("triage_sessions").update({
        messages: [...updatedMessages, { role: "system", content: `${AI_FAILURE_TAG} ${aiFailure instanceof AiError ? aiErrorMessage(aiFailure) : "resposta inválida da IA"}`, timestamp: new Date().toISOString() }],
        updated_at: new Date().toISOString(),
      }).eq("id", session.id);
      await logDecision("falhou", aiFailure instanceof AiError ? aiErrorMessage(aiFailure) : "Resposta inválida da IA");
      return NextResponse.json({ status: "ai_failed_team_notified" });
    }

    let aiResult: {
      analise?: { o_que_o_cliente_quer?: string; falta?: string; proxima_pergunta?: string } | null;
      mensagem: string;
      dados_coletados: Record<string, unknown>;
      triagem_concluida: boolean;
      tipo_atendimento: string;
      resumo_executivo: string | null;
      prioridade: string | null;
      score: number | null;
      proxima_acao: string | null;
    };

    try {
      aiResult = JSON.parse(aiContent);
    } catch {
      aiResult = { mensagem: "Desculpe, ocorreu um erro. Pode repetir?", dados_coletados: {}, triagem_concluida: false, tipo_atendimento: "comercial", resumo_executivo: null, prioridade: null, score: null, proxima_acao: null };
    }

    const resposta = guardCustomerGreeting(aiResult.mensagem || "Como posso ajudar?", updatedMessages);

    // LIA V2 — auditoria de políticas (modo passivo: classifica e registra, nunca bloqueia o atendimento)
    (async () => {
      try {
        const policyCategory = classifyMessage(clientText);
        const policyDecision = await evaluatePolicy(supabase, company.id, policyCategory);
        await supabase.from("lia_audit_events").insert({
          company_id: company.id,
          event_type: "lia_action",
          actor_id: null,
          actor_role: "system",
          target_type: "system",
          outcome: "allowed",
          details: {
            mode: "audit",
            message_preview: clientText.slice(0, 200),
            category: policyCategory,
            policy_level: policyDecision.level,
            policy_allowed: policyDecision.allowed,
            policy_message: policyDecision.message,
            rule_id: policyDecision.rule?.id ?? null,
            rule_title: policyDecision.rule?.title ?? null,
          },
        });
      } catch { /* auditoria nunca trava o atendimento */ }
    })();

    // Adiciona resposta da IA ao histórico
    const finalMessages = [
      ...updatedMessages,
      { role: "assistant", content: resposta, timestamp: new Date().toISOString() }
    ];

    // Merge dos dados coletados
    const novosDados = { ...dadosAtuais };
    // O entendimento da IA fica para a equipe ver na ficha da triagem.
    if (aiResult.analise?.o_que_o_cliente_quer) novosDados.entendimento = String(aiResult.analise.o_que_o_cliente_quer).slice(0, 300);
    if (aiResult.analise?.falta) novosDados.falta = String(aiResult.analise.falta).slice(0, 300);
    if (aiResult.dados_coletados) {
      for (const [k, v] of Object.entries(aiResult.dados_coletados)) {
        if (k === "nome" && !isConfirmedCustomerName(v, updatedMessages)) continue;
        if (v !== null && v !== undefined) novosDados[k] = v;
      }
    }
    if (mediaInfo === "image") novosDados.possui_fotos = true;
    if (mediaInfo === "document") novosDados.possui_documento = true;

    // Determina status da sessão
    const isPosVenda = aiResult.tipo_atendimento === "pos_venda";
    const isConcluida = aiResult.triagem_concluida;
    const novoStatus = isPosVenda ? "pos_venda" : isConcluida ? "concluida" : "em_andamento";

    if (!await canReply()) {
      await logDecision("ignorou", "Equipe assumiu a conversa ou a Lia foi pausada enquanto gerava a resposta");
      return NextResponse.json({ status: "reply_cancelled" });
    }
    const { count: repliesToday } = await supabase.from("ai_decisions").select("id", { count: "exact", head: true })
      .eq("company_id", company.id).eq("decisao", "respondeu").gte("created_at", startOfBrasiliaDay(new Date()));
    const decision = liaDecision({
      mode: liaMode, hours: parseLiaHours(agentConfig.lia_hours), now: new Date(), repliesToday: repliesToday ?? 0,
      dailyLimit: Number(agentConfig.lia_daily_limit) > 0 ? Number(agentConfig.lia_daily_limit) : 200,
      posVenda: isPosVenda, prioridade: aiResult.prioridade ?? null,
    });

    // Atualiza sessão
    const updateData: Record<string, unknown> = {
      messages: updatedMessages,
      dados_coletados: novosDados,
      status: novoStatus,
      updated_at: new Date().toISOString(),
      // Campos diretos da triagem
      nome: novosDados.nome ?? null,
      cidade: novosDados.cidade ?? session.cidade,
      bairro: novosDados.bairro ?? session.bairro,
      rua: novosDados.rua ?? session.rua,
      cep: novosDados.cep ?? session.cep,
      tipo_servico: novosDados.tipo_servico ?? session.tipo_servico,
      produto: novosDados.produto ?? session.produto,
      medidas: novosDados.medidas ?? session.medidas,
      tipo_obra: novosDados.tipo_obra ?? session.tipo_obra,
      linha: novosDados.linha ?? session.linha,
      cor: novosDados.cor ?? session.cor,
      prazo: novosDados.prazo ?? session.prazo,
      referencia_valor: novosDados.referencia_valor ?? session.referencia_valor,
      necessita_visita: novosDados.necessita_visita ?? session.necessita_visita,
      possui_projeto: novosDados.possui_projeto ?? session.possui_projeto,
      possui_fotos: novosDados.possui_fotos ?? session.possui_fotos,
      possui_medidas: novosDados.possui_medidas ?? session.possui_medidas,
      eh_manutencao: isPosVenda,
    };

    if (isConcluida || isPosVenda) {
      updateData.completed_at = new Date().toISOString();
      if (aiResult.resumo_executivo) updateData.resumo_executivo = aiResult.resumo_executivo;
      if (aiResult.score) updateData.score = aiResult.score;
      if (aiResult.prioridade) updateData.prioridade = aiResult.prioridade;
      if (aiResult.proxima_acao) updateData.proxima_acao = aiResult.proxima_acao;
    }

    const { error: triageError } = await supabase.from("triage_sessions").update(updateData).eq("id", session.id);
    if (triageError) throw new Error(`Falha ao salvar triagem e rascunho: ${triageError.message}`);
    if (decision.acao !== "responder" && conversation) {
      // A resposta fica como sugestão no Atendimento; nada vai para o cliente sem aprovação.
      const { error: suggestionError } = await supabase.from("conversations")
        .update({ ai_suggestion: resposta, ai_suggestion_at: new Date().toISOString() })
        .eq("id", conversation.id).eq("ai_generation_id", conversation.generation);
      if (suggestionError) throw new Error(`Falha ao salvar sugestão da Lia: ${suggestionError.message}`);
      await logDecision(decision.acao === "sugerir" ? "sugeriu" : "encaminhou", decision.motivo);
      if (isConcluida && !isPosVenda) await createOrUpdateLead(company.id, session.id, from, novosDados, aiResult);
      if (isConcluida || isPosVenda) await supabase.from("conversations").update({ ai_paused: true }).eq("id", conversation.id);
      return NextResponse.json({ status: decision.acao === "sugerir" ? "suggested" : "forwarded" });
    }
    // Envia resposta pelo mesmo canal (Evolution API ou Meta)
    const sentReply = await reply(resposta);
    if (!sentReply) {
      await logDecision(sendFailure ? "falhou" : "ignorou", sendFailure ? `Falha no envio: ${sendFailure}` : "Equipe assumiu a conversa antes do envio");
      return NextResponse.json({ status: "reply_cancelled_or_failed" });
    }
    await logDecision("respondeu", decision.motivo);
    if (conversation) await supabase.from("conversations").update({ ai_suggestion: null, ai_suggestion_at: null }).eq("id", conversation.id).not("ai_suggestion", "is", null);
    await supabase.from("triage_sessions").update({ messages: finalMessages }).eq("id", session.id);
    // Se triagem concluída e é lead comercial, cria/atualiza lead no CRM
    if (isConcluida && !isPosVenda) {
      await createOrUpdateLead(company.id, session.id, from, novosDados, aiResult);
    }


    // Triagem concluída ou pós-venda: a conversa passa para a equipe e a Ana para de responder.
    if ((isConcluida || isPosVenda) && conversation) {
      await supabase.from("conversations").update({ ai_paused: true }).eq("id", conversation.id);
    }



    return NextResponse.json({ status: "ok", triagem_concluida: isConcluida });
    };
    return await runAfterResponse(lia, async (error) => {
      console.error("Lia: falha depois de responder ao provedor:", error);
      await supabase.from("ai_decisions").insert({ company_id: company.id, conversation_id: conversation?.id ?? null, phone: from, decisao: "falhou",
        motivo: `Erro ao processar a mensagem: ${error instanceof Error ? error.message : String(error)}`.slice(0, 300), modo: agentConfig?.lia_mode ?? null })
        .then(() => undefined, () => undefined);
    });
  } catch (err) {
    console.error("Webhook error:", err);
    if (lockedEvent) {
      await getSupabase().from("whatsapp_webhook_events").delete().eq("provider", lockedEvent.provider).eq("event_id", lockedEvent.event_id)
        .then(({ error }) => { if (error) console.error("Webhook: falha ao liberar evento:", error.message); }, () => undefined);
    }
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

/**
 * Roda `work` depois de responder (after do Next, dentro do tempo da função) e devolve "ai_queued".
 * Sem requisição em andamento (testes, chamadas internas), roda na hora e devolve o resultado.
 */
async function runAfterResponse(work: () => Promise<NextResponse>, onError: (error: unknown) => Promise<void>): Promise<NextResponse> {
  const guarded = async () => { try { return await work(); } catch (error) { await onError(error); return NextResponse.json({ status: "ai_failed" }); } };
  try {
    after(async () => { await guarded(); });
  } catch {
    return guarded();
  }
  return NextResponse.json({ status: "ai_queued" });
}

/** Mensagem que responde citando outra: guarda o id e o trecho citado para a tela mostrar. */
async function saveQuote(supabase: ReturnType<typeof getSupabase>, companyId: string, externalId: string, quote: { id: string; preview: string } | null,channelId:string|null) {
  if (!quote || !externalId) return;
  const { error } = await scopeMessages(supabase.from("messages").update({ quoted_external_id: quote.id, quoted_preview: quote.preview || null })
    .eq("company_id", companyId).eq("external_id", externalId),channelId);
  if (error) console.error("Atendimento: citação não gravada:", error.message);
}

/**
 * Mensagem que a empresa mandou pelo celular ou WhatsApp Web. Ecos do que o CRM
 * ou a Lia enviaram são ignorados; o resto entra como "equipe" (nome pela
 * assinatura *Rose:*) e a Lia para de responder esse cliente.
 */
async function recordOwnMessage(supabase: ReturnType<typeof getSupabase>, companyId: string, phone: string, body: string, externalId: string, sentAt: string, channelId: string | null = null) {
  try {
    const known = async () => {
      if (!externalId) return false;
      const { data } = await scopeMessages(supabase.from("messages").select("id").eq("company_id", companyId).eq("external_id", externalId),channelId).limit(1);
      return !!data?.length;
    };
    if (await known()) return;
    // O CRM grava a mensagem logo depois que a Evolution confirma o envio: espera um pouco.
    await new Promise((r) => setTimeout(r, 3000));
    if (await known()) return;
    const conversation = await getOrCreateConversation(supabase, companyId, phone, null, { channelId });
    // Envio do CRM que ficou sem confirmação (timeout): o eco do WhatsApp confirma que saiu.
    const recent = new Date(Date.now() - 15 * 60_000).toISOString();
    const { data: pendingSend } = await supabase.from("messages").select("id")
      .eq("conversation_id", conversation.id).eq("direction", "outbound").eq("body", body).is("external_id", null)
      .in("delivery_status", ["enviando", "desconhecido"]).gte("sent_at", recent).order("sent_at", { ascending: false }).limit(1);
    if (pendingSend?.length) {
      await supabase.from("messages").update({ external_id: externalId || null, delivery_status: "enviada", error_message: null }).eq("id", pendingSend[0].id);
      return;
    }
    const since = new Date(Date.now() - 2 * 60_000).toISOString();
    const { data: same } = await supabase.from("messages").select("id")
      .eq("conversation_id", conversation.id).eq("direction", "outbound").eq("body", body).gte("sent_at", since).limit(1);
    if (same?.length) return;
    const sig = extractSignature(body);
    const name = sig.name ?? "Equipe (celular)";
    await recordOutbound(supabase, { companyId, conversationId: conversation.id, body: sig.body, author: "equipe", senderName: name, externalId: externalId || null, sentAt });
    await supabase.from("conversations").update({ ai_paused: true }).eq("id", conversation.id);
  } catch (error) {
    console.error("Atendimento: falha ao gravar mensagem da equipe:", error instanceof Error ? error.message : error);
    // Sobe o erro: a trava contra repetidos é desfeita e o reenvio (ou a reconciliação) grava depois.
    throw error;
  }
}

async function createOrUpdateLead(
  companyId: string,
  sessionId: string,
  phone: string,
  dados: Record<string, unknown>,
  aiResult: { score: number | null; prioridade: string | null; proxima_acao: string | null }
) {
  const supabase = getSupabase();
  const { data: linkedSession } = await supabase.from("triage_sessions").select("lead_id").eq("id", sessionId).eq("company_id", companyId).maybeSingle();
  if (linkedSession?.lead_id) {
    await supabase.from("leads").update({ triage_completed: true, triage_session_id: sessionId, score: aiResult.score ?? 0, priority: aiResult.prioridade || "media", notes: aiResult.proxima_acao || null })
      .eq("id", linkedSession.lead_id).eq("company_id", companyId);
    return;
  }
  // Busca a primeira etapa do pipeline
  const { data: stage } = await supabase
    .from("pipeline_stages")
    .select("id")
    .eq("company_id", companyId)
    .order("sort_order")
    .limit(1)
    .single();

  if (!stage) return;

  const leadName = String(dados.nome || "Lead via WhatsApp");
  const priority = aiResult.prioridade || "media";
  const score = aiResult.score || 0;

  const leadData = {
    company_id: companyId,
    name: leadName,
    // O telefone e o proprio numero do WhatsApp (a IA nunca pergunta telefone).
    phone: String(dados.telefone || phone),
    source: "WhatsApp",
    stage_id: stage.id,
    status: "aberto",
    score,
    priority,
    triage_completed: true,
    triage_session_id: sessionId,
    notes: aiResult.proxima_acao || null,
    estimated_value: 0,
  };

  const { data: lead, error } = await supabase
    .from("leads")
    .insert(leadData)
    .select("id")
    .single();

  if (error) {
    console.error("Erro ao criar lead:", error);
    return;
  }

  // Vincula lead à sessão
  await supabase
    .from("triage_sessions")
    .update({ lead_id: lead.id })
    .eq("id", sessionId);
}
