# Auditoria UX / Mobile / WhatsApp — Gate A (24/11/2026)

Escopo: inventário, diagnóstico e plano. **Nenhum código de aplicação foi alterado.** Só este arquivo foi criado.
Código auditado: branch `claude/new-session-oh8cvr`, base `86c63cd`.
Fonte dos requisitos: pacote `CRM_Bielenki_Pacote_UX_Mobile_WhatsApp` (prompt master, guia visual, fluxos, matriz de aceite).

Marcas: **[código]** lido no código (arquivo:linha) · **[executado]** rodado nesta sessão · **[mockup]** visto nas imagens do pacote · **[hipótese]** não verificado.

---

## 1. O que foi realmente inspecionado

| Item | Resultado |
|---|---|
| Stack [código `package.json`] | Next.js 15.5.28 (App Router, Server Actions), React 19.0.0, TypeScript 5.8, Tailwind 3.4, Radix (dialog, dropdown), lucide-react, recharts, Supabase (`ssr` 0.12, `supabase-js` 2.49), zod 4.6.7, Vitest 5, Playwright 1.64 |
| Tamanho [código] | ~300 arquivos em `app/`, `components/`, `lib/`; 135 arquivos de teste unitário; 15 suítes E2E em `tests/e2e/` |
| `npm run typecheck` [executado] | **passou**, 20 s |
| `vitest run` [executado] | **135 arquivos, 890 testes, todos passaram**, 115 s |
| Lint, build, E2E (Puppeteer/Playwright), smoke [não executado] | Exigem Postgres/PostgREST e variáveis que não existem aqui. O CI (`.github/workflows/ci.yml`, `e2e.yml`) os executa; nenhum resultado foi verificado nesta sessão |
| Evolution API [código] | `lib/whatsapp/evolution.ts:5` fixa a imagem `v2.3.7`; `docs/AUDITORIA-WHATSAPP-2026-11-23.md` também cita v2.3.7. **A versão realmente em execução no servidor de produção não foi confirmada** |
| Telas reais renderizadas | **Nenhuma.** Não há login, banco nem servidor Evolution nesta sessão. Todas as observações visuais abaixo vêm de CSS/JSX, não de screenshots |
| Pacote de referência | Li prompt, especificações, checklists e as imagens 01, 04, 05 e o frame 06. Imagens 02 e 03 e o vídeo `07_*.mp4` **não foram revistos** |

Documentos existentes que já cobrem partes do escopo e foram reaproveitados, não refeitos: `docs/DESIGN-SYSTEM.md`, `docs/GUIA_UX_STATUS.md`, `docs/AUDITORIA-WHATSAPP-2026-11-23.md`, `docs/MATRIZ_RBAC.md`, `CONTEXTO_COMPLETO_PROJETO.md`, `CONTINUIDADE.md`.

---

## 2. Mockups x design real (a divergência mais importante)

