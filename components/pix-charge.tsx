"use client";
// Atendimento → "Cobrar via Pix": escolhe a conta, o que cobrar e 50%/100%; manda a mensagem e o copia e cola.
// A cobrança fica registrada na conta escolhida (extrato da conta, "aguardando pagamento") até confirmarem o recebimento.
import { useEffect, useMemo, useState, useTransition } from "react";
import { Check, QrCode, Send, X } from "lucide-react";
import { sendInboxMessage } from "@/app/(crm)/atendimento-actions";
import { listReceivingAccounts, type ReceivingAccount } from "@/app/(crm)/receiving-accounts-actions";
import { pixChargeMessage, pixCopiaECola } from "@/lib/pix";
import { cancelPixCharge, confirmPixCharge, listPixCharges, recordPixCharge, type PixChargeRow } from "@/app/(crm)/pix-charge-actions";
import { confirmAction } from "@/components/ui-feedback/confirm";

type Base = { key: string; label: string; what: string; value: number; entryId?: string; quoteId?: string };

export function PixCharge({ conversationId, clientId, clientName, contas, orcamentos, onSent }: {
  conversationId: string;
  clientId?: string | null;
  clientName: string;
  contas: Array<{ id: string; descricao: string; aberto: number }>;
  orcamentos: Array<{ id: string; numero: string; total: number }>;
  onSent: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [accounts, setAccounts] = useState<ReceivingAccount[] | null>(null);
  const [accountId, setAccountId] = useState("");
  const bases: Base[] = useMemo(() => [
    ...contas.filter((c) => c.aberto > 0).map((c) => ({ key: `c:${c.id}`, label: `Em aberto: ${c.descricao}`, what: c.descricao, value: c.aberto, entryId: c.id })),
    ...orcamentos.filter((o) => o.total > 0).map((o) => ({ key: `o:${o.id}`, label: `Orçamento ${o.numero}`, what: `orçamento ${o.numero}`, value: o.total, quoteId: o.id })),
  ], [contas, orcamentos]);
  const [baseKey, setBaseKey] = useState("");
  const [percent, setPercent] = useState<50 | 100 | null>(50);
  const [custom, setCustom] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [charges, setCharges] = useState<PixChargeRow[]>([]);
  const reload = () => { listPixCharges({ conversationId }).then(setCharges).catch(() => undefined); };
  useEffect(reload, [conversationId]);

  useEffect(() => {
    if (!open || accounts) return;
    listReceivingAccounts().then((r) => {
      if (!r.ok) return setErro(r.error);
      const withPix = r.accounts.filter((a) => a.pix_key);
      setAccounts(withPix);
      if (withPix[0]) setAccountId(withPix[0].id);
    });
  }, [open, accounts]);
  useEffect(() => { if (!baseKey && bases[0]) setBaseKey(bases[0].key); }, [bases, baseKey]);

  const base = bases.find((b) => b.key === baseKey);
  const account = accounts?.find((a) => a.id === accountId);
  const num = (s: string) => Number(s.includes(",") ? s.replace(/\./g, "").replace(",", ".") : s) || 0;
  const amount = percent ? Math.round(((base?.value ?? 0) * percent) / 100 * 100) / 100 : num(custom);
  const firstName = clientName.trim().split(/\s+/)[0] || null;
  const message = account && amount > 0 ? pixChargeMessage({ firstName, amount, percent, what: base?.what ?? "", key: account.pix_key!, holder: account.holder_name || account.name }) : "";
  const code = account && amount > 0 ? pixCopiaECola({ key: account.pix_key!, name: account.holder_name || account.name, city: account.holder_city || "Jaragua do Sul", amount }) : "";

  function enviar() {
    start(async () => {
      const a = await sendInboxMessage(conversationId, message);
      if (a.error) return setErro(a.error);
      const b = await sendInboxMessage(conversationId, code, { unsigned: true });
      if (b.error) return setErro(`Mensagem enviada, mas o copia e cola falhou: ${b.error}`);
      // Registra na conta escolhida: aparece no extrato dela como "aguardando pagamento".
      const what = base?.what ? `${percent ? `${percent}% do ` : ""}${base.what}` : "Cobrança Pix";
      const r = await recordPixCharge({ accountId, amount, description: `${what.charAt(0).toUpperCase()}${what.slice(1)}`.slice(0, 200), conversationId, clientId: clientId ?? null, entryId: base?.entryId ?? null, quoteId: base?.quoteId ?? null });
      if (!r.ok) return setErro(`Cobrança enviada, mas não foi registrada na conta: ${r.error}`);
      setErro(null); setOpen(false); reload(); onSent();
    });
  }

  const list = <PixChargeList charges={charges} onChange={() => { reload(); onSent(); }} />;
  if (!open) return <div className="space-y-2"><button type="button" onClick={() => setOpen(true)} className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-forest px-3 py-2 text-xs font-semibold text-white"><QrCode className="h-4 w-4" /> Cobrar via Pix</button>{list}</div>;

  return (
    <div className="space-y-2 rounded-xl border border-sand/80 bg-cream/50 p-2 text-xs">
      <p className="font-semibold">Cobrar via Pix</p>
      {accounts && accounts.length === 0 && <p className="text-amber-700">Cadastre a chave Pix em Financeiro → Contas de recebimento.</p>}
      <label className="block">Conta<select className="field w-full" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
        {(accounts ?? []).map((a) => <option key={a.id} value={a.id}>{a.name} · {a.pix_key}</option>)}
      </select></label>
      <label className="block">Cobrar sobre<select className="field w-full" value={baseKey} onChange={(e) => setBaseKey(e.target.value)}>
        {bases.map((b) => <option key={b.key} value={b.key}>{b.label} · {b.value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}</option>)}
        {bases.length === 0 && <option value="">Sem orçamento/conta: use outro valor</option>}
      </select></label>
      <div className="flex gap-1.5">
        {([50, 100] as const).map((p) => <button key={p} type="button" onClick={() => setPercent(p)} className={`flex-1 rounded-lg px-2 py-1.5 font-semibold ${percent === p ? "bg-forest text-white" : "bg-surface"}`}>{p}%</button>)}
        <button type="button" onClick={() => setPercent(null)} className={`flex-1 rounded-lg px-2 py-1.5 font-semibold ${percent === null ? "bg-forest text-white" : "bg-surface"}`}>Outro</button>
      </div>
      {percent === null && <input inputMode="decimal" className="field w-full" placeholder="Valor (R$)" value={custom} onChange={(e) => setCustom(e.target.value)} />}
      {message && (
        <div className="space-y-1">
          <pre className="whitespace-pre-wrap rounded-lg bg-surface p-2 font-sans">{message}</pre>
          <pre className="break-all whitespace-pre-wrap rounded-lg bg-surface p-2 font-mono text-[11px] text-ink/60">{code}</pre>
        </div>
      )}
      {erro && <p className="text-red-500">{erro}</p>}
      <div className="flex gap-2">
        <button type="button" onClick={() => setOpen(false)} className="flex-1 rounded-lg bg-surface px-2 py-1.5 font-semibold">Cancelar</button>
        <button type="button" disabled={!message || pending} onClick={enviar} className="flex flex-[2] items-center justify-center gap-1 rounded-lg bg-green-600 px-2 py-1.5 font-semibold text-white disabled:opacity-50"><Send className="h-3.5 w-3.5" />{pending ? "Enviando…" : "Enviar no WhatsApp"}</button>
      </div>
    </div>
  );
}

const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const STATUS = { aguardando: "Aguardando", recebida: "Recebida", cancelada: "Cancelada" } as const;

/** Cobranças já enviadas: confirmar quando o Pix cair (entra na conta) ou cancelar. */
export function PixChargeList({ charges, onChange, showAccount = true }: { charges: PixChargeRow[]; onChange: () => void; showAccount?: boolean }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  if (!charges.length) return null;
  async function act(c: PixChargeRow, kind: "ok" | "cancel") {
    const ok = await confirmAction(kind === "ok"
      ? { title: "Confirmar recebimento", message: `O Pix de ${brl(c.amount)} caiu na conta ${c.account_name}? A entrada vai para o extrato dessa conta.`, confirmLabel: "Sim, recebi", danger: false }
      : { title: "Cancelar cobrança", message: `Cancelar a cobrança de ${brl(c.amount)}? Nada muda no financeiro.`, confirmLabel: "Cancelar cobrança" });
    if (!ok) return;
    setBusy(c.id); setErro(null);
    const r = kind === "ok" ? await confirmPixCharge(c.id) : await cancelPixCharge(c.id);
    setBusy(null);
    if (!r.ok) setErro(r.error); else onChange();
  }
  return <div className="space-y-1.5 text-xs" aria-label="Cobranças Pix enviadas">
    <p className="font-semibold text-ink/60">Cobranças Pix enviadas</p>
    {charges.slice(0, 6).map((c) => <div key={c.id} className="rounded-lg border border-sand/80 bg-surface p-2">
      <div className="flex items-start justify-between gap-2">
        <span className="min-w-0"><b>{brl(c.amount)}</b>{showAccount && <> · {c.account_name}</>}<span className="block truncate text-ink/55">{c.description}</span></span>
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${c.status === "recebida" ? "bg-emerald-50 text-emerald-700" : c.status === "cancelada" ? "bg-cream text-ink/50" : "bg-amber-50 text-amber-800"}`}>{STATUS[c.status]}</span>
      </div>
      {c.status === "aguardando" && <div className="mt-1.5 flex gap-1.5">
        <button type="button" disabled={busy === c.id} onClick={() => void act(c, "ok")} className="flex flex-1 items-center justify-center gap-1 rounded-md bg-forest px-2 py-1 font-semibold text-white disabled:opacity-50"><Check className="h-3.5 w-3.5" />Recebido</button>
        <button type="button" disabled={busy === c.id} onClick={() => void act(c, "cancel")} className="flex items-center justify-center gap-1 rounded-md px-2 py-1 font-semibold text-ink/60 disabled:opacity-50"><X className="h-3.5 w-3.5" />Cancelar</button>
      </div>}
    </div>)}
    {erro && <p role="alert" className="rounded-md bg-red-50 p-2 text-red-700">{erro}</p>}
  </div>;
}
