// Definições de ferramentas para o Gemini e handlers de execução.
// Leituras: executam direto. Escritas: retornam needs_confirmation.
// A confirmação é feita pelo endpoint /api/lia-interna/confirm.

import { createClient } from "@/lib/supabase/server";
import { sendWhatsAppText, whatsappCredentials } from "@/lib/whatsapp/send";
import { todayISO } from "@/lib/utils";
import type { ToolResult } from "./types";

// ── Declarações para o Gemini ────────────────────────────────────────────────

export const TOOL_DECLARATIONS = [
  {
    name: "buscar_cliente",
    description: "Busca clientes pelo nome, telefone ou e-mail. Retorna lista de clientes ativos.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Nome, telefone ou e-mail parcial do cliente" },
      },
      required: ["query"],
    },
  },
  {
    name: "buscar_fornecedor",
    description: "Busca fornecedores pelo nome ou CNPJ.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Nome ou CNPJ parcial do fornecedor" },
      },
      required: ["query"],
    },
  },
  {
    name: "buscar_conta",
    description: "Busca contas financeiras (receber ou pagar) por descrição, cliente ou fornecedor.",
    parameters: {
      type: "object",
      properties: {
        tipo: { type: "string", enum: ["receber", "pagar", "todos"], description: "Tipo da conta" },
        query: { type: "string", description: "Descrição, nome do cliente/fornecedor" },
        status: { type: "string", enum: ["pendente", "atrasado", "pago", "todos"], description: "Status da conta" },
      },
      required: ["tipo"],
    },
  },
  {
    name: "registrar_compra",
    description: "Registra uma compra (conta a pagar) para um fornecedor. Requer confirmação.",
    parameters: {
      type: "object",
      properties: {
        supplier_id: { type: "string", description: "UUID do fornecedor" },
        supplier_name: { type: "string", description: "Nome do fornecedor (para exibir no resumo)" },
        description: { type: "string", description: "Descrição da compra/fatura" },
        amount: { type: "number", description: "Valor total em reais" },
        due_date: { type: "string", description: "Data de vencimento no formato aaaa-mm-dd" },
        payment_method: { type: "string", description: "Forma de pagamento (pix, boleto, transferencia, dinheiro)" },
      },
      required: ["supplier_id", "supplier_name", "description", "amount", "due_date"],
    },
  },
  {
    name: "dar_baixa",
    description: "Registra o pagamento (dá baixa) de uma conta financeira. Requer confirmação.",
    parameters: {
      type: "object",
      properties: {
        entry_id: { type: "string", description: "UUID da conta financeira" },
        entry_description: { type: "string", description: "Descrição da conta (para exibir no resumo)" },
        amount: { type: "number", description: "Valor pago em reais (pode ser parcial)" },
        paid_at: { type: "string", description: "Data do pagamento aaaa-mm-dd (padrão: hoje)" },
        payment_method: { type: "string", description: "Forma de pagamento (pix, boleto, transferencia, dinheiro, cartao)" },
      },
      required: ["entry_id", "entry_description", "amount"],
    },
  },
  {
    name: "gerar_recibo",
    description: "Gera o link do recibo/comprovante de pagamento de uma conta paga.",
    parameters: {
      type: "object",
      properties: {
        entry_id: { type: "string", description: "UUID da conta financeira" },
      },
      required: ["entry_id"],
    },
  },
  {
    name: "enviar_recibo",
    description: "Envia o recibo de pagamento para o cliente via WhatsApp. Requer confirmação.",
    parameters: {
      type: "object",
      properties: {
        entry_id: { type: "string", description: "UUID da conta financeira" },
        phone: { type: "string", description: "Telefone do destinatário (opcional: usa o do cliente cadastrado)" },
      },
      required: ["entry_id"],
    },
  },
  {
    name: "enviar_whatsapp",
    description: "Envia uma mensagem de texto pelo WhatsApp para um número ou cliente. Requer confirmação.",
    parameters: {
      type: "object",
      properties: {
        phone_or_client_id: { type: "string", description: "Número de telefone ou UUID do cliente" },
        recipient_name: { type: "string", description: "Nome do destinatário (para exibir no resumo)" },
        message: { type: "string", description: "Texto da mensagem" },
      },
      required: ["phone_or_client_id", "recipient_name", "message"],
    },
  },
  {
    name: "consultar_financeiro",
    description: "Consulta resumo financeiro: total a receber, a pagar, em atraso e recebido no período.",
    parameters: {
      type: "object",
      properties: {
        periodo: { type: "string", enum: ["hoje", "semana", "mes", "trimestre", "ano"], description: "Período da consulta" },
      },
      required: [],
    },
  },
  {
    name: "consultar_orcamentos",
    description: "Lista orçamentos, com filtro opcional por cliente ou status.",
    parameters: {
      type: "object",
      properties: {
        client_id: { type: "string", description: "UUID do cliente (opcional)" },
        status: { type: "string", enum: ["rascunho", "enviado", "fechado", "todos"], description: "Status do orçamento" },
      },
      required: [],
    },
  },
  {
    name: "criar_tarefa",
    description: "Cria uma tarefa no sistema. Requer confirmação.",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", description: "Título da tarefa" },
        description: { type: "string", description: "Descrição detalhada (opcional)" },
        due_at: { type: "string", description: "Prazo no formato aaaa-mm-ddTHH:mm:ssZ (opcional)" },
        priority: { type: "string", enum: ["baixa", "normal", "alta"], description: "Prioridade (padrão: normal)" },
      },
      required: ["title"],
    },
  },
  {
    name: "desfazer_ultima_acao",
    description: "Tenta desfazer a última ação de escrita feita pela Lia nesta sessão. Requer confirmação.",
    parameters: { type: "object", properties: {}, required: [] },
  },
];