| Aspecto | Mockups do pacote | CRM real [código] | Consequência |
|---|---|---|---|
| Cor de marca | Verde (logo "B", botões, selo de não lidas) | **Vermelho Marquinhos** `--red-500: #F61111` (`app/brand-tokens.css`) | Não adotar o verde. O pacote já diz que a identidade do repositório prevalece |
| Nome | "CRM Bielenki" | Interface diz "Marquinhos Calhas e Esquadrias" (`app/layout.tsx:10`); `app/manifest.ts:3` ainda diz "CRM Bielenki" | Nome inconsistente entre manifest (PWA instalado) e app |
| Tema | Mockups escuros (01–04) e claro (05) | `app/layout.tsx:12` fixa `data-theme="light"` e `color-scheme: light`. Não encontrei componente que alterne o tema; `.theme-toggle` existe só no CSS (`app/mobile.css:10`). Os tokens escuros existem (`brand-tokens.css`) | O tema escuro dos mockups hoje não é alcançável pelo usuário. Exige decisão (§8) |
| Cor do PWA | — | `manifest.ts`: `theme_color: '#234d3c'` (verde escuro) e `background_color: '#111111'` | Barra do sistema no celular instalado fica verde, fora da identidade vermelha |
| Navegação inferior | Início · **WhatsApp** · Agenda · Orçamentos · Mais | Início · Clientes · **+ Orçamento** · Agenda · Menu (`components/app-shell.tsx:96-102`). Atendimento/WhatsApp **não está** na barra | O módulo mais usado do dia (Atendimento) exige abrir o menu lateral no celular |
| Inbox WhatsApp | Chips (Todas/Não lidas/Atendimento), seletor de número como cartões, filtro em sheet | 3–4 `<select>` + 6 chips + busca, tudo empilhado no topo da lista (`components/atendimento-page.tsx:~300-330`) | Ocupa boa parte da altura de 390 px antes da primeira conversa |
| WhatsApp cores | Verde WhatsApp | Também verde: variáveis `--wa-*` fixas em `app/globals.css:514-522` (`#00a884`, `#005c4b`…) | Já existe divergência interna: um módulo com paleta própria fora dos tokens. Decidir se mantém (§8) |
| Painel do cliente | Lateral com ações Orçamento/Agenda/Pedido/Financeiro e abas | Existe painel de contexto (`atendimento-page.tsx` ~linha 640+, `showPanel`) | Reaproveitar, não recriar. Comparar ações e abas no PR do WhatsApp |
| Fotos/avatares | Fotos de pessoas | Mockup ilustrativo | Usar foto só se a Evolution entregar e houver base legal; fallback de iniciais |
| Vídeo de referência (frame 06) | "Dashboard V29" genérico, código com `glass-card`, `gradient`, `framer-motion` | — | O frame mostra os antipadrões que o próprio guia proíbe (glass, gradiente). Usar apenas a ideia de sidebar compacta de ícones e busca no topo |

Sobre "menos cara de IA": o CSS mobile atual já usa vários efeitos que o guia lista como antipadrão [código `app/mobile.css`]:
`backdrop-filter: blur` na barra superior (`mobile.css:6`), na barra inferior (`:32`) e no overlay de sheets (`:159`); barra inferior flutuante com `border-radius: 25px` e sombra; botão central elevado (`margin: -17px`) com `box-shadow` de brilho (`--brand-glow`, `marquinhos.css:79`); raio de 21–27 px em cards e sheets; `--brand-gradient` definido nos tokens. O `--brand-gradient` é usado em `marquinhos.css:100,108` (KPI destacado e barra do gráfico).

---

## 3. Tokens e componentes atuais (resumo)

[código `app/brand-tokens.css`, `tailwind.config.ts`, `app/marquinhos.css`]

- Fontes: Archivo (display) + Inter (UI). Escala 12–48 px. Raios 10/16/22/pill. Movimento 120–220 ms. Foco `--focus-ring`.
- Cores semânticas com pares `*-soft`/`*-text` para claro e escuro.
- Tailwind mapeia nomes legados para tokens (`ink`, `cream`, `forest`, `lime`, `sand`, `surface`). **Os nomes enganam**: `lime` = vermelho da marca, `forest` = texto de marca. Risco de confusão para quem for implementar.
- Breakpoint mobile único: `max-width: 767px` (`mobile.css:3`), mais `md`/`lg`/`xl` do Tailwind. Não há tratamento específico para 320 px.
- Componentes reutilizáveis já existentes: `AppShell`, `Breadcrumbs`, `CommandPalette`, `StatusBadge`, `ModuleTable` (com `mobile-record-table`, que vira cards por CSS), `LiveSearchForm`, `SavedViews`, `UnsavedGuard`, `ConfirmHost`/`Toaster`, `NotificationCenter`, `MobileAgenda`, `QuickCreateMenu`, `FormMemory`.
- **Não existem** como componentes: `FilterSheet`, `EmptyState`/`ErrorState`/`Skeleton` genéricos (há `loading.tsx` e `error.tsx` de rota), `DetailDrawer`, `ActionBar`, `AttachmentPreview`/`MediaViewer` unificado (há `inbox-attachments.tsx`, `quote-attachments.tsx` separados). A lista do pacote (§4) fica **parcialmente atendida**.

---

## 4. Problemas observados (P0–P3)

Só entram itens com evidência em código. Itens de hipótese ficam na seção 5.

