import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Sistema de prompt da Ana — Agente de Triagem
const SYSTEM_PROMPT = `Você é Ana, a assistente virtual comercial da Marquinhos Calhas e Esquadrias.

SUA MISSÃO: Realizar triagem completa e estruturada para coletar todas as informações necessárias para elaboração do orçamento.

REGRAS ABSOLUTAS:
- NÃO venda. NÃO negocie. NÃO gere orçamentos.
- Faça UMA pergunta por vez.
- Conduza a conversa de forma natural, humana, cordial e profissional.
- Jamais pule etapas.
- Se identificar palavras como "conserto", "reparo", "ajuste", "garantia", "vazamento" ou "manutenção" → encaminhe para pós-venda (retorne tipo_atendimento: "pos_venda").

INFORMAÇÕES QUE VOCÊ DEVE COLETAR (nesta ordem, naturalmente):
1. Nome completo
2. Cidade
3. Tipo de serviço (calhas, rufos, pingadeiras, condutores, esquadrias, fachadas, portões, guarda-corpos, coberturas, pergolados, estruturas metálicas)
4. Produto específico
5. Possui medidas? (sim/não) — se não, marcar visita técnica necessária
6. Se sim: quais são as medidas?
7. Tipo de obra (obra nova, reforma, ampliação, comercial, industrial)
8. Preferência de modelo/linha (Suprema, Gold, Perfilatto, Atlanta, Linha 25, Minimalista) e cor (preto, branco, amadeirado, grafite, personalizada)
9. Endereço completo da obra (cidade, bairro, rua, número)
10. Prazo desejado para instalação
11. Já realizou outros orçamentos ou possui referência de valor?
12. Solicitar fotos, vídeos, projetos ou plantas se disponíveis

APÓS COLETAR TODAS AS INFORMAÇÕES, gere o RESUMO EXECUTIVO e informe que as informações foram registradas e o orçamento será preparado.

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
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

// GET: verificação do webhook pelo Meta
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const mode = searchParams.get("hub.mode");
  const token = searchParams.get("hub.verify_token");
  const challenge = searchParams.get("hub.challenge");

  const verifyToken = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN ?? "marquinhos-crm-verify";
  if (mode === "subscribe" && token === verifyToken) {
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

    let from = "";
    let phoneNumberId = "";
    let clientText = "";
    let mediaInfo: string | null = null;

    if (isEvolution) {
      // Evolution API webhook format
      // event: "messages.upsert", data.key.remoteJid: "5547999999999@s.whatsapp.net"
      if (payload.event !== "messages.upsert") return NextResponse.json({ status: "ignored" });
      const data = payload.data;
      if (data?.key?.fromMe) return NextResponse.json({ status: "own_message" }); // ignora msgs próprias
      from = (data?.key?.remoteJid ?? "").replace("@s.whatsapp.net", "").replace("@c.us", "");
      phoneNumberId = payload.instance ?? process.env.EVOLUTION_INSTANCE ?? "";
      const msgContent = data?.message;
      if (msgContent?.conversation) {
        clientText = msgContent.conversation;
      } else if (msgContent?.extendedTextMessage?.text) {
        clientText = msgContent.extendedTextMessage.text;
      } else if (msgContent?.imageMessage) {
        clientText = "[foto/imagem recebida]"; mediaInfo = "image";
      } else if (msgContent?.documentMessage) {
        clientText = "[documento/projeto recebido]"; mediaInfo = "document";
      } else if (msgContent?.videoMessage) {
        clientText = "[vídeo recebido]"; mediaInfo = "video";
      } else {
        return NextResponse.json({ status: "unsupported_type" });
      }
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

    // Busca empresa — por phone_number_id (Meta) ou instance (Evolution)
    let company: { id: string; name: string; trade_name: string; whatsapp_phone_number_id: string } | null = null;
    const { data: byPhone } = await supabase
      .from("companies")
      .select("id, name, trade_name, whatsapp_phone_number_id")
      .eq("whatsapp_phone_number_id", phoneNumberId)
      .single();
    company = byPhone;

    // Fallback: pega a primeira empresa ativa (setup single-tenant)
    if (!company) {
      const { data: first } = await supabase
        .from("companies")
        .select("id, name, trade_name, whatsapp_phone_number_id")
        .limit(1)
        .single();
      company = first;
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

    const hasAiKey = agentConfig?.groq_api_key || agentConfig?.openai_api_key;
    if (!agentConfig?.active || !hasAiKey) {
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

    // Se não existe sessão, cria uma nova com mensagem de boas-vindas
    if (!session) {
      const welcomeMsg = `Olá! Seja bem-vindo à ${company.trade_name || company.name}. Meu nome é ${agentConfig.agent_name || "Ana"}, assistente virtual da empresa. Posso começar anotando seu nome?`;

      const { data: newSession, error: sessionError } = await supabase
        .from("triage_sessions")
        .insert({
          company_id: company.id,
          phone: from,
          messages: [
            { role: "assistant", content: welcomeMsg, timestamp: new Date().toISOString() }
          ],
          current_step: "identificacao",
          dados_coletados: {}
        })
        .select()
        .single();

      if (sessionError) {
        console.error("Erro ao criar sessão:", sessionError);
        return NextResponse.json({ error: sessionError.message }, { status: 500 });
      }

      // Envia boas-vindas via WhatsApp
      const wppProviderWelcome = agentConfig.wpp_provider || "evolution";
      await sendWhatsAppMessage({
        to: from,
        text: welcomeMsg,
        provider: wppProviderWelcome,
        phoneNumberId,
        metaToken: agentConfig.whatsapp_token || process.env.WHATSAPP_ACCESS_TOKEN || "",
        evolutionUrl: agentConfig.evolution_api_url || process.env.EVOLUTION_API_URL || "",
        evolutionKey: agentConfig.evolution_api_key || process.env.EVOLUTION_API_KEY || "",
        evolutionInstance: agentConfig.evolution_instance || process.env.EVOLUTION_INSTANCE || "",
      });

      return NextResponse.json({ status: "session_created", session_id: newSession.id });
    }

    // Adiciona mensagem do cliente ao histórico
    const updatedMessages = [
      ...(session.messages as Array<{ role: string; content: string; timestamp: string }>),
      { role: "user", content: clientText, timestamp: new Date().toISOString() }
    ];

    // Monta histórico para o OpenAI
    const conversationHistory = updatedMessages.map(m => ({
      role: m.role as "user" | "assistant" | "system",
      content: m.content
    }));

    // Adiciona contexto dos dados já coletados
    const dadosAtuais = session.dados_coletados as Record<string, unknown>;
    const contextMsg = Object.keys(dadosAtuais).length > 0
      ? `\n\nDADOS JÁ COLETADOS NESTA TRIAGEM: ${JSON.stringify(dadosAtuais)}\n\nContinue de onde parou.`
      : "";

    // Determina provedor de IA (Groq grátis ou OpenAI pago)
    const provider = agentConfig.ai_provider || "groq";
    const isGroq = provider === "groq";
    const aiBaseUrl = isGroq
      ? "https://api.groq.com/openai/v1/chat/completions"
      : "https://api.openai.com/v1/chat/completions";
    const aiKey = isGroq
      ? (agentConfig.groq_api_key ?? agentConfig.openai_api_key)
      : agentConfig.openai_api_key;
    const aiModel = agentConfig.openai_model || (isGroq ? "llama-3.3-70b-versatile" : "gpt-4o");

    // Chama IA (Groq ou OpenAI — API compatível)
    const openaiResponse = await fetch(aiBaseUrl, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${aiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: aiModel,
        temperature: Number(agentConfig.temperature ?? 0.3),
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM_PROMPT + contextMsg },
          ...conversationHistory
        ],
        max_tokens: 1000
      })
    });

    if (!openaiResponse.ok) {
      const errText = await openaiResponse.text();
      console.error("OpenAI error:", errText);
      return NextResponse.json({ error: "OpenAI error", details: errText }, { status: 500 });
    }

    const aiData = await openaiResponse.json();
    const aiContent = aiData.choices?.[0]?.message?.content ?? "{}";

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

    await supabase.from("triage_sessions").update(updateData).eq("id", session.id);

    // Se triagem concluída e é lead comercial, cria/atualiza lead no CRM
    if (isConcluida && !isPosVenda) {
      await createOrUpdateLead(company.id, session.id, novosDados, aiResult);
    }

    // Envia resposta via WhatsApp (Evolution API ou Meta)
    const wppProvider = agentConfig.wpp_provider || "meta";
    await sendWhatsAppMessage({
      to: from,
      text: resposta,
      provider: wppProvider,
      // Meta
      phoneNumberId,
      metaToken: agentConfig.whatsapp_token || process.env.WHATSAPP_ACCESS_TOKEN || "",
      // Evolution API
      evolutionUrl: agentConfig.evolution_api_url || process.env.EVOLUTION_API_URL || "",
      evolutionKey: agentConfig.evolution_api_key || process.env.EVOLUTION_API_KEY || "",
      evolutionInstance: agentConfig.evolution_instance || process.env.EVOLUTION_INSTANCE || "",
    });

    return NextResponse.json({ status: "ok", triagem_concluida: isConcluida });
  } catch (err) {
    console.error("Webhook error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

type SendParams = {
  to: string; text: string; provider: string;
  phoneNumberId: string; metaToken: string;
  evolutionUrl: string; evolutionKey: string; evolutionInstance: string;
};

async function sendWhatsAppMessage(p: SendParams) {
  // Evolution API (grátis, QR code)
  if (p.provider === "evolution") {
    if (!p.evolutionUrl || !p.evolutionInstance) {
      console.log("[DEV/Evolution] Mensagem para", p.to, ":", p.text.slice(0, 80));
      return;
    }
    try {
      await fetch(`${p.evolutionUrl}/message/sendText/${p.evolutionInstance}`, {
        method: "POST",
        headers: { "apikey": p.evolutionKey, "Content-Type": "application/json" },
        body: JSON.stringify({ number: p.to, text: p.text })
      });
    } catch (e) {
      console.error("Erro Evolution API:", e);
    }
    return;
  }

  // Meta WhatsApp Business API (oficial)
  if (!p.metaToken || !p.phoneNumberId) {
    console.log("[DEV/Meta] Mensagem para", p.to, ":", p.text.slice(0, 80));
    return;
  }
  try {
    await fetch(`https://graph.facebook.com/v19.0/${p.phoneNumberId}/messages`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${p.metaToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: p.to,
        type: "text",
        text: { body: p.text }
      })
    });
  } catch (e) {
    console.error("Erro Meta API:", e);
  }
}

async function createOrUpdateLead(
  companyId: string,
  sessionId: string,
  dados: Record<string, unknown>,
  aiResult: { score: number | null; prioridade: string | null; proxima_acao: string | null }
) {
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
    phone: String(dados.telefone || ""),
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