// ── Handlers ─────────────────────────────────────────────────────────────────

export async function executeTool(
  name: string,
  args: Record<string, unknown>,
  context: { companyId: string; userId: string; sessionId: string },
): Promise<ToolResult> {
  const db = await createClient();

  switch (name) {
    case "buscar_cliente": {
      const q = String(args.query ?? "").trim();
      if (!q) return { type: "error", message: "Informe o nome ou telefone para buscar." };
      const digits = q.replace(/\D/g, "");
      let query = db.from("clients")
        .select("id,name,phone,email,city,status")
        .eq("company_id", context.companyId)
        .eq("status", "ativo")
        .is("deleted_at", null)
        .limit(10);
      if (digits.length >= 6) {
        query = db.from("clients")
          .select("id,name,phone,email,city,status")
          .eq("company_id", context.companyId)
          .eq("status", "ativo")
          .is("deleted_at", null)
          .or(`name.ilike.%${q}%,phone.ilike.%${digits}%,email.ilike.%${q}%`)
          .limit(10);
      } else {
        query = db.from("clients")
          .select("id,name,phone,email,city,status")
          .eq("company_id", context.companyId)
          .eq("status", "ativo")
          .is("deleted_at", null)
          .ilike("name", `%${q}%`)
          .limit(10);
      }
      const { data, error } = await query;
      if (error) return { type: "error", message: error.message };
      if (!data?.length) return { type: "ok", data: { clientes: [], message: "Nenhum cliente encontrado." } };
      return { type: "ok", data: { clientes: data } };
    }

    case "buscar_fornecedor": {
      const q = String(args.query ?? "").trim();
      if (!q) return { type: "error", message: "Informe o nome para buscar." };
      const digits = q.replace(/\D/g, "");
      const filter = digits.length >= 8
        ? `name.ilike.%${q}%,tax_id.ilike.%${digits}%`
        : `name.ilike.%${q}%`;
      const { data, error } = await db.from("suppliers")
        .select("id,name,phone,tax_id,status")
        .eq("company_id", context.companyId)
        .eq("status", "ativo")
        .or(filter)
        .limit(10);
      if (error) return { type: "error", message: error.message };
      if (!data?.length) return { type: "ok", data: { fornecedores: [], message: "Nenhum fornecedor encontrado." } };
      return { type: "ok", data: { fornecedores: data } };
    }

    case "buscar_conta": {
      const tipo = String(args.tipo ?? "todos");
      const q = String(args.query ?? "").trim();
      const statusFilter = String(args.status ?? "todos");
      let query = db.from("financial_entries")
        .select("id,description,entry_type,total_amount,open_amount,paid_amount,due_date,status,client:clients(name),supplier:suppliers(name)")
        .eq("company_id", context.companyId)
        .order("due_date", { ascending: true })
        .limit(20);
      if (tipo !== "todos") query = query.eq("entry_type", tipo);
      if (statusFilter === "pendente") query = query.in("status", ["pendente", "parcialmente_pago"]);
      else if (statusFilter === "atrasado") query = query.eq("status", "atrasado");
      else if (statusFilter === "pago") query = query.eq("status", "pago");
      else query = query.not("status", "eq", "cancelado");
      if (q) query = query.ilike("description", `%${q}%`);
      const { data, error } = await query;
      if (error) return { type: "error", message: error.message };
      return { type: "ok", data: { contas: data ?? [] } };
    }

    case "registrar_compra": {
      const supplier_id = String(args.supplier_id ?? "");
      const amount = Number(args.amount);
      const due_date = String(args.due_date ?? "");
      const description = String(args.description ?? "").trim();
      if (!supplier_id || !amount || !due_date || !description) {
        return { type: "error", message: "Informe fornecedor, descrição, valor e vencimento." };
      }
      const valor = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(amount);
      const [y, m, d] = due_date.split("-");
      const dataFmt = `${d}/${m}/${y}`;
      return {
        type: "needs_confirmation",
        preview: `Registrar compra de **${valor}** para **${args.supplier_name ?? supplier_id}**\nDescrição: ${description}\nVencimento: ${dataFmt}`,
        params: { tool: "registrar_compra", supplier_id, description, amount, due_date, payment_method: args.payment_method ?? null },
      };
    }

    case "dar_baixa": {
      const entry_id = String(args.entry_id ?? "");
      const amount = Number(args.amount);
      if (!entry_id || !amount) return { type: "error", message: "Informe a conta e o valor para dar baixa." };
      const paid_at = String(args.paid_at ?? todayISO());
      const payment_method = String(args.payment_method ?? "pix");
      const valor = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(amount);
      const [y, m, d] = paid_at.split("-");
      return {
        type: "needs_confirmation",
        preview: `Dar baixa de **${valor}** na conta: **${args.entry_description ?? entry_id}**\nData: ${d}/${m}/${y} · Método: ${payment_method}`,
        params: { tool: "dar_baixa", entry_id, amount, paid_at, payment_method },
      };
    }

    case "gerar_recibo": {
      const entry_id = String(args.entry_id ?? "");
      if (!entry_id) return { type: "error", message: "Informe o ID da conta." };
      const { data: entry, error } = await db.from("financial_entries")
        .select("id,description,total_amount,paid_amount,status,client:clients(name,phone)")
        .eq("id", entry_id)
        .eq("company_id", context.companyId)
        .maybeSingle();
      if (error || !entry) return { type: "error", message: "Conta não encontrada." };
      if (entry.status !== "pago") return { type: "error", message: "Esta conta ainda não foi paga. Dê a baixa primeiro." };
      const url = `${process.env.NEXT_PUBLIC_SITE_URL ?? ""}/api/orcamentos/${entry_id}/pdf?tipo=recibo`;
      return { type: "ok", data: { url, entry } };
    }

    case "enviar_recibo": {
      const entry_id = String(args.entry_id ?? "");
      if (!entry_id) return { type: "error", message: "Informe o ID da conta." };
      const { data: entry, error } = await db.from("financial_entries")
        .select("id,description,total_amount,status,client:clients(id,name,phone,whatsapp)")
        .eq("id", entry_id)
        .eq("company_id", context.companyId)
        .maybeSingle();
      if (error || !entry) return { type: "error", message: "Conta não encontrada." };
      if (entry.status !== "pago") return { type: "error", message: "Esta conta ainda não foi paga." };
      const client = (entry.client as unknown) as { id: string; name: string; phone: string | null; whatsapp: string | null } | null;
      const phone = String(args.phone ?? client?.whatsapp ?? client?.phone ?? "").replace(/\D/g, "");
      if (!phone) return { type: "error", message: "Nenhum telefone encontrado para este cliente. Informe o número." };
      const valor = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(entry.total_amount));
      return {
        type: "needs_confirmation",
        preview: `Enviar recibo de **${valor}** (${entry.description}) para **${client?.name ?? phone}** via WhatsApp (${phone})`,
        params: { tool: "enviar_recibo", entry_id, phone, client_name: client?.name ?? null },
      };
    }

    case "enviar_whatsapp": {
      const raw = String(args.phone_or_client_id ?? "").trim();
      let phone = raw.replace(/\D/g, "");
      let recipientName = String(args.recipient_name ?? raw);
      if (!phone) return { type: "error", message: "Informe o número de telefone ou o cliente." };
      // Se parece UUID, busca o cliente
      if (/^[0-9a-f-]{36}$/i.test(raw)) {
        const { data: c } = await db.from("clients").select("phone,whatsapp,name").eq("id", raw).eq("company_id", context.companyId).maybeSingle();
        phone = (c?.whatsapp ?? c?.phone ?? "").replace(/\D/g, "");
        if (c?.name) recipientName = c.name;
        if (!phone) return { type: "error", message: "Cliente sem telefone cadastrado." };
      }
      const message = String(args.message ?? "").trim();
      if (!message) return { type: "error", message: "Informe a mensagem." };
      return {
        type: "needs_confirmation",
        preview: `Enviar mensagem para **${recipientName}** (${phone}) via WhatsApp:\n\n"${message}"`,
        params: { tool: "enviar_whatsapp", phone, recipient_name: recipientName, message },
      };
    }

    case "consultar_financeiro": {
      const periodo = String(args.periodo ?? "mes");
      const now = new Date();
      let start: string;
      const today = todayISO();
      if (periodo === "hoje") start = today;
      else if (periodo === "semana") { const d = new Date(now); d.setDate(d.getDate() - 7); start = d.toISOString().slice(0, 10); }
      else if (periodo === "trimestre") { const d = new Date(now); d.setMonth(d.getMonth() - 3); start = d.toISOString().slice(0, 10); }
      else if (periodo === "ano") start = `${now.getFullYear()}-01-01`;
      else start = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;

      const { data: entries, error } = await db.from("financial_entries")
        .select("entry_type,total_amount,open_amount,paid_amount,status,due_date")
        .eq("company_id", context.companyId)
        .not("status", "eq", "cancelado")
        .gte("due_date", start)
        .lte("due_date", today.slice(0, 7) + "-31");
      if (error) return { type: "error", message: error.message };
      const rows = (entries ?? []) as { entry_type: string; total_amount: number; open_amount: number; paid_amount: number; status: string; due_date: string }[];
      const receber = rows.filter((r) => r.entry_type === "receber");
      const pagar = rows.filter((r) => r.entry_type === "pagar");
      const sum = (arr: typeof rows) => arr.reduce((n, r) => n + Number(r.total_amount), 0);
      const sumOpen = (arr: typeof rows) => arr.reduce((n, r) => n + Number(r.open_amount), 0);
      const sumPaid = (arr: typeof rows) => arr.reduce((n, r) => n + Number(r.paid_amount), 0);
      const overdue = rows.filter((r) => r.status === "atrasado");
      return {
        type: "ok",
        data: {
          periodo,
          a_receber: { total: sum(receber), pendente: sumOpen(receber), recebido: sumPaid(receber), qtd: receber.length },
          a_pagar: { total: sum(pagar), pendente: sumOpen(pagar), pago: sumPaid(pagar), qtd: pagar.length },
          em_atraso: { qtd: overdue.length, total: sumOpen(overdue) },
        },
      };
    }

    case "consultar_orcamentos": {
      const client_id = String(args.client_id ?? "").trim();
      const statusFilter = String(args.status ?? "todos");
      let query = db.from("quotes")
        .select("id,status,total,valid_until,created_at,client:clients(id,name)")
        .eq("company_id", context.companyId)
        .order("created_at", { ascending: false })
        .limit(15);
      if (client_id && /^[0-9a-f-]{36}$/i.test(client_id)) query = query.eq("client_id", client_id);
      if (statusFilter !== "todos") query = query.eq("status", statusFilter);
      const { data, error } = await query;
      if (error) return { type: "error", message: error.message };
      return { type: "ok", data: { orcamentos: data ?? [] } };
    }

    case "criar_tarefa": {
      const title = String(args.title ?? "").trim();
      if (!title) return { type: "error", message: "Informe o título da tarefa." };
      const due_at = args.due_at ? String(args.due_at) : null;
      const description = args.description ? String(args.description).trim() : null;
      const priority = String(args.priority ?? "normal");
      const dueFmt = due_at ? ` · Prazo: ${new Date(due_at).toLocaleDateString("pt-BR")}` : "";
      return {
        type: "needs_confirmation",
        preview: `Criar tarefa: **${title}**${description ? `\n${description}` : ""}${dueFmt} · Prioridade: ${priority}`,
        params: { tool: "criar_tarefa", title, description, due_at, priority },
      };
    }

    case "desfazer_ultima_acao": {
      const { data: lastAction, error } = await db.from("lia_actions")
        .select("id,tool,params,created_at,reversed_at")
        .eq("company_id", context.companyId)
        .eq("session_id", context.sessionId)
        .is("reversed_at", null)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) return { type: "error", message: error.message };
      if (!lastAction) return { type: "error", message: "Nenhuma ação para desfazer nesta sessão." };
      const reversible = ["dar_baixa", "registrar_compra", "criar_tarefa"];
      if (!reversible.includes(lastAction.tool)) {
        return { type: "error", message: `A ação "${lastAction.tool}" não pode ser desfeita automaticamente.` };
      }
      const time = new Date(lastAction.created_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
      return {
        type: "needs_confirmation",
        preview: `Desfazer ação "${lastAction.tool}" feita às ${time}?`,
        params: { tool: "desfazer_ultima_acao", action_id: lastAction.id, original_tool: lastAction.tool, original_params: lastAction.params },
      };
    }

    default:
      return { type: "error", message: `Ferramenta desconhecida: ${name}` };
  }
}