| # | Pri. | Problema | Evidência | Risco | Solução proposta | Esforço | Teste de aceite |
|---|---|---|---|---|---|---|---|
| U1 | P1 | Atendimento fora da barra inferior no celular | `app-shell.tsx:96-102` | Atendimento exige abrir menu lateral; não há contador de não lidas na barra | Trocar "Clientes" por "Atendimento" (com selo de não lidas), respeitando RBAC; Clientes vai para "Mais" | P | E2E mobile: barra mostra Atendimento só para quem tem permissão; selo some em 0 |
| U2 | P1 | Rótulos de 8–10 px na barra e em badges | `marquinhos.css:78` e `mobile.css:33` (9 px na barra), `mobile.css:37` (8 px no botão central), `.status-badge` 10 px, 40 usos de `text-[9px]/[10px]` em `components/` | Legibilidade e WCAG 1.4.4 com zoom de texto | Piso de 11–12 px nos rótulos; manter ícone + texto | P | Teste visual em 320/360 com zoom 200 %: sem truncar/sobrepor |
| U3 | P1 | Filtros do inbox consomem a altura no celular | `atendimento-page.tsx` cabeçalho da lista: busca + 3–4 selects + 6 chips | Lista de conversas começa abaixo da dobra em 390×844 com barra inferior | Chips de status + botão de filtro abrindo `FilterSheet` com os selects; persistir filtros | M | Primeira conversa visível sem rolar em 390×844; filtros preservados ao voltar do chat |
| U4 | P1 | Paleta do WhatsApp hardcoded fora dos tokens | `globals.css:514-522` | Viola "tokens sem hardcode"; dois temas paralelos para manter | Mapear `--wa-*` para tokens (mantendo verde só onde significar "WhatsApp"/enviado, se aprovado) | P | Teste de snapshot de variáveis CSS; contraste ≥ 4.5:1 nos balões |
| U5 | P2 | Tema escuro inalcançável | `layout.tsx:12`; nenhum componente de alternância | Mockups escuros não são viáveis sem isso; `.theme-toggle` sem componente correspondente | Decidir (§8). Se aprovado: toggle + persistência + `prefers-color-scheme` | M | Troca de tema persiste; sem flash no carregamento |
| U6 | P2 | `manifest.ts` fora da identidade | `manifest.ts:3` (`theme_color #234d3c`, nome "CRM Bielenki") | PWA instalado com cor/nome divergentes | Alinhar nome e `theme_color` aos tokens | P | Lighthouse PWA / inspeção do manifest |
| U7 | P2 | Efeitos que o guia classifica como antipadrão | `mobile.css:6,32,159` (blur), `marquinhos.css:79` (brilho), raios 21–27 px em cards e sheets | Aparência "genérica" que o usuário quer evitar | Remover blur/brilho, reduzir raios para 12–16 px, borda 1 px, sombra só em overlays | M | Revisão visual lado a lado com mockup 05 |
| U8 | P2 | `atendimento-page.tsx` com 939 linhas | arquivo | Qualquer mudança de UI do WhatsApp tem alto risco de regressão | Extrair `ConversationList`, `ChatPane`, `Composer`, `ContextPanel` **antes** de redesenhar, com testes existentes (`atendimento-page.test.tsx`) rodando a cada passo | G | Testes atuais passam inalterados após cada extração |
| U9 | P2 | Lista de conversas sem virtualização | `grep virtual` sem resultado em `atendimento-page.tsx` | Milhares de conversas/mensagens (edge case do pacote) | Medir primeiro; paginar/virtualizar só se o profiling justificar | M | Abertura de chat e rolagem com ≥ 2 000 mensagens dentro de meta definida após baseline |
| U10 | P2 | Altura do inbox calculada com constantes mágicas | `atendimento-page.tsx:284` `h-[calc(100dvh-11.5rem)]`, `mobile.css:92` `calc(100dvh - 190px …)` | Duas fontes de verdade; teclado virtual e barras podem cortar o composer [hipótese, precisa teste em iOS] | Layout flex com `dvh` + `env(safe-area-inset-*)`; testar `visualViewport` | M | Teste manual iOS Safari/Android Chrome com teclado aberto: composer visível |
| U11 | P3 | Dois breakpoints mobile diferentes | `mobile.css` (767 px) x Tailwind `md` (768 px) x `lg` | Faixa de 768–1023 px pode ter layout inconsistente | Documentar e testar 768/1024 | P | Matriz de responsividade |
| U12 | P3 | Nomes de cor Tailwind enganosos (`lime`, `forest`) | `tailwind.config.ts` | Erro de manutenção | Aliases semânticos novos (`brand`, `brand-text`) e migração gradual | P | Lint/grep sem novos usos de nomes legados |

