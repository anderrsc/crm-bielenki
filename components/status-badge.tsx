export function StatusBadge({ value }: { value: string }) {
  const status=value.toLowerCase();
  const tone=/recus|atras|venc|bloq/.test(status)?"danger":/inativ|cancel|rascunho/.test(status)?"neutral":/aprov|pago|concl|recebido|finaliz|ativo/.test(status)?"success":/enviado|agend|andamento/.test(status)?"info":/parcial|aguard|negocia|aberto/.test(status)?"warning":"neutral";
  return <span className="status-badge" data-tone={tone}>{tone==='danger'&&<span aria-hidden>×</span>}{value.replaceAll('_',' ')}</span>;
}
