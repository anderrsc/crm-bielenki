// @vitest-environment jsdom
import { afterEach, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const actions = vi.hoisted(() => ({
  loadInbox: vi.fn(async () => ({ items: [], companyId: undefined, aiActive: false })),
  loadConversation: vi.fn(),
  loadOlderMessages: vi.fn(),
  setConversationArchived: vi.fn(async () => ({ ok: true })),
  markInboxRead: vi.fn(async () => ({ ok: true, cleared: true })),
  syncInboxContacts: vi.fn(async () => ({})),
  markConversationRead: vi.fn(async () => ({ ok: true })),
  markConversationUnread: vi.fn(async () => ({ ok: true })),
}));
vi.mock('@/app/(crm)/atendimento-actions', () => ({
  ...actions,
  closeQuoteFromInbox: vi.fn(), createClientFromConversation: vi.fn(), linkConversationClient: vi.fn(),
  markInboxRead: actions.markInboxRead, syncInboxContacts: actions.syncInboxContacts, receiveFromInbox: vi.fn(),
  searchClientsForLink: vi.fn(async () => []), sendInboxMessage: vi.fn(), setConversationAi: vi.fn(),
  addInboxNote: vi.fn(async () => ({ ok: true })), approveLiaSuggestion: vi.fn(), discardLiaSuggestion: vi.fn(),
  listInboxTeam: vi.fn(async () => []), searchInboxHistory: vi.fn(async () => []),
  setConversationStatus: vi.fn(async () => ({ ok: true })), transferConversation: vi.fn(async () => ({ ok: true })),
}));
const rt = vi.hoisted(() => ({ handlers: [] as { table: string; cb: (p: unknown) => void }[] }));
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({ channel: () => ({
  on(_e: string, f: { table: string }, cb: (p: unknown) => void) { rt.handlers.push({ table: f.table, cb }); return this; },
  subscribe(cb?: (s: string) => void) { cb?.('SUBSCRIBED'); return this; },
}), removeChannel: vi.fn() }) }));
vi.mock('@/components/inbox-attachments', () => ({ InboxAttachments: () => null }));
vi.mock('@/components/quick-replies', () => ({ QuickReplies: () => null }));
vi.mock('@/components/receiving-account-select', () => ({ ReceivingAccountSelect: () => null }));
vi.mock('@/components/pix-charge', () => ({ PixCharge: () => null }));

import { AtendimentoPage } from '@/components/atendimento-page';

/** Renderiza com a lista inicial; o recarregamento automatico devolve a mesma lista. */
function abrirTela(items: ReturnType<typeof item>[]) {
  actions.loadInbox.mockResolvedValue({ items, companyId: undefined, aiActive: false } as never);
  return render(<AtendimentoPage initial={items} />);
}

const item = (id: string, name: string, archived = false) => ({ id, name, phone: '47999990000', clientId: null, clientName: null, preview: 'oi', lastAt: new Date().toISOString(), unread: archived ? 2 : 0, aiPaused: true, assignedName: null, archived, status: 'aberta' as const, department: null, assignedTo: null });
const detail = (id: string, name: string, n = 3, hasOlder = false) => ({
  conversation: item(id, name), hasOlder, panel: null, triage: null, windowOpen: true, suggestion: null, events: [],
  readSnapshot: { count: 0, lastInbound: null, generation: null },
  messages: Array.from({ length: n }, (_, i) => ({ id: `${id}-m${i}`, direction: 'inbound', author: null, senderName: null, body: `mensagem ${i} de ${name}`, at: new Date(Date.UTC(2026, 10, 12, 10, i)).toISOString(), failed: false, error: null, deliveryStatus: 'lida' })),
});

afterEach(() => { cleanup(); vi.clearAllMocks(); rt.handlers.length = 0; });
window.HTMLElement.prototype.scrollIntoView = vi.fn();

