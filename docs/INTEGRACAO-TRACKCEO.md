# TrackCEO no CRM — 24/11/2026

Modelo aprovado pelo dono: conexão protegida, vínculo dos rastreadores à frota e mapa da última localização. Começa desligado e sem credenciais. Dados reais entram somente depois de um gerente conectar a conta.

## Uso

1. **Operação → Equipes e veículos → Mapa dos veículos** (`/equipes/rastreamento`).
2. Informar conta e senha do TrackCEO no campo protegido e clicar em **Conectar e consultar veículos**.
3. Selecionar o veículo do CRM para cada rastreador ou usar **Cadastrar como veículo e vincular**. Nome e placa vêm do provedor; placa ausente continua vazia para conferência no cadastro.
4. Usar **Atualizar localização** para consultar novamente. Não há consultas automáticas em segundo plano. O mapa mostra rastreadores disponíveis, com GPS válido e vinculados à frota.
5. **Desconectar do CRM** desliga as consultas e esconde as posições, preservando veículos, registros e auditoria. Nova conexão pede a senha novamente.

A tela informa os horários de Brasília do GPS e da última consulta. Posições com mais de 15 minutos são identificadas como antigas. Online/offline vem do provedor e não garante GPS recente. Equipe e motorista do dia reutilizam `work_days`.

## API e proteção

- [Documentação oficial](https://gps.trackceo.com/api.jsp). Origem fixa `https://api.trackceo.com`; somente GET `/api/authorization`, `/api/device/list` e `/api/track`. Sem comandos, bloqueio, cercas, mensagens ou alteração de dispositivos.
- Assinatura documentada `md5(md5(password) + time)`. Token compartilhado e criptografado no banco; renovação sob trava por empresa, com uma tentativa adicional apenas se o token salvo for recusado.
- Limite de uma consulta por empresa a cada 30 segundos, 100 IMEIs por lote e 500 dispositivos. Timeout, limite de resposta, rejeição de redirecionamentos e mensagens de erro permitidas, sem ecoar conteúdo do fornecedor.
- Reutiliza `public.integrations` sem credenciais em `config`; a linha TrackCEO não aceita acesso direto dos usuários. Credenciais AES-256-GCM em `crm_private.trackceo_connections`, sem acesso direto de `anon`, `authenticated` ou `service_role`; somente RPC restrito ao backend.
- `public.trackceo_devices` guarda identificação e última posição, com RLS por empresa, administrador/gerente ativo e versão da conexão. Funcionários operacionais não recebem GPS, mesmo participando de uma equipe.
- POST confere sessão, gerência e origem; o `company_id` vem da sessão, não do formulário. Retorno 303 mantém a lista no celular. Senha e token nunca voltam em HTML, URLs do CRM ou auditoria.
- Conexão alterada/desligada invalida consultas em voo; troca de conta oculta dados antigos. Resposta atrasada não substitui GPS mais recente. Erro preserva a última posição. Vínculos são únicos por veículo, validados por empresa e auditados; cadastrar novamente o mesmo rastreador não duplica a frota.

Mapa com Leaflet 1.9.4 e OpenStreetMap, atribuição visível e cache normal. A lista mantém os horários e link da localização se o mapa base estiver indisponível. Histórico de trajetos fica fora desta versão.

## Entrega e testes

Migração aditiva e reaplicável `20261124162014_trackceo_localizacao_veiculos.sql`. Aplicar pelo workflow `aplicar-migrations.yml`, SHA completo e `desde=20261124162014`, antes do merge. Verificação de produção regenerada com `DATABASE_URL=... node tests/db/generate-prod-check.mjs` em PostgreSQL isolado.

Testes `trackceo`, `trackceo-db`, `trackceo-service`, `trackceo-route` e `trackceo-view`: assinatura oficial, lotes, token, falhas sem segredos, criptografia, cargos/empresas, vínculos e migração reaplicável. E2E `trackceo` em 375 px cobre conectar, cadastrar/vincular, mapa, atualizar com token reaproveitado e desconectar preservando dados.

Testes usam empresa/usuários fictícios e servidor local obrigatório; o navegador não recebe token nem chama diretamente a API TrackCEO. Tiles também são substituídos. O desvio de API exige simultaneamente `CRM_E2E_TEST_MODE=1`, Supabase fictício `http://localhost:54321` e `TRACKCEO_TEST_API_ORIGIN=http://127.0.0.1:54323`. URL arbitrária é ignorada. Não configurar essas variáveis em produção.

A validação real depende do dono conectar a conta na tela protegida após publicar. A sessão do portal TrackCEO não foi copiada nem reutilizada como credencial permanente.

## Diagnóstico de recusa

A tela informa o código oficial e a etapa da falha, usando somente textos locais: 10007 = permissão negada, 10013 = rastreador não autorizado, 10016 = conta bloqueada, 20089 = rastreador bloqueado. O código 10007 sozinho não confirma bloqueio da API ou restrição por IP. A mensagem recebida do fornecedor nunca é mostrada. Sem novas tabelas ou permissões.

Após o primeiro acesso recusado em 24/11, é necessário repetir a conexão na tela protegida: a tentativa antiga guardou apenas a categoria do erro, sem credenciais ou código original. O portal continua acessível, mas isso não identifica a causa da recusa na API. Não reutilizar tokens da sessão web nem mudar para endpoints internos como alternativa à autorização oficial.
