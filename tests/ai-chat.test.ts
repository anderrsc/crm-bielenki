import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const ollamaChat = vi.fn();
const ollamaConfigs: unknown[] = [];
vi.mock('ollama', () => ({
  Ollama: class {
    constructor(config: unknown) { ollamaConfigs.push(config); }
    chat = ollamaChat;
  },
}));

import { AiError, aiChat, aiErrorMessage, aiKeyAvailable, parseAiProvider } from '@/lib/ai/chat';

const messages = [{ role: 'user' as const, content: 'Oi' }];

describe('lib/ai/chat', () => {
  beforeEach(() => { ollamaChat.mockReset(); ollamaConfigs.length = 0; vi.stubEnv('OLLAMA_API_KEY', 'chave-de-teste'); });
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

  test('Ollama Cloud: host ollama.com, chave no Authorization Bearer e modelo glm-5.3-flash', async () => {
    ollamaChat.mockResolvedValue({ message: { role: 'assistant', content: 'Funcionando' } });
    const reply = await aiChat({ provider: 'ollama', messages, json: true, temperature: 0.2, maxTokens: 50 });
    expect(reply).toBe('Funcionando');
    expect(ollamaConfigs[0]).toEqual({ host: 'https://ollama.com', headers: { Authorization: 'Bearer chave-de-teste' } });
    expect(ollamaChat).toHaveBeenCalledWith({ model: 'glm-5.3-flash', messages, stream: false, format: 'json', options: { temperature: 0.2, num_predict: 50 } });
  });

  test('Ollama sem OLLAMA_API_KEY nao chama a API', async () => {
    vi.stubEnv('OLLAMA_API_KEY', '');
    await expect(aiChat({ provider: 'ollama', messages })).rejects.toThrow(/OLLAMA_API_KEY/);
    expect(ollamaChat).not.toHaveBeenCalled();
    expect(aiKeyAvailable('ollama')).toBe(false);
  });

  test('Ollama: erros HTTP viram mensagens claras (401, 402, 404, 429)', async () => {
    for (const [status, text] of [[401, /chave/], [402, /créditos/], [404, /modelo/], [429, /limite/]] as const) {
      ollamaChat.mockRejectedValueOnce(Object.assign(new Error('erro'), { status_code: status }));
      const error = await aiChat({ provider: 'ollama', messages }).catch((e) => e);
      expect(error).toBeInstanceOf(AiError);
      expect(error.status).toBe(status);
      expect(aiErrorMessage(error)).toMatch(text);
    }
  });

  test('Groq/OpenAI continuam usando a API compativel com OpenAI e a chave da empresa', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: '{"mensagem":"ok"}' } }] }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    expect(await aiChat({ provider: 'groq', apiKey: 'gsk_x', messages, json: true })).toBe('{"mensagem":"ok"}');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.groq.com/openai/v1/chat/completions');
    expect(init.headers.Authorization).toBe('Bearer gsk_x');
    expect(JSON.parse(init.body)).toMatchObject({ model: 'openai/gpt-oss-120b', response_format: { type: 'json_object' }, reasoning_effort: 'low' });
    await expect(aiChat({ provider: 'openai', apiKey: '', messages })).rejects.toThrow(/Chave/);
  });

  test('Groq: modelo antigo fora de linha cai no modelo padrao atual', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('{"error":{"code":"model_decommissioned"}}', { status: 400 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    expect(await aiChat({ provider: 'groq', model: 'llama-3.3-70b-versatile', apiKey: 'gsk_x', messages })).toBe('ok');
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).model).toBe('openai/gpt-oss-120b');
  });

  test('provedor desconhecido cai no Ollama', () => {
    expect(parseAiProvider('xyz')).toBe('ollama');
    expect(parseAiProvider('groq')).toBe('groq');
  });
});

describe("modelForProvider", () => {
  test("troca modelo de outro provedor pelo padrao", async () => {
    const { modelForProvider, DEFAULT_AI_MODEL } = await import("@/lib/ai/chat");
    expect(modelForProvider("ollama", "gpt-4o")).toBe(DEFAULT_AI_MODEL.ollama);
    expect(modelForProvider("groq", "gpt-4o")).toBe(DEFAULT_AI_MODEL.groq);
    expect(modelForProvider("groq", "openai/gpt-oss-120b")).toBe("openai/gpt-oss-120b");
    expect(modelForProvider("openai", "openai/gpt-oss-120b")).toBe(DEFAULT_AI_MODEL.openai);
    expect(modelForProvider("openai", "gpt-4o-mini")).toBe("gpt-4o-mini");
    expect(modelForProvider("ollama", "")).toBe(DEFAULT_AI_MODEL.ollama);
  });
});