Esforço: P ≤ 0,5 dia · M 1–2 dias · G > 2 dias (estimativa, não medida).

---

## 5. WhatsApp / Evolution API — diagnóstico e incertezas

**Já existe e foi lido no código** (não foi reimplementado):
- Webhook com segredo por canal e comparação em tempo constante (`app/api/whatsapp/webhook/route.ts:141-164, 240-253`).
- Idempotência por evento com chave `[canal, eventId]` (`lib/whatsapp/message-scope.ts:13`; tabela `whatsapp_webhook_events`, `route.ts:464-468`).
- Isolamento por canal: `scopeMessages` impede busca por ID externo cruzar números (`message-scope.ts:8-12`).
- Vigia de conexão, reconciliação por `findMessages` a cada 1 min, painel de saúde, seleção de número, etiquetas, transferência, notas (`docs/AUDITORIA-WHATSAPP-2026-11-23.md`, §1.1).
- Testes específicos: `whatsapp-dedupe-db`, `whatsapp-channels-db`, `evolution*`, `inbox-safety`, `webhook`, `whatsapp-attachments`, `whatsapp-disconnection-alerts` etc. Todos passaram nesta sessão.

**Já corrigido pela auditoria de 23/11** (não reabrir): P1–P13 (mídia do 2º número, não lidas de mensagens atrasadas, destino `@lid`, reações, citações, vídeo/Word/Excel/DWG). Esta auditoria não verificou se cada correção está ativa em produção.

**Em aberto segundo o próprio documento de 23/11:**
1. Validação real com celular (colunas "R" da seção 7 daquele documento).
2. Edição e exclusão de mensagens: o conteúdo chega cifrado (`secretEncryptedMessage`); limitação da Evolution/WhatsApp, não da UI.
3. Webhook da Evolution não é reconferido após a conexão (linha 101 do documento).
4. Eventos `SEND_MESSAGE`, `MESSAGES_DELETE`, `QRCODE_UPDATED` fora da assinatura (hipótese a validar no servidor).

**Perguntas que continuam sem resposta** (preciso de acesso ou de você):
- Versão realmente instalada na Hospede Aqui (o código recomenda v2.3.7; 2.4.x exige licença).
- Se a UI marca "enviado/lido" só após confirmação do backend. O documento de 23/11 diz que há estado "enviando" e "desconhecido", mas não revisei cada ponto da UI contra o critério do pacote.
- Latência real de abertura de chat e volume de mensagens por conversa em produção.

**Regra para a fase WhatsApp (Gate D):** o redesign é só de apresentação (lista → chat → detalhes em telas separadas no celular). Nenhuma mudança em `lib/whatsapp/*`, no webhook ou nas actions sem teste novo e aprovação separada.

---

## 6. Roadmap de PRs pequenos

