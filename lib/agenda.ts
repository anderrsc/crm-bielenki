export const agendaTypes = ['medicao','instalacao','producao','compra','reuniao','venda','pos_venda','tarefa','lembrete','orcamento','manutencao','outro'] as const;
export type AgendaSource = 'operational_events' | 'measurements' | 'installations' | 'tasks';
export function agendaStatus(source: AgendaSource, status: string) {
  const allowed = ['agendado','confirmado','em_andamento','concluido','reagendado','cancelado'];
  if (!allowed.includes(status)) throw new Error('Status inválido');
  if (source === 'measurements') {
    return ({ concluido: 'medicao_concluida', em_andamento: 'em_medicao' } as Record<string,string>)[status] ?? status;
  }
  if (source === 'installations') {
    return ({ agendado: 'agendada', confirmado: 'agendada', reagendado: 'agendada', concluido: 'concluida' } as Record<string,string>)[status] ?? status;
  }
  return status;
}

export function agendaTimestamp(date: string, time: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new Error('Data ou horário inválidos');
  const parsed = new Date(`${date}T12:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0,10) !== date) throw new Error('Data inválida');
  return `${date}T${time}:00-03:00`;
}
