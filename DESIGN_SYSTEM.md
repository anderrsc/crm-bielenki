# Bielenki Design System

Linguagem visual única do CRM Marquinhos Calhas e Esquadrias. Vale para celular, tablet e PC.
Complementa `docs/DESIGN-SYSTEM.md` (movimento, foco, avisos e confirmações).

## Princípios

1. **Produtividade antes de efeito.** Vidro e degradês organizam a hierarquia; nunca competem com o conteúdo.
2. **Uma família, poucos pesos.** Plus Jakarta Sans em toda a interface; pesos 400, 500, 600 e (raro) 700.
3. **Sentence case.** Só a primeira palavra em maiúscula (exceto siglas e nomes próprios).
4. **Vermelho é ação e estado ativo.** Não é decoração. Cores semânticas (sucesso, atenção, erro, informação) com moderação.
5. **Mobile primeiro.** Alvos de toque de 44 px, margens de 16 px, sem rolagem horizontal, respeito às safe areas.

## Arquivos

| Arquivo | Papel |
|---|---|
| `app/brand-tokens.css` | **Fonte dos tokens**: cores, tipografia, espaçamento, raios, vidro |
| `app/layout.tsx` | Carrega a Plus Jakarta Sans com `next/font/local` (`app/fonts/`) |
| `app/typography.css` | Regra final de família, peso, escala e números tabulares (carregado por último) |
| `app/components.css` | Componentes compartilhados (`pill-link`, `tab-pill`, ações de tabela) |
| `app/glass.css` | Vidro (liquid glass): superfícies, barras e painéis translúcidos |
| `app/home.css`, `app/mobile.css`, `app/marquinhos.css` | Layout por contexto (painel de destaque, celular, shell) |
| `components/fit-numbers.tsx` | Valores monetários nunca cortados: reduz a fonte só o necessário (mínimo 70%) |
| `tests/design-system.test.ts`, `tests/design-contrast.test.ts`, `tests/e2e/design-audit.test.mjs` | Prevenção de inconsistências |

Documentos comerciais e de impressão (`.print-sheet`, `.quote-sheet`, `.measure-sheet`, rotas `app/(print)`) mantêm Inter/Archivo
(`--font-doc-ui`, `--font-doc-display`) e os pesos próprios. Nada neles foi alterado.

## Tipografia

Família: `--font-sans` (Plus Jakarta Sans, variável 200–800, só 400–700 em uso). Números tabulares em toda a interface
(`font-variant-numeric: tabular-nums` no `body`). Valores no formato brasileiro (`money()` em `lib/utils.ts`).

| Token | Celular | PC | Peso | Line-height | Uso |
|---|---|---|---|---|---|
| `--type-metric` | 30 px | 32 px | 600 | 1,2 | Indicador principal |
| `--type-page` | 22 px | 26 px | 600 | 1,3 | Título de página (`h1`) |
| `--type-section` | 17 px | 18 px | 600 | 1,4 | Título de seção (`h2`) |
| `--type-card` | 15 px | 15 px | 600 | 1,4 | Título de card (`h3`) |
| `--type-body` | 15 px | 14 px | 400 | 1,5 | Texto principal |
| `--type-button` | 14 px | 14 px | 500 | 1,4 | Botões |
| `--type-filter` | 13 px | 13 px | 500 | 1,4 | Filtros, chips, abas |
| `--type-field` | 16 px | 14 px | 400 | 1,5 | Campos (16 px no celular evita zoom no iOS) |
| `--type-secondary` | 13 px | 13 px | 400 | 1,5 | Texto de apoio, rótulos (peso 500) |
| `--type-status` | 12 px | 12 px | 500 | 1,4 | Status |
| `--type-nav` | 11 px | 11 px | 500 | 1,4 | Navegação inferior |

**Pesos** — 400 texto; 500 botões, rótulos, filtros; 600 títulos, nomes, valores; 700 só contadores e destaques excepcionais
(`.wa-badge-count`, `.mobile-tab-badge` etc., listados em `typography.css`). Não existem 800/900.
No Tailwind, use `font-semibold` (600), `font-medium` (500) ou o padrão (400). `font-bold`, `font-extrabold` e `font-black`
**não são permitidos** em componentes de interface (o teste estático falha).

**Capitalização** — proibido `uppercase`, `capitalize` e `letter-spacing` aberto. Datas por extenso usam `sentence()` de `lib/utils.ts`.
Preservar: WhatsApp, LIA, JARVIS, CRM, ERP, CPF, CNPJ, Pix, PDF, códigos de orçamento e nomes próprios.
Dados cadastrados pelos usuários não são alterados.

