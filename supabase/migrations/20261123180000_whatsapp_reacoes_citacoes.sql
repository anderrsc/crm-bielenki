-- WhatsApp — auditoria de 23/11/2026, etapa D. Aditiva e pode ser rodada mais de uma vez.
-- Reações (👍 do cliente ou da equipe pelo celular) aparecem na mensagem reagida, e mensagens
-- que respondem citando outra mostram o trecho citado (antes as reações eram descartadas e a
-- citação se perdia).
alter table public.messages add column if not exists reaction_customer text;
alter table public.messages add column if not exists reaction_team text;
alter table public.messages add column if not exists quoted_external_id text;
alter table public.messages add column if not exists quoted_preview text;

comment on column public.messages.reaction_customer is 'Reação do cliente a esta mensagem (emoji). Vazio = sem reação ou removida.';
comment on column public.messages.reaction_team is 'Reação da empresa (pelo celular/WhatsApp Web) a esta mensagem.';
comment on column public.messages.quoted_external_id is 'Id no WhatsApp da mensagem que esta responde (citação).';
comment on column public.messages.quoted_preview is 'Trecho da mensagem citada (até 160 caracteres).';

-- Envio pelo CRM: vídeo (MP4) e documentos de obra (Word, Excel, DWG), até 16 MB (limite de
-- vídeo do WhatsApp). O conteúdo de cada arquivo é conferido no servidor antes de enviar.
update storage.buckets set file_size_limit = 16777216, allowed_mime_types = array[
  'application/pdf','image/jpeg','image/png','image/webp',
  'audio/ogg','audio/mpeg','audio/mp4','audio/aac','audio/wav','audio/webm',
  'video/mp4',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/msword',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','application/vnd.ms-excel',
  'image/vnd.dwg'
] where id = 'atendimento-files';