| PR | Conteúdo | Depende de | Risco | Critério de aceite |
|---|---|---|---|---|
| 0 | Esta auditoria + `PLANO_IMPLEMENTACAO` | — | nenhum (só docs) | Revisão sua |
| 1 | Fundação visual: pisos de fonte (U2), remoção de blur/brilho/raios excessivos (U7), `manifest` (U6), aliases de token (U12) | Aprovação §8-1,2 | Baixo (CSS) | 890 testes passam; screenshots 320/390/768 antes/depois; sem overflow horizontal |
| 2 | Navegação mobile: Atendimento na barra com selo (U1), "Mais" | PR 1 | Médio (RBAC na barra) | E2E por cargo; `moduleAccess` reaproveitado |
| 3 | Componentes: `FilterSheet`, `EmptyState`, `ErrorState`, `Skeleton`, `ActionBar` | PR 1 | Baixo | Testes de componente + a11y (foco, `Esc`, rótulos) |
| 4 | Atendimento: extração de componentes (U8) **sem mudar visual** | — | Médio | Testes atuais inalterados |
| 5 | Atendimento mobile: filtros em sheet (U3), `--wa-*` em tokens (U4), composer/teclado (U10) | PR 3, 4 | Médio | Matriz de aceite WhatsApp; teste manual iOS/Android |
| 6 | Dashboard e Agenda: ajustes sobre componentes existentes | PR 1, 3 | Baixo | Dados por perfil inalterados (`role-dashboards.test.ts`) |
| 7 | Orçamentos (crítico): só layout; fórmulas intocadas | PR 1, 3 | **Alto** | `quote-*`/`gutter-quote-pricing` + `print-a4` E2E + comparação de PDF A4 antes/depois |
| 8 | Financeiro, Pedidos, Produção: listas em cards via `ModuleTable` | PR 3 | Médio | RBAC e totais inalterados |
| 9 | Desempenho: baseline LCP/INP/CLS e bundle; otimizações sustentadas por medição (U9) | PR 5 | Baixo | Antes/depois documentado |
| 10 | Tema escuro (U5), se aprovado | PR 1 | Médio | Contraste nos dois temas |

Cada PR: branch própria, sem deploy, sem migration, sem alterar `supabase/`.

---

## 7. Testes e evidências disponíveis

| Tipo | Disponível | Estado nesta sessão |
|---|---|---|
| Tipos | `npm run typecheck` | passou |
| Unitário/UI/banco (PGlite) | 135 arquivos | 890 passaram |
| Lint | `npm run lint` | não executado |
| Build | `npm run build` | não executado (roda no CI) |
| E2E Puppeteer/Playwright | `tests/e2e/*` (inclui `mobile.test.mjs`, `print-a4.test.mjs`, `quote-flow.test.mjs`), projeto Playwright `iPhone 13` | não executado: exige backend de teste e Chromium configurado |
| Regressão de orçamento/A4 | `gutter-quote-pricing`, `quote-*`, `print-a4` | unitários passaram; E2E não executado |
| Screenshots antes/depois | **não existem** | precisam ser capturados com dados sintéticos (`tests/e2e/fake-supabase.mjs`) antes do PR 1 |
| Desempenho (LCP/INP/CLS, bundle) | **sem baseline** | a medir no PR 9; sem número inventado |
| Dispositivos reais (iOS/Android) | não disponíveis aqui | precisam do seu celular |

Matriz de aceite do pacote (`04_CHECKLISTS/MATRIZ_DE_ACEITE.md`): **todas as linhas continuam PENDENTE**. Nenhuma foi marcada como passou.

---

## 8. Decisões que preciso de você

1. **Cor**: confirmar que o vermelho Marquinhos permanece e o verde dos mockups vira só referência de layout (recomendado). E se o verde fica apenas nos elementos "WhatsApp" (balão enviado, selo de não lidas) ou se tudo no módulo vira vermelho/neutro.
2. **Tema**: manter claro fixo (como hoje) ou liberar o escuro dos mockups 01–04 (PR 10)?
3. **Barra inferior**: trocar "Clientes" por "Atendimento" (com selo) e mover Clientes para "Mais"? O botão central "+ Orçamento" fica como está?
4. **Nome**: padronizar tudo como "Marquinhos" ou manter "CRM Bielenki" no PWA?
5. **Evolution**: posso receber a versão em produção e o resultado de `GET /` do servidor (sem chave) para fechar a auditoria técnica? Sem isso a seção 5 fica com incertezas.
6. **Ordem**: começar pelo PR 1 (fundação, só CSS) ou pelo WhatsApp (PR 4–5), que é o que mais incomoda no dia a dia?
7. **Ambiente de teste**: há credencial de teste/staging para capturar screenshots autenticados? Sem isso uso só dados sintéticos.

Nada será implementado antes da sua resposta.
