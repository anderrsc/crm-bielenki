import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { decryptSecret } from "@/lib/encrypt";
import { AiError, aiChat, aiKeyAvailable, parseAiProvider } from "@/lib/ai/chat";
import { sendWhatsAppText, whatsappCredentials } from "@/lib/whatsapp/send";
import { rulesForPrompt } from "@/lib/ai/ana-rules";
import { evolutionMessageText } from "@/lib/whatsapp/message-text";
import { getOrCreateConversation, recordInbound, recordOutbound, type InboxConversation } from "@/lib/whatsapp/inbox-store";
import { AI_FALLBACK_MARK } from "@/lib/ai/central-data";

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
const SYSTEM_PROMPT = `Você é Ana, do atendimento da Marquinhos Calhas e Esquadrias, no WhatsApp.

SUA MISSÃO: entender o que o cliente precisa e juntar as informações para a equipe fazer o orçamento. Você não vende, não negocia e não passa preço.

COMO ESCREVER (o cliente não pode sentir que fala com um robô nem que está preenchendo um formulário):
- Escreva como uma pessoa da equipe no WhatsApp: curto, 1 ou 2 frases, simples e simpático. Sem listas, sem tópicos, sem emojis em excesso.
- Apresente-se só na primeira mensagem ("Aqui é a Ana, da Marquinhos"). Depois, não repita nome da empresa nem "assistente".
- Leia TUDO que o cliente já escreveu e use. Nunca pergunte o que ele já disse ou o que dá para deduzir (ex.: "quero uma chapa de 2 m para colocar sozinho" = compra de peça avulsa, sem instalação, comprimento 2 m).
- Não repita o que o cliente disse de volta ("Você está em Jaraguá do Sul", "Você gostaria de...").
- Nunca mostre a lista de serviços, nunca dê opções numeradas, nunca peça "responda sim ou não".
- Uma pergunta por mensagem. Só junte duas quando forem do mesmo assunto (ex.: largura e espessura).
- Peça foto de forma leve: "se puder, me manda uma foto do local que ajuda bastante".
- Se o cliente perguntar algo que você não sabe (preço, prazo exato, estoque), diga que a equipe confirma no orçamento e siga.
- Se aparecer "conserto", "reparo", "ajuste", "garantia", "vazamento" ou "manutenção" → tipo_atendimento: "pos_venda" e diga que alguém da equipe já vai chamar.

O QUE DESCOBRIR, CONFORME O CASO (só o que faz sentido para o caso; as REGRAS DA EMPRESA no fim mandam mais que isto):
- Sempre: o nome (se ele não disse) e a cidade.
- Peça avulsa / chapa lisa / compra para instalar sozinho: qual peça, comprimento, largura (ou corte), espessura/material, cor e quantidade. Não fale de visita, linha, tipo de obra nem endereço completo.
- Calhas, rufos, pingadeiras, condutores com instalação: se já tem as medidas (e quais), o local da obra (cidade e bairro) e foto do local e/ou projeto. Sem medidas → necessita_visita: true.
- Esquadrias (janelas, portas, fachadas): quais peças e medidas dos vãos, linha e cor se ele já tiver ideia, projeto ou planta, local e fase da obra.
- Outros (portões, guarda-corpos, coberturas, pergolados, estruturas): o que é, medidas aproximadas, local e foto ou projeto.
Quando tiver o essencial do caso, conclua: agradeça em uma frase, diga que a equipe vai montar o orçamento e chamar por aqui, e defina triagem_concluida: true. Não estique a conversa com perguntas que não mudam o orçamento.

No resumo_executivo (para a equipe, não para o cliente) escreva em poucas linhas o que o cliente quer e os dados que ele passou.

RESPONDA SEMPRE EM FORMATO JSON com esta estrutura:
{
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

const SIGNATURE = /^\*([^*\n]{1,40}):\*\s*\n?/;

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
  try {
    const body = await req.text();
    const payload = JSON.parse(body);

    // Detecta formato: Evolution API ou Meta
    const isEvolution = !!(payload?.data?.key || payload?.event);
    let fromMe = false;
    // Evolution: confere o segredo antes de qualquer outra coisa (o da Vercel ou o gerado pelo CRM).
    if (isEvolution) {
      const headerSecret = req.headers.get("x-webhook-secret") ?? req.headers.get("apikey") ?? "";
      let companySecret: string | null = null;
      if (!sameSecret(headerSecret, process.env.EVOLUTION_WEBHOOK_SECRET ?? "") && payload?.instance) {
        try {
          const { data } = await getSupabase().from("ai_agent_config").select("evolution_webhook_secret").eq("evolution_instance", String(payload.instance)).maybeSingle();
          companySecret = data?.evolution_webhook_secret ?? null;
        } catch { companySecret = null; }
      }
      if (!validEvolutionSecret(headerSecret, companySecret)) {
        return NextResponse.json({ error: "Invalid Evolution webhook secret" }, { status: 401 });
      }
    }

    let from = "";
    let phoneNumberId = "";
    let clientText = "";
    let mediaInfo: string | null = null;
    let contactName: string | null = null;

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
      const phone = evolutionPhone(data?.key);
      if (!phone) return NextResponse.json({ status: fromMe ? "own_message" : "no_phone" });
      from = phone;
      phoneNumberId = payload.instance ?? process.env.EVOLUTION_INSTANCE ?? "";
      const extracted = evolutionMessageText(data?.message);
      if (!extracted.text) return NextResponse.json({ status: "unsupported_type" });
      clientText = extracted.text;
      mediaInfo = extracted.media;
    } else {
      // Meta WhatsApp Business API format
      const signature = req.headers.get("x-hub-signature-256") ?? "";
      const appSecret = process.env.WHATSAPP_APP_SECRET ?? "";
      if (!verifySignature(body, signature, appSecret)) {
        return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
      }
      const entry = payload?.entry?.[0];
      const change = entry?.changes?.[0];
      const value = change?.value;
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
    if (eventId) {
      const { data: novo, error: dedupeError } = await supabase.from("whatsapp_webhook_events")
        .upsert({ provider: isEvolution ? "evolution" : "meta", event_id: eventId }, { onConflict: "provider,event_id", ignoreDuplicates: true })
        .select("event_id");
      if (!dedupeError && !novo?.length) return NextResponse.json({ status: "duplicate" });
    }

    // Busca empresa — por phone_number_id (Meta) ou instance (Evolution)
    let company: { id: string; name: string; trade_name: string; whatsapp_phone_number_id: string } | null = null;
    if (isEvolution) {
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

    const { data: agentConfig } = await supabase
      .from("ai_agent_config")
      .select("*")
      .eq("company_id", company.id)
      .single();

    // Mensagem enviada pelo celular/WhatsApp Web da empresa (Evolution).
    if (fromMe) {
      await recordOwnMessage(supabase, company.id, from, clientText, eventId);
      return NextResponse.json({ status: "own_message" });
    }

    // Toda mensagem entra no Atendimento, com ou sem a Ana.
    let conversation: InboxConversation | null = null;
    try {
      conversation = await recordInbound(supabase, { companyId: company.id, phone: from, contactName, body: clientText, externalId: eventId || null });
      if (!conversation) return NextResponse.json({ status: "duplicate" });
    } catch (error) {
      console.error("Atendimento: falha ao gravar mensagem:", error instanceof Error ? error.message : error);
    }
    // Alguém da equipe assumiu a conversa: a Ana fica quieta.
    if (conversation?.ai_paused) return NextResponse.json({ status: "human_handling" });
    // A Ana só atende contato novo: quem já é cliente fala com a equipe.
    if (conversation?.client_id) return NextResponse.json({ status: "known_client" });

    const aiProvider = parseAiProvider(agentConfig?.ai_provider);
    const companyAiKey = aiProvider === "groq" ? (agentConfig?.groq_api_key ?? agentConfig?.openai_api_key) : agentConfig?.openai_api_key;
    if (!agentConfig?.active || !aiKeyAvailable(aiProvider, companyAiKey)) {
      console.log("Agente IA não configurado/ativo para empresa:", company.id);
      return NextResponse.json({ status: "agent_inactive" });
    }

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
    const agentName = agentConfig.agent_name || "Ana";
    // Responde pelo mesmo canal que trouxe a mensagem (antes uma config "evolution"
    // padrao fazia as respostas de quem usa a API da Meta nunca sairem).
    const wppProvider = isEvolution ? "evolution" : "meta";
    const credentials = whatsappCredentials(agentConfig, { provider: wppProvider, phoneNumberId });
    const reply = async (text: string) => {
      let externalId: string | null = null;
      let failure: string | null = null;
      try { externalId = await sendWhatsAppText(credentials, from, text); }
      catch (error) { failure = error instanceof Error ? error.message : String(error); console.error("Falha ao enviar WhatsApp:", failure); }
      if (conversation) {
        await recordOutbound(supabase, { companyId: company.id, conversationId: conversation.id, body: text, author: "ana", senderName: agentName, externalId, deliveryStatus: failure ? "falhou" : "enviada", error: failure })
          .catch((error) => console.error("Atendimento: falha ao gravar resposta:", error instanceof Error ? error.message : error));
      }
    };

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

    // Adiciona mensagem do cliente ao histórico
    const updatedMessages = [
      ...((Array.isArray(session.messages) ? session.messages : []) as Array<{ role: string; content: string; timestamp: string }>),
      { role: "user", content: clientText, timestamp: new Date().toISOString() }
    ];

    // Monta histórico da conversa para a IA
    const conversationHistory = updatedMessages.map(m => ({
      role: m.role as "user" | "assistant" | "system",
      content: m.content
    }));

    // Adiciona contexto dos dados já coletados
    const dadosAtuais = (session.dados_coletados && typeof session.dados_coletados === "object" ? session.dados_coletados : {}) as Record<string, unknown>;
    const contextMsg = `\n\nVocê se chama ${agentName} e atende pela ${companyName}.`
      + (isNewSession ? ` Este é o primeiro contato do cliente: cumprimente, diga que é a Ana da Marquinhos e já responda ao que ele escreveu, com a próxima pergunta que fizer sentido.` : "")
      + (Object.keys(dadosAtuais).length > 0 ? `\n\nDADOS JÁ COLETADOS NESTA TRIAGEM: ${JSON.stringify(dadosAtuais)}\n\nContinue de onde parou.` : "");

    const companyRules = rulesForPrompt(typeof agentConfig?.system_prompt === "string" ? agentConfig.system_prompt : null);

    // Chama a IA configurada (Ollama Cloud, Groq ou OpenAI)
    let aiContent: string;
    try {
      aiContent = await aiChat({
        provider: aiProvider,
        model: agentConfig.openai_model,
        apiKey: secretValue(companyAiKey),
        temperature: Number(agentConfig.temperature ?? 0.3),
        json: true,
        maxTokens: 1000,
        messages: [
          { role: "system", content: SYSTEM_PROMPT + contextMsg + (companyRules ? `\n\n${companyRules}` : "") },
          ...conversationHistory,
        ],
      });
    } catch (error) {
      console.error("Erro do provedor de IA:", error instanceof AiError ? `${error.provider} ${error.status}: ${error.message}` : error);
      // Guarda a mensagem do cliente e avisa que uma pessoa vai responder: nada se perde.
      const aviso = `Olá! Recebemos sua mensagem aqui na ${companyName}. Em instantes ${AI_FALLBACK_MARK}.`;
      await supabase.from("triage_sessions").update({
        messages: [...updatedMessages, { role: "assistant", content: aviso, timestamp: new Date().toISOString() }],
        updated_at: new Date().toISOString(),
      }).eq("id", session.id);
      await reply(aviso);
      return NextResponse.json({ status: "ai_failed_fallback_sent" });
    }

    let aiResult: {
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

    const resposta = aiResult.mensagem || "Como posso ajudá-lo?";

    // Adiciona resposta da IA ao histórico
    const finalMessages = [
      ...updatedMessages,
      { role: "assistant", content: resposta, timestamp: new Date().toISOString() }
    ];

    // Merge dos dados coletados
    const novosDados = { ...dadosAtuais };
    if (aiResult.dados_coletados) {
      for (const [k, v] of Object.entries(aiResult.dados_coletados)) {
        if (v !== null && v !== undefined) novosDados[k] = v;
      }
    }
    if (mediaInfo === "image") novosDados.possui_fotos = true;
    if (mediaInfo === "document") novosDados.possui_projeto = true;

    // Determina status da sessão
    const isPosVenda = aiResult.tipo_atendimento === "pos_venda";
    const isConcluida = aiResult.triagem_concluida;
    const novoStatus = isPosVenda ? "pos_venda" : isConcluida ? "concluida" : "em_andamento";

    // Atualiza sessão
    const updateData: Record<string, unknown> = {
      messages: finalMessages,
      dados_coletados: novosDados,
      status: novoStatus,
      updated_at: new Date().toISOString(),
      // Campos diretos da triagem
      nome: novosDados.nome ?? session.nome,
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
    // Triagem concluída ou pós-venda: a conversa passa para a equipe e a Ana para de responder.
    if ((isConcluida || isPosVenda) && conversation) {
      await supabase.from("conversations").update({ ai_paused: true }).eq("id", conversation.id);
    }

    // Se triagem concluída e é lead comercial, cria/atualiza lead no CRM
    if (isConcluida && !isPosVenda) {
      await createOrUpdateLead(company.id, session.id, from, novosDados, aiResult);
    }

    // Envia resposta pelo mesmo canal (Evolution API ou Meta)
    await reply(resposta);

    return NextResponse.json({ status: "ok", triagem_concluida: isConcluida });
  } catch (err) {
    console.error("Webhook error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

/**
 * Mensagem que a empresa mandou pelo celular ou WhatsApp Web. Ecos do que o CRM
 * ou a Ana enviaram são ignorados; o resto entra como "equipe" (nome pela
 * assinatura *Rose:*) e a Ana para de responder esse cliente.
 */
async function recordOwnMessage(supabase: ReturnType<typeof getSupabase>, companyId: string, phone: string, body: string, externalId: string) {
  try {
    const known = async () => {
      if (!externalId) return false;
      const { data } = await supabase.from("messages").select("id").eq("company_id", companyId).eq("external_id", externalId).limit(1);
      return !!data?.length;
    };
    if (await known()) return;
    // O CRM grava a mensagem logo depois que a Evolution confirma o envio: espera um pouco.
    await new Promise((r) => setTimeout(r, 3000));
    if (await known()) return;
    const conversation = await getOrCreateConversation(supabase, companyId, phone);
    const since = new Date(Date.now() - 2 * 60_000).toISOString();
    const { data: same } = await supabase.from("messages").select("id")
      .eq("conversation_id", conversation.id).eq("direction", "outbound").eq("body", body).gte("sent_at", since).limit(1);
    if (same?.length) return;
    const name = body.match(SIGNATURE)?.[1]?.trim() || "Equipe (celular)";
    await recordOutbound(supabase, { companyId, conversationId: conversation.id, body, author: "equipe", senderName: name, externalId: externalId || null });
    await supabase.from("conversations").update({ ai_paused: true }).eq("id", conversation.id);
  } catch (error) {
    console.error("Atendimento: falha ao gravar mensagem da equipe:", error instanceof Error ? error.message : error);
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
