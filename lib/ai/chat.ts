// Chamada de chat para os provedores de IA do CRM. Usar somente no servidor:
// as chaves nunca vao para o navegador.
// - ollama: Ollama Cloud (https://ollama.com), chave em OLLAMA_API_KEY.
// - groq / openai: APIs compativeis com OpenAI, chave salva (criptografada)
//   nas configuracoes do agente de cada empresa.
import { Ollama } from "ollama";

export type AiProvider = "ollama" | "groq" | "openai";
export type AiMessage = { role: "system" | "user" | "assistant"; content: string };

export const AI_PROVIDERS: AiProvider[] = ["ollama", "groq", "openai"];
export const DEFAULT_AI_MODEL: Record<AiProvider, string> = {
  ollama: "glm-5.3-flash",
  groq: "openai/gpt-oss-120b",
  openai: "gpt-4o",
};

const OPENAI_COMPATIBLE_URL: Record<Exclude<AiProvider, "ollama">, string> = {
  groq: "https://api.groq.com/openai/v1/chat/completions",
  openai: "https://api.openai.com/v1/chat/completions",
};

export class AiError extends Error {
  status: number | null;
  provider: AiProvider;
  constructor(message: string, status: number | null, provider: AiProvider) {
    super(message);
    this.name = "AiError";
    this.status = status;
    this.provider = provider;
  }
}

export function parseAiProvider(value: unknown): AiProvider {
  return AI_PROVIDERS.includes(value as AiProvider) ? (value as AiProvider) : "ollama";
}

/** Mensagem curta em portugues para mostrar na tela (sem detalhes da chave). */
export function aiErrorMessage(error: unknown) {
  if (!(error instanceof AiError)) return "Falha ao chamar a IA.";
  const name = { ollama: "Ollama", groq: "Groq", openai: "OpenAI" }[error.provider];
  switch (error.status) {
    case 401: case 403: return `${name}: chave de API inválida ou ausente.`;
    case 402: return `${name}: sem créditos de uso. Adicione créditos na conta.`;
    case 404: return `${name}: modelo não encontrado. Confira o nome do modelo.`;
    case 429: return `${name}: limite de uso atingido. Tente novamente mais tarde.`;
    case null: return `${name}: ${error.message}`;
    default: return `${name}: erro ${error.status} ao gerar a resposta.`;
  }
}

/**
 * Modelo valido para o provedor. O banco nasce com openai_model = 'gpt-4o'; trocar
 * o provedor para Groq/Ollama sem trocar o modelo fazia toda chamada falhar.
 */
export function modelForProvider(provider: AiProvider, model?: string | null) {
  const name = (model ?? "").trim();
  if (!name) return DEFAULT_AI_MODEL[provider];
  const looksOpenAi = /^(gpt-|o\d|chatgpt)/i.test(name);
  if (provider === "openai") return name.includes("/") ? DEFAULT_AI_MODEL.openai : name;
  if (looksOpenAi) return DEFAULT_AI_MODEL[provider];
  if (provider === "ollama" && name.includes("/")) return DEFAULT_AI_MODEL.ollama;
  return name;
}

/** Ha chave disponivel para o provedor? (Ollama usa a variavel de ambiente do servidor.) */
export function aiKeyAvailable(provider: AiProvider, companyKey?: string | null) {
  return provider === "ollama" ? Boolean(process.env.OLLAMA_API_KEY) : Boolean(companyKey);
}

export async function aiChat(request: {
  provider: AiProvider;
  model?: string | null;
  messages: AiMessage[];
  /** Chave da empresa (groq/openai). Ignorada no Ollama, que usa OLLAMA_API_KEY. */
  apiKey?: string | null;
  temperature?: number;
  json?: boolean;
  maxTokens?: number;
}): Promise<string> {
  const { provider, messages, temperature = 0.3, json = false, maxTokens = 1000 } = request;
  const model = modelForProvider(provider, request.model);

  if (provider === "ollama") {
    const key = process.env.OLLAMA_API_KEY;
    if (!key) throw new AiError("OLLAMA_API_KEY não configurada no servidor.", null, provider);
    const client = new Ollama({ host: "https://ollama.com", headers: { Authorization: `Bearer ${key}` } });
    const send = (modelName: string) => client.chat({
      model: modelName,
      messages,
      stream: false,
      ...(json ? { format: "json" } : {}),
      options: { temperature, num_predict: maxTokens },
    });
    const statusOf = (error: unknown) => typeof (error as { status_code?: unknown }).status_code === "number" ? (error as { status_code: number }).status_code : null;
    try {
      return (await send(model)).message.content;
    } catch (error) {
      // Modelo salvo que nao existe no Ollama: tenta o modelo padrao antes de parar a triagem.
      if (statusOf(error) === 404 && model !== DEFAULT_AI_MODEL.ollama) {
        try { return (await send(DEFAULT_AI_MODEL.ollama)).message.content; }
        catch (retry) { throw new AiError(retry instanceof Error ? retry.message : String(retry), statusOf(retry), provider); }
      }
      throw new AiError(error instanceof Error ? error.message : String(error), statusOf(error), provider);
    }
  }

  if (!request.apiKey) throw new AiError("Chave de API não configurada.", null, provider);
  const send = (modelName: string) => fetch(OPENAI_COMPATIBLE_URL[provider], {
    method: "POST",
    headers: { Authorization: `Bearer ${request.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: modelName,
      temperature,
      max_tokens: maxTokens,
      messages,
      ...(json ? { response_format: { type: "json_object" } } : {}),
      // Modelos de raciocinio (GPT OSS) gastam tokens pensando antes de
      // responder; esforco baixo deixa a resposta rapida e dentro do limite.
      ...(modelName.startsWith("openai/gpt-oss") ? { reasoning_effort: "low" } : {}),
    }),
  });
  let response: Response;
  try {
    response = await send(model);
    // O Groq tira modelos de linha (ex.: Llama 3.x): configuracoes antigas
    // passam a usar o modelo padrao atual em vez de parar a triagem.
    if (provider === "groq" && model !== DEFAULT_AI_MODEL.groq && (response.status === 404
      || (response.status === 400 && /decommission|model_not_found|does not exist/i.test(await response.clone().text())))) {
      response = await send(DEFAULT_AI_MODEL.groq);
    }
  } catch (error) {
    throw new AiError(error instanceof Error ? error.message : String(error), null, provider);
  }
  if (!response.ok) throw new AiError((await response.text()).slice(0, 500), response.status, provider);
  const data = await response.json();
  return data.choices?.[0]?.message?.content ?? "";
}