// ── Executor de ações confirmadas ─────────────────────────────────────────────

export async function executeConfirmedAction(
  params: Record<string, unknown>,
  context: { companyId: string; userId: string; sessionId: string },
): Promise<{ ok: true; message: string; action_id?: string } | { ok: false; error: string }> {
  const db = await createClient();
  const tool = String(params.tool ?? "");

  switch (tool) {
    case "registrar_compra": {
      const { data: profile } = await db.from("profiles").select("company_id").single();
      if (profile?.company_id !== context.companyId) return { ok: false, error: "Empresa não identificada." };
      const { data: supplier } = await db.from("suppliers").select("id").eq("id", String(params.supplier_id)).eq("company_id", context.companyId).maybeSingle();
      if (!supplier) return { ok: false, error: "Fornecedor não encontrado nesta empresa." };
      const entryId = crypto.randomUUID();
      const { error } = await db.from("financial_entries").insert({
        id: entryId,
        company_id: context.companyId,
        entry_type: "pagar",
        origin: "manual",
        supplier_id: params.supplier_id,
        description: String(params.description),
        total_amount: Number(params.amount),
        due_date: String(params.due_date),
        payment_method: params.payment_method ? String(params.payment_method) : null,
        notes: "Registrado via Lia Interna",
      });
      if (error) return { ok: false, error: error.message };
      const { data: action } = await db.from("lia_actions").insert({
        session_id: context.sessionId,
        company_id: context.companyId,
        user_id: context.userId,
        tool: "registrar_compra",
        params,
        result: { entry_id: entryId },
      }).select("id").single();
      return { ok: true, message: "Compra registrada no financeiro.", action_id: action?.id };
    }

    case "dar_baixa": {
      const entry_id = String(params.entry_id ?? "");
      const amount = Number(params.amount);
      const paid_at = String(params.paid_at ?? todayISO());
      const payment_method = String(params.payment_method ?? "pix");
      const { data: paymentId, error } = await db.rpc("register_payment", {
        p_entry_id: entry_id,
        p_amount: amount,
        p_paid_at: paid_at,
        p_method: payment_method,
        p_notes: "Baixa via Lia Interna",
      });
      if (error) return { ok: false, error: error.message };
      const { data: action } = await db.from("lia_actions").insert({
        session_id: context.sessionId,
        company_id: context.companyId,
        user_id: context.userId,
        tool: "dar_baixa",
        params,
        result: { payment_id: paymentId },
      }).select("id").single();
      return { ok: true, message: "Baixa registrada com sucesso.", action_id: action?.id };
    }

    case "enviar_recibo": {
      const entry_id = String(params.entry_id ?? "");
      const phone = String(params.phone ?? "").replace(/\D/g, "");
      if (!phone) return { ok: false, error: "Número de telefone inválido." };
      const { data: entry, error: entryErr } = await db.from("financial_entries")
        .select("id,description,total_amount,status")
        .eq("id", entry_id)
        .eq("company_id", context.companyId)
        .maybeSingle();
      if (entryErr || !entry) return { ok: false, error: "Conta não encontrada." };
      if (entry.status !== "pago") return { ok: false, error: "Conta ainda não está paga." };
      const { data: cfg } = await db.from("ai_agent_config").select("*").maybeSingle();
      const creds = whatsappCredentials(cfg as Record<string, unknown> | null);
      const valor = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(entry.total_amount));
      const reciboUrl = `${process.env.NEXT_PUBLIC_SITE_URL ?? ""}/api/orcamentos/${entry_id}/pdf?tipo=recibo`;
      const msg = `Olá! Segue o recibo referente ao pagamento de ${valor} (${entry.description}).\n\n${reciboUrl}`;
      const whatsappId = await sendWhatsAppText(creds, phone, msg);
      if (!whatsappId) return { ok: false, error: "Erro ao enviar WhatsApp. Verifique a conexão." };
      const { data: action } = await db.from("lia_actions").insert({
        session_id: context.sessionId,
        company_id: context.companyId,
        user_id: context.userId,
        tool: "enviar_recibo",
        params,
        result: { phone, whatsapp_id: whatsappId },
      }).select("id").single();
      return { ok: true, message: `Recibo enviado para ${params.client_name ?? phone}.`, action_id: action?.id };
    }

    case "enviar_whatsapp": {
      const phone = String(params.phone ?? "").replace(/\D/g, "");
      const message = String(params.message ?? "").trim();
      if (!phone || !message) return { ok: false, error: "Número ou mensagem inválidos." };
      const { data: cfg } = await db.from("ai_agent_config").select("*").maybeSingle();
      const creds = whatsappCredentials(cfg as Record<string, unknown> | null);
      const whatsappId2 = await sendWhatsAppText(creds, phone, message);
      if (!whatsappId2) return { ok: false, error: "Erro ao enviar WhatsApp. Verifique a conexão." };
      const { data: action } = await db.from("lia_actions").insert({
        session_id: context.sessionId,
        company_id: context.companyId,
        user_id: context.userId,
        tool: "enviar_whatsapp",
        params,
        result: { phone, whatsapp_id: whatsappId2 },
      }).select("id").single();
      return { ok: true, message: `Mensagem enviada para ${params.recipient_name ?? phone}.`, action_id: action?.id };
    }

    case "criar_tarefa": {
      const title = String(params.title ?? "").trim();
      if (!title) return { ok: false, error: "Título inválido." };
      const { data: task, error } = await db.from("tasks").insert({
        company_id: context.companyId,
        title,
        description: params.description ? String(params.description) : null,
        due_at: params.due_at ? String(params.due_at) : null,
        priority: String(params.priority ?? "normal"),
        status: "pendente",
        assigned_to: context.userId,
      }).select("id").single();
      if (error) return { ok: false, error: error.message };
      const { data: action } = await db.from("lia_actions").insert({
        session_id: context.sessionId,
        company_id: context.companyId,
        user_id: context.userId,
        tool: "criar_tarefa",
        params,
        result: { task_id: task?.id },
      }).select("id").single();
      return { ok: true, message: `Tarefa criada: "${title}"`, action_id: action?.id };
    }

    case "desfazer_ultima_acao": {
      const action_id = String(params.action_id ?? "");
      const original_tool = String(params.original_tool ?? "");
      const original_params = params.original_params as Record<string, unknown>;
      const { data: action } = await db.from("lia_actions").select("id,tool,params,result,reversed_at")
        .eq("id", action_id).eq("company_id", context.companyId).maybeSingle();
      if (!action || action.reversed_at) return { ok: false, error: "Ação não encontrada ou já desfeita." };

      let undoMessage = "";
      if (original_tool === "dar_baixa") {
        const result = action.result as { payment_id?: string } | null;
        if (!result?.payment_id) return { ok: false, error: "ID do pagamento não encontrado." };
        const { error } = await db.from("payments").update({ reversed_at: new Date().toISOString() }).eq("id", result.payment_id).eq("company_id", context.companyId);
        if (error) return { ok: false, error: error.message };
        undoMessage = "Baixa desfeita.";
      } else if (original_tool === "registrar_compra") {
        const result = action.result as { entry_id?: string } | null;
        if (!result?.entry_id) return { ok: false, error: "ID da conta não encontrado." };
        const { error } = await db.from("financial_entries").update({ status: "cancelado" } as Record<string, unknown>).eq("id", result.entry_id).eq("company_id", context.companyId);
        if (error) return { ok: false, error: error.message };
        undoMessage = "Compra cancelada no financeiro.";
      } else if (original_tool === "criar_tarefa") {
        const result = action.result as { task_id?: string } | null;
        if (!result?.task_id) return { ok: false, error: "ID da tarefa não encontrado." };
        const { error } = await db.from("tasks").delete().eq("id", result.task_id).eq("company_id", context.companyId);
        if (error) return { ok: false, error: error.message };
        undoMessage = "Tarefa removida.";
      } else {
        return { ok: false, error: "Esta ação não pode ser desfeita." };
      }

      await db.from("lia_actions").update({ reversed_at: new Date().toISOString(), reversed_by: context.userId }).eq("id", action_id);
      return { ok: true, message: undoMessage };
    }

    default:
      return { ok: false, error: `Ferramenta desconhecida: ${tool}` };
  }
}
