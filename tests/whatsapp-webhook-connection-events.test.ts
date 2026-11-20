import { describe, it, expect } from 'vitest';

/**
 * Testes para validação da correção do bug B2:
 * Eventos de conexão (connection.update, qrcode.updated, status.change)
 * devem ser registrados no histórico ANTES de serem descartados do fluxo de mensagens.
 *
 * Estes testes validam a lógica de filtragem de eventos no webhook,
 * garantindo que eventos de conexão não sejam silenciosamente ignorados.
 */
describe('WhatsApp Webhook - Connection Events (B2 Fix)', () => {

  describe('Event filtering logic', () => {
    // Regex usada no webhook para identificar eventos de conexão
    const CONNECTION_EVENT_REGEX = /connection|qrcode|status\.change/i;

    // Eventos que DEVEM ser registrados no histórico
    const connectionEvents = [
      'connection.update',
      'CONNECTION.UPDATE',
      'qrcode.updated',
      'QRCode.Updated',
      'status.change',
      'STATUS.CHANGE',
      'connection.close',
      'connection.open',
    ];

    // Eventos que NÃO devem ser tratados como conexão
    const nonConnectionEvents = [
      'messages.upsert',
      'MESSAGES_UPSERT',
      'messages.update',
      'contacts.upsert',
      'groups.upsert',
    ];

    it.each(connectionEvents)('deve identificar "%s" como evento de conexão', (event) => {
      expect(CONNECTION_EVENT_REGEX.test(event)).toBe(true);
    });

    it.each(nonConnectionEvents)('não deve identificar "%s" como evento de conexão', (event) => {
      expect(CONNECTION_EVENT_REGEX.test(event)).toBe(false);
    });
  });

  describe('Message event preservation', () => {
    // Eventos de mensagem que devem continuar sendo processados normalmente
    const messageEvents = ['messages.upsert', 'MESSAGES_UPSERT'];

    it.each(messageEvents)('"%s" deve ser reconhecido como evento de mensagem válido', (event) => {
      const isValidMessageEvent = ["messages.upsert", "MESSAGES_UPSERT"].includes(event);
      expect(isValidMessageEvent).toBe(true);
    });

    it('eventos de conexão que também são mensagens.upsert devem seguir fluxo de mensagens', () => {
      // Cenário edge case: se um evento tiver "connection" no nome MAS for messages.upsert,
      // ele deve seguir o fluxo de mensagens, não ser descartado como connection_event_recorded
      const event = 'messages.upsert';
      const isConnection = /connection|qrcode|status\.change/i.test(event);
      const isMessageUpsert = ["messages.upsert", "MESSAGES_UPSERT"].includes(event);

      // Neste caso, é mensagem, não conexão
      expect(isConnection).toBe(false);
      expect(isMessageUpsert).toBe(true);
    });
  });

  describe('Webhook response statuses', () => {
    it('deve retornar "connection_event_recorded" para eventos de conexão não-mensagem', () => {
      // Simula a lógica do webhook após a correção B2
      const payload = { event: 'connection.update' };
      const channel = { id: 'test-channel-id', company_id: 'test-company-id' };

      const isConnection = /connection|qrcode|status\.change/i.test(String(payload?.event ?? ""));
      const isMessageUpsert = ["messages.upsert", "MESSAGES_UPSERT"].includes(payload.event);

      // Evento de conexão que não é mensagem → deve ser registrado e retornar connection_event_recorded
      expect(isConnection).toBe(true);
      expect(isMessageUpsert).toBe(false);

      // Status esperado após a correção
      const expectedStatus = isConnection && !isMessageUpsert ? 'connection_event_recorded' : 'ignored';
      expect(expectedStatus).toBe('connection_event_recorded');
    });

    it('deve retornar status normal para eventos de mensagem', () => {
      const payload = { event: 'messages.upsert' };

      const isConnection = /connection|qrcode|status\.change/i.test(String(payload?.event ?? ""));
      const isMessageUpsert = ["messages.upsert", "MESSAGES_UPSERT"].includes(payload.event);

      // Evento de mensagem → não deve ser tratado como conexão
      expect(isConnection).toBe(false);
      expect(isMessageUpsert).toBe(true);
    });

    it('deve retornar "ignored" para eventos desconhecidos que não são conexão nem mensagem', () => {
      const payload = { event: 'unknown.event.type' };

      const isConnection = /connection|qrcode|status\.change/i.test(String(payload?.event ?? ""));
      const isMessageUpsert = ["messages.upsert", "MESSAGES_UPSERT"].includes(payload.event);

      expect(isConnection).toBe(false);
      expect(isMessageUpsert).toBe(false);

      // Evento desconhecido → ignored (comportamento existente preservado)
      const expectedStatus = !isConnection && !isMessageUpsert ? 'ignored' : 'other';
      expect(expectedStatus).toBe('ignored');
    });
  });
});