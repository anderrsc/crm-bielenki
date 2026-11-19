"use client";
// Números de WhatsApp (calha, esquadrias…): cada usuária conecta o próprio número lendo o QR
// e autoriza quem mais pode ver as conversas dele. Cadastros continuam centralizados.
import { useCallback, useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { ArrowLeft, CheckCircle, Plus, Smartphone, XCircle } from "lucide-react";
import {
  addWhatsappChannel, disconnectWhatsappChannel, listWhatsappChannels, renameWhatsappChannel, setWhatsappChannelAccess, whatsappChannelQr,
  type ChannelRow,
} from "@/app/(crm)/whatsapp-channel-actions";
import { cn } from "@/lib/utils";
import { confirmAction } from "@/components/ui-feedback/confirm";

const STATUS: Record<string, string> = { open: "Conectado", aguardando_qr: "Aguardando QR", connecting: "Conectando", close: "Desconectado", desconectado: "Desconectado", migrado: "Conectado" };
const quando = (iso: string | null) => (iso ? new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—");

export function WhatsappChannels() {
  const [channels, setChannels] = useState<ChannelRow[] | null>(null);
  const [team, setTeam] = useState<Array<{ id: string; name: string }>>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [nome, setNome] = useState("");
  const [qrFor, setQrFor] = useState<string | null>(null);
  const [qr, setQr] = useState<{ state: string; qr: string | null; pairingCode: string | null } | null>(null);
  const [pending, start] = useTransition();

  const carregar = useCallback(async () => {
    const r = await listWhatsappChannels();
    if ("channels" in r) { setChannels(r.channels); setTeam(r.team); } else setErro(r.error);
  }, []);
  useEffect(() => { carregar(); }, [carregar]);

  // QR na tela: atualiza a cada 5 s até o celular ler.
  useEffect(() => {
    if (!qrFor) return;
    let vivo = true;
    const tick = async () => {
      const r = await whatsappChannelQr(qrFor);
      if (!vivo) return;
      if ("state" in r) {
        setQr({ state: r.state, qr: r.qr, pairingCode: r.pairingCode });
        if (r.state === "open") { setMsg(`Número conectado${r.phone ? ` (${r.phone})` : ""}! As conversas novas dele aparecem no Atendimento.`); setQrFor(null); setQr(null); carregar(); }
      } else setErro(r.error);
    };
    tick();
    const t = setInterval(tick, 5000);
    return () => { vivo = false; clearInterval(t); };
  }, [qrFor, carregar]);

  const run = (fn: () => Promise<{ error?: string } | object>, ok?: string) => start(async () => {
    setMsg(null);
    const r = await fn();
    if ("error" in r && r.error) setErro(r.error); else { setErro(null); if (ok) setMsg(ok); await carregar(); }
  });

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4">
      <Link href="/atendimento" className="inline-flex items-center gap-1 text-sm font-bold text-ink/60"><ArrowLeft className="h-4 w-4" /> Atendimento</Link>
      <div>
        <h1 className="flex items-center gap-2 text-xl font-black"><Smartphone className="h-5 w-5" /> Números de WhatsApp</h1>
        <p className="text-sm text-ink/60">Cada usuária conecta o próprio número lendo o QR no celular. As conversas de cada número ficam com quem conectou, com quem ela autorizar e com a gerência. Clientes, orçamentos e vendas continuam centralizados para todos.</p>
      </div>

      {erro && <p className="rounded-lg bg-red-500/10 p-2 text-sm text-red-500">{erro}</p>}
      {msg && <p className="rounded-lg bg-green-500/10 p-2 text-sm text-green-600">{msg}</p>}

      <div className="card space-y-2 p-4">
        <p className="font-bold">Adicionar meu número</p>
        <div className="flex gap-2">
          <input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex.: WhatsApp Esquadrias" maxLength={60} className="field min-w-0 flex-1" />
          <button disabled={pending || nome.trim().length < 2} className="inline-flex items-center gap-1 rounded-xl bg-forest px-4 py-2 text-sm font-bold text-white disabled:opacity-60"
            onClick={() => start(async () => {
              setMsg(null);
              const r = await addWhatsappChannel(nome);
              if ("id" in r) { setErro(null); setNome(""); setQr(null); setQrFor(r.id); await carregar(); } else setErro(r.error);
            })}><Plus className="h-4 w-4" /> Gerar QR</button>
        </div>
        <p className="text-xs text-ink/55">No celular: WhatsApp → Aparelhos conectados → Conectar um aparelho → aponte para o QR. A Lia não responde nos números novos.</p>
      </div>

      {qrFor && (
        <div className="card flex flex-col items-center gap-2 p-4 text-center">
          <p className="font-bold">Leia o QR com o WhatsApp do número</p>
          {qr?.qr ? <img src={qr.qr.startsWith("data:") ? qr.qr : `data:image/png;base64,${qr.qr}`} alt="QR do WhatsApp" className="h-64 w-64 rounded-lg bg-white p-2" /> : <p className="text-sm text-ink/55">Gerando QR…</p>}
          {qr?.pairingCode && <p className="text-sm">Ou use o código: <b className="font-mono">{qr.pairingCode}</b></p>}
          <button onClick={() => { setQrFor(null); setQr(null); }} className="text-xs font-bold text-ink/55 underline">Fechar</button>
        </div>
      )}

      {!channels && !erro && <p className="text-sm text-ink/55">Carregando números…</p>}
      {channels?.map((c) => <Canal key={c.id} c={c} team={team} pending={pending} run={run} onQr={() => { setQr(null); setQrFor(c.id); }} />)}
    </div>
  );
}

function Canal({ c, team, pending, run, onQr }: {
  c: ChannelRow; team: Array<{ id: string; name: string }>; pending: boolean;
  run: (fn: () => Promise<{ error?: string } | object>, ok?: string) => void; onQr: () => void;
}) {
  const conectado = c.active && (c.status === "open" || c.status === "migrado");
  const [editando, setEditando] = useState(false);
  const [nome, setNome] = useState(c.name);
  const [quem, setQuem] = useState("");
  const outros = team.filter((t) => t.id !== c.ownerId && !c.members.some((m) => m.id === t.id));
  return (
    <div className="card space-y-2 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {editando ? (
          <div className="flex flex-1 gap-2">
            <input value={nome} onChange={(e) => setNome(e.target.value)} maxLength={60} className="field min-w-0 flex-1" />
            <button disabled={pending} className="rounded-lg bg-forest px-3 text-sm font-bold text-white" onClick={() => { run(() => renameWhatsappChannel(c.id, nome)); setEditando(false); }}>Salvar</button>
          </div>
        ) : (
          <p className="font-black">{c.name} {c.isDefault && <span className="ml-1 rounded bg-cream px-1.5 py-0.5 text-[10px] font-bold uppercase text-ink/60">principal · Lia</span>}</p>
        )}
        <span className={cn("flex items-center gap-1 rounded-full px-2 py-1 text-xs font-bold", conectado ? "bg-green-500/15 text-green-600" : "bg-amber-500/15 text-amber-600")}>
          {conectado ? <CheckCircle className="h-3 w-3" /> : <XCircle className="h-3 w-3" />} {STATUS[c.status ?? ""] ?? c.status ?? "—"}
        </span>
      </div>
      <p className="text-xs text-ink/60">
        {c.phone ? `${c.phone} · ` : ""}{c.isDefault || c.shared ? "Toda a equipe vê" : `De ${c.mine ? "você" : c.ownerName ?? "—"}`} · última mensagem {quando(c.lastEventAt)} · sincronizado {quando(c.lastSyncAt)}
      </p>
      {!c.isDefault && !c.shared && (
        <div className="space-y-1 text-sm">
          <p className="text-xs font-bold text-ink/60">Quem mais pode ver as conversas deste número</p>
          <div className="flex flex-wrap gap-1">
            {c.members.length === 0 && <span className="text-xs text-ink/50">Só {c.mine ? "você" : c.ownerName} e a gerência.</span>}
            {c.members.map((m) => (
              <span key={m.id} className="inline-flex items-center gap-1 rounded-full bg-cream px-2 py-0.5 text-xs">{m.name}
                {c.canManage && <button disabled={pending} aria-label={`Remover ${m.name}`} onClick={() => run(() => setWhatsappChannelAccess(c.id, m.id, false))}>×</button>}
              </span>
            ))}
          </div>
          {c.canManage && outros.length > 0 && (
            <div className="flex gap-2">
              <select value={quem} onChange={(e) => setQuem(e.target.value)} className="field min-w-0 flex-1 text-sm" aria-label="Autorizar usuário">
                <option value="">Autorizar usuário…</option>
                {outros.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
              <button disabled={pending || !quem} className="rounded-lg bg-forest px-3 text-sm font-bold text-white disabled:opacity-60" onClick={() => { const p = quem; setQuem(""); run(() => setWhatsappChannelAccess(c.id, p, true), "Acesso liberado."); }}>Autorizar</button>
            </div>
          )}
        </div>
      )}
      {c.canManage && !c.isDefault && (
        <div className="flex flex-wrap gap-2 pt-1 text-xs font-bold">
          {!conectado && c.provider === "evolution" && <button onClick={onQr} className="rounded-lg bg-forest px-3 py-1.5 text-white">Ler QR</button>}
          <button onClick={() => setEditando((v) => !v)} className="rounded-lg bg-cream px-3 py-1.5">Renomear</button>
          {c.active && <button disabled={pending} className="rounded-lg bg-red-500/10 px-3 py-1.5 text-red-600"
            onClick={() => { void confirmAction({ title: "Desconectar número", message: `Desconectar "${c.name}"? O histórico continua no CRM.`, confirmLabel: "Desconectar" }).then((ok) => { if (ok) run(() => disconnectWhatsappChannel(c.id), "Número desconectado."); }); }}>Desconectar</button>}
        </div>
      )}
      {c.isDefault && <p className="text-xs text-ink/50">O número principal é gerenciado na Central de IA.</p>}
    </div>
  );
}
