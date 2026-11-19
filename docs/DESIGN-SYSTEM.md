# Design System Bielenki — movimento, foco e retorno visual

Base: tokens em `app/brand-tokens.css`, componentes em `app/marquinhos.css` e `components/ui-feedback/`.
Ícones: somente **Lucide** (`lucide-react`), traço padrão. Sem emojis, gradientes ou brilhos decorativos.

## Movimento
| Token | Valor | Uso |
|---|---|---|
| `--dur-press` | 120 ms | clique em botão (`scale(.98)`) |
| `--dur-pop` | 160 ms | avisos, menus, tooltips (`.ui-pop-in`) |
| `--dur-panel` | 220 ms | diálogos e painéis (`.ui-fade-in`) |
| `--ease-out` | `cubic-bezier(.2,.8,.2,1)` | todas as transições; sem overshoot |

- Animar só `opacity`/`transform`. Nada de animação contínua (exceto indicador de carregamento real).
- `prefers-reduced-motion: reduce` desliga animações e transições; spinners continuam, mais lentos.

## Foco
- Anel visível só para teclado (`:focus-visible`), token `--focus-ring`. Campos mantêm o realce próprio.

## Retorno ao usuário
- **Aviso** (`toast.success/error` de `components/ui-feedback/toast`): só depois da resposta do servidor.
  Formulários que voltam com `?salvo=1`, `?criado=1` ou `?ok=<texto>` mostram o aviso sozinhos.
- **Confirmação** (`confirmAction({ message, confirmLabel })` de `components/ui-feedback/confirm`):
  substitui `window.confirm`. Foco começa em "Voltar"; Esc cancela. `ConfirmButton` já usa.
- **Carregamento**: `app/(crm)/loading.tsx` mostra esqueleto no formato da tela (Atendimento, painéis, listas)
  apenas enquanto o servidor responde.

## Não fazer
- Não animar números financeiros nem simular sucesso antes do backend.
- Não adicionar outra biblioteca de animação (a `framer-motion` foi removida por não ter uso).