describe('Atendimento estilo WhatsApp', () => {
  test('filtro de lidas separa as conversas com mensagens pendentes', async () => {
    abrirTela([item('a', 'Lida'), { ...item('b', 'Pendente'), unread: 2 }]);
    fireEvent.click(screen.getByRole('button', { name: 'Lidas' }));
    expect(screen.getByText('Lida')).toBeTruthy();
    expect(screen.queryByText('Pendente')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Não lidas 1' }));
    expect(screen.getByText('Pendente')).toBeTruthy();
    expect(screen.queryByText('Lida')).toBeNull();
  });
  test('marcar não lida fecha a conversa para não apagar imediatamente a marcação', async () => {
    actions.loadConversation.mockImplementation(async (id: string) => detail(id, 'Ana Cliente'));
    abrirTela([item('a', 'Ana Cliente')]);
    fireEvent.click(screen.getByText('Ana Cliente'));
    fireEvent.click(await screen.findByLabelText('Marcar como não lida'));
    await waitFor(() => expect(actions.markConversationUnread).toHaveBeenCalledWith('a'));
    expect(screen.queryByPlaceholderText('Mensagem')).toBeNull();
  });
  test('reação e citação aparecem como no WhatsApp', async () => {
    actions.loadConversation.mockImplementation(async (id: string) => {
      const d = detail(id, 'Ana Cliente', 2);
      Object.assign(d.messages[0], { reactionCustomer: '👍' });
      Object.assign(d.messages[1], { quotedPreview: 'Qual a cor da calha?' });
      return d;
    });
    abrirTela([item('a', 'Ana Cliente')]);
    fireEvent.click(screen.getByText('Ana Cliente'));
    expect((await screen.findByTitle('Cliente reagiu')).textContent).toBe('👍');
    expect(screen.getByTitle('Respondendo a').textContent).toBe('Qual a cor da calha?');
  });

  test('busca mensagens carregadas e abre/fecha a ficha sem ocupar sempre a conversa', async () => {
    actions.loadConversation.mockImplementation(async (id: string) => detail(id, 'Ana Cliente'));
    abrirTela([item('a', 'Ana Cliente')]);
    fireEvent.click(screen.getByText('Ana Cliente'));
    fireEvent.click(await screen.findByLabelText('Pesquisar nesta conversa'));
    fireEvent.change(screen.getByLabelText('Buscar mensagens nesta conversa'), { target: { value: 'mensagem 1' } });
    expect(screen.getByText('mensagem 1 de Ana Cliente')).toBeTruthy();
    expect(screen.queryByText('mensagem 0 de Ana Cliente')).toBeNull();
    fireEvent.click(screen.getByLabelText('Fechar busca de mensagens'));
    expect(screen.getByText('mensagem 0 de Ana Cliente')).toBeTruthy();
    expect(screen.queryByLabelText('Fechar ficha do cliente')).toBeNull();
    fireEvent.click(screen.getByLabelText('Abrir ficha do cliente'));
    fireEvent.click(screen.getByLabelText('Fechar ficha do cliente'));
    expect(screen.queryByLabelText('Fechar ficha do cliente')).toBeNull();
  });
  test('sincronizar também atualiza as mensagens da conversa aberta', async () => {
    actions.loadConversation.mockImplementation(async (id: string) => detail(id, 'Ana Cliente', 1));
    abrirTela([item('a', 'Ana Cliente')]);
    fireEvent.click(screen.getByText('Ana Cliente'));
    await screen.findByText('mensagem 0 de Ana Cliente');
    actions.loadConversation.mockImplementation(async (id: string) => detail(id, 'Ana Cliente', 2));
    fireEvent.click(screen.getByLabelText('Sincronizar mensagens e contatos'));
    expect(await screen.findByText('mensagem 1 de Ana Cliente')).toBeTruthy();
    expect(actions.syncInboxContacts).toHaveBeenCalledTimes(1);
  });
  test('arquivadas ficam numa aba propria, com contador', async () => {
    actions.loadConversation.mockImplementation(async (id: string) => detail(id, id));
    abrirTela([item('a', 'Ana Cliente'), item('b', 'Bruno Arquivado', true)]);
    expect(screen.getByText('Ana Cliente')).toBeTruthy();
    expect(screen.queryByText('Bruno Arquivado')).toBeNull();
    fireEvent.click(screen.getByText('Arquivadas'));
    expect(await screen.findByText('Bruno Arquivado')).toBeTruthy();
    expect(screen.queryByText('Ana Cliente')).toBeNull();
  });

  test('pre-carrega as conversas do topo e abre na hora, sem "Carregando"', async () => {
    actions.loadConversation.mockImplementation(async (id: string) => detail(id, id === 'a' ? 'Ana Cliente' : id));
    abrirTela([item('a', 'Ana Cliente'), item('c', 'Carla')]);
    await waitFor(() => expect(actions.loadConversation).toHaveBeenCalledWith('a', { panel: false }), { timeout: 3000 });
    // Abrir de novo nao espera o servidor: o detalhe pre-carregado aparece imediatamente.
    actions.loadConversation.mockImplementation(() => new Promise(() => {}));
    fireEvent.click(await screen.findByText('Ana Cliente'));
    expect(screen.getByText('mensagem 2 de Ana Cliente')).toBeTruthy();
    expect(screen.queryByText('Carregando…')).toBeNull();
  });

  test('mensagens anteriores carregam e arquivar chama a acao', async () => {
    actions.loadConversation.mockImplementation(async (id: string) => detail(id, 'Ana Cliente', 3, true));
    actions.loadOlderMessages.mockResolvedValue({ hasOlder: false, messages: [{ id: 'old1', direction: 'inbound', author: null, senderName: null, body: 'mensagem antiga', at: '2026-11-01T10:00:00Z', failed: false, error: null }] });
    abrirTela([item('a', 'Ana Cliente')]);
    fireEvent.click(screen.getByText('Ana Cliente'));
    fireEvent.click(await screen.findByText('Mensagens anteriores'));
    expect(await screen.findByText('mensagem antiga')).toBeTruthy();
    expect(actions.loadOlderMessages).toHaveBeenCalledWith('a', expect.any(String));
    fireEvent.click(screen.getByLabelText('Arquivar conversa'));
    await waitFor(() => expect(actions.setConversationArchived).toHaveBeenCalledWith('a', true));
  });

  test('conversa aberta que volta a ter nao lidas e lida de novo com o estado atual', async () => {
    const unread = (id: string, n: number) => ({ ...detail(id, 'Ana Cliente'), conversation: { ...item(id, 'Ana Cliente'), unread: n },
      readSnapshot: { count: n, lastInbound: '2026-11-12T10:02:00.000Z', generation: null } });
    actions.loadInbox.mockResolvedValue({ items: [item('a', 'Ana Cliente')], companyId: 'emp', aiActive: false } as never);
    actions.loadConversation.mockImplementation(async (id: string) => unread(id, 1));
    render(<AtendimentoPage initial={[item('a', 'Ana Cliente')]} />);
    fireEvent.click(screen.getByText('Ana Cliente'));
    await waitFor(() => expect(actions.markInboxRead).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(rt.handlers.some(h => h.table === 'conversations')).toBe(true));
    // Webhook contou a mensagem depois da leitura: o contador volta a 1 na conversa aberta.
    actions.loadConversation.mockImplementation(async (id: string) => unread(id, 2));
    const conv = rt.handlers.find(h => h.table === 'conversations')!;
    conv.cb({ eventType: 'UPDATE', new: { id: 'a', client_id: null, unread_count: 2, last_message_preview: 'oi', last_message_at: new Date().toISOString() }, old: {} });
    await waitFor(() => expect(actions.markInboxRead).toHaveBeenCalledTimes(2), { timeout: 3000 });
  });
});