**Tamanho mínimo** — 11 px. Nenhum `text-[10px]` ou menor.

## Espaçamento e forma

Escala de 4 px: `--sp-1` 4 · `--sp-2` 8 · `--sp-3` 12 · `--sp-4` 16 (padrão) · `--sp-5` 20 · `--sp-6` 24 · `--sp-8` 32.
Margem lateral no celular: `--gutter` 16 px (24 px no PC). Alvo de toque: `--tap` 44 px.
Raios: controle 12 · card 20 · painel 28 · pílula 999.

## Vidro (glassmorphism)

Vidro **branco e neutro**: preenchimento de 90% → 64% de branco, borda branca e um anel cinza de 1 px (`--glass-ring`) para dar contraste.
Sem tom de vermelho nas superfícies: o fundo da página é cinza muito claro e o único cinza do vidro é `--glass-tint` (4,5%).
O vermelho fica só em ação principal, item ativo e contadores.

Tokens em `brand-tokens.css`: `--glass-fill-strong`, `--glass-fill-soft`, `--glass-edge`, `--glass-ring`, `--glass-tint`, `--glass-blur-px` (22 px; 16 px no celular),
`--glass-saturate`, `--glass-shadow-md/sm`, `--glass-fallback`.

Onde usar: painéis de destaque (`.mh-hero`, `.shell-band`, `.module-hero`, `.detail-hero`, `.sale-hero`), barra do topo, menu lateral,
barra inferior flutuante, barras fixas de ação. **Cards e listas continuam brancos e sólidos** (leitura e desempenho).
Alternativas: sem `backdrop-filter` ou com `prefers-reduced-transparency`, os painéis ficam brancos opacos.
Evite empilhar duas camadas com desfoque.

## Componentes

| Componente | Classe/arquivo | Observação |
|---|---|---|
| Botão primário | `.button` | Vermelho `--brand-strong`; ações principais da página |
| Botão secundário | `.button-ghost` | Neutro |
| Ação dentro de tabela | `.app-content table .button` | Aparece como secundário, para o vermelho não se repetir por linha |
| Pílula de navegação | `.pill-link` / `.pill-row` | Atalhos secundários (rolagem lateral no celular) |
| Aba/filtro | `.tab-pill` (`aria-current="page"`) | Selecionada em vermelho |
| Painel de destaque | `.mh-hero` (+ `.is-simple`) | Título, valor principal e ações |
| Faixa de título | `.shell-band` (automática no `AppShell`) | Telas sem painel próprio; o `h1` fica só para leitores de tela |
| Cabeçalho de lista | `ModuleTable` | Painel com ícone, contagem e ação de criar |
| Detalhe | `DetailPage`, `SaleDetail` | Painel + grade de dados |
| Filtros recolhíveis | `MobileCollapse` | Botão no celular; sempre visível no PC |
| Status | `StatusBadge` | Cor + texto (nunca só cor) |
| Valor monetário | `.num`, `data-fit` | Tabular; `FitNumbers` evita corte |
| Detalhe do orçamento | `.quote-hero` + `.quote-actions` | Painel com número, cliente e status; ações em linha rolável no celular |
| Cartão de ação com texto | `.wvetro-card` | Texto em largura inteira; botão abaixo no celular |
| Configurações recolhíveis | `.ai-config` (`<details>`) | Operação primeiro; configurações críticas ficam recolhidas (Central de IA) |
| Faixa de título dos editores | `AppShell` (`bandSub`) | `/orcamentos/calhas`, `/orcamentos/esquadrias`, `/novo`, `/nova`, `/editar` |

## Contraste

Mínimo WCAG AA (4,5:1). Pares de tokens verificados em `tests/design-contrast.test.ts`. Botões vermelhos usam
`#E31616 → #D90E0E` (4,8 a 5,2:1 com texto branco). Verde do WhatsApp `#008069` (4,9:1).

## Como criar uma tela nova

1. Use `ModuleTable`/`DetailPage` ou `.mh-hero` para o cabeçalho; não crie `h1` com tamanho próprio.
2. Use `font-semibold`/`font-medium`; tamanhos pelos tokens (`text-sm`, `text-xs` ou `var(--type-*)`).
3. Rótulos em Sentence case, sem `uppercase`.
4. Botão principal único por tela; secundários como `.button-ghost` ou `.pill-link`.
5. Rode `npx vitest run tests/design-system.test.ts` e `node --test tests/e2e/design-audit.test.mjs`.
