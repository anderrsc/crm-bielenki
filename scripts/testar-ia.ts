// Envia uma mensagem de teste pela mesma funcao que o CRM usa (lib/ai/chat.ts).
// Uso: node --env-file-if-exists=.env.local scripts/testar-ia.ts [provedor] [modelo]
// Provedor padrao: ollama (chave em OLLAMA_API_KEY). Nunca imprime a chave.
import { aiChat, aiErrorMessage, parseAiProvider } from "../lib/ai/chat.ts";

const provider = parseAiProvider(process.argv[2] ?? "ollama");
const model = process.argv[3];
try {
  const reply = await aiChat({
    provider,
    model,
    messages: [{ role: "user", content: "Teste de conexão do CRM. Responda em uma frase curta, em português, confirmando que está funcionando." }],
    maxTokens: 200,
  });
  console.log(`Resposta de ${provider} (${model ?? "modelo padrao"}):\n${reply}`);
} catch (error) {
  console.error(aiErrorMessage(error));
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
