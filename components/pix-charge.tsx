"use client";
// Atendimento → "Cobrar via Pix": escolhe a conta, o que cobrar e 50%/100%; manda a mensagem e o copia e cola.
import { useEffect, useMemo, useState, useTransition } from "react";
import { QrCode, Send } from "lucide-react";
import { sendInboxMessage } from "@/app/(crm)/atendimento-actions";
import { listReceivingAccounts, type ReceivingAccount } from "@/app/(crm)/receiving-accounts-actions";
import { pixChargeMessage, pixCopiaECola } from "@/lib/pix";

type Base = { key: string; label: string; what: string; value: number };

export function PixCharge({ conversationId, clientName, contas, orcamentos, onSent }: {
  conversationId: string;
  clientName: string;
  contas: Array<{ id: string; descricao: string; aberto: number }>;
  orcamentos: Array<{ id: string; numero: string; total: number }>;
  onSent: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [accounts, setAccounts] = useState<ReceivingAccount[] | null>(null);
  const [accountId, setAccountId] = useState("");
  const bases: Base[] = useMemo(() => [
    ...contas.filter((c) => c.aberto > 0).map((c) => ({ key: `c:${c.id}`, label: `Em aberto: ${c.descricao}`, what: c.descricao, value: c.aberto })),
    ...orcamentos.filter((o) => o.total > 0).map((o) => ({ key: `o:${o.id}`, label: `Orçamento ${o.numero}`, what: `orçamento ${o.numero}`, value: o.total })),
  ], [contas, orcamentos]);
  const [baseKey, setBaseKey] = useState("");
  const [percent, setPercent] = useState<50 | 100 | null>(50);
  const [custom, setCustom] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [pending, start] = useTransition();

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
      setErro(null); setOpen(false); onSent();
    });
  }

  if (!open) return <button type="button" onClick={() => setOpen(true)} className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-forest px-3 py-2 text-xs font-bold text-white"><QrCode className="h-4 w-4" /> Cobrar via Pix</button>;

  return (
    <div className="space-y-2 rounded-xl border border-sand/80 bg-cream/50 p-2 text-xs">
      <p className="font-black">Cobrar via Pix</p>
      {accounts && accounts.length === 0 && <p className="text-amber-700">Cadastre a chave Pix em Financeiro → Contas de recebimento.</p>}
      <label className="block">Conta<select className="field w-full" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
        {(accounts ?? []).map((a) => <option key={a.id} value={a.id}>{a.name} · {a.pix_key}</option>)}
      </select></label>
      <label className="block">Cobrar sobre<select className="field w-full" value={baseKey} onChange={(e) => setBaseKey(e.target.value)}>
        {bases.map((b) => <option key={b.key} value={b.key}>{b.label} · {b.value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}</option>)}
        {bases.length === 0 && <option value="">Sem orçamento/conta: use outro valor</option>}
      </select></label>
      <div className="flex gap-1.5">
        {([50, 100] as const).map((p) => <button key={p} type="button" onClick={() => setPercent(p)} className={`flex-1 rounded-lg px-2 py-1.5 font-bold ${percent === p ? "bg-forest text-white" : "bg-surface"}`}>{p}%</button>)}
        <button type="button" onClick={() => setPercent(null)} className={`flex-1 rounded-lg px-2 py-1.5 font-bold ${percent === null ? "bg-forest text-white" : "bg-surface"}`}>Outro</button>
      </div>
      {percent === null && <input inputMode="decimal" className="field w-full" placeholder="Valor (R$)" value={custom} onChange={(e) => setCustom(e.target.value)} />}
      {message && (
        <div className="space-y-1">
          <pre className="whitespace-pre-wrap rounded-lg bg-surface p-2 font-sans">{message}</pre>
          <pre className="break-all whitespace-pre-wrap rounded-lg bg-surface p-2 font-mono text-[10px] text-ink/60">{code}</pre>
        </div>
      )}
      {erro && <p className="text-red-500">{erro}</p>}
      <div className="flex gap-2">
        <button type="button" onClick={() => setOpen(false)} className="flex-1 rounded-lg bg-surface px-2 py-1.5 font-bold">Cancelar</button>
        <button type="button" disabled={!message || pending} onClick={enviar} className="flex flex-[2] items-center justify-center gap-1 rounded-lg bg-green-600 px-2 py-1.5 font-bold text-white disabled:opacity-50"><Send className="h-3.5 w-3.5" />{pending ? "Enviando…" : "Enviar no WhatsApp"}</button>
      </div>
    </div>
  );
}
