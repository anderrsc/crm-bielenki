"use client";
// Central de IA → "Como a Ana atende": perguntas para o dono responder + aprender com as conversas da equipe.
import { useEffect, useState } from "react";
import { BookOpen, GraduationCap, Save } from "lucide-react";
import { getAnaRules, learnChunk, learnFinish, saveAnaRules } from "@/app/(crm)/ana-rules-actions";

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function AnaRules() {
  const [rules, setRules] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { getAnaRules().then((r) => { if ("rules" in r) setRules(r.rules); else setStatus(r.error); setLoaded(true); }); }, []);

  async function salvar() {
    setBusy(true); setStatus("Salvando…");
    const r = await saveAnaRules(rules);
    setStatus(r.ok ? "Salvo. A Ana já usa nas próximas mensagens." : `Erro: ${r.error}`); setBusy(false);
  }

  async function aprender() {
    setBusy(true);
    const saved = await saveAnaRules(rules);
    if (!saved.ok) { setStatus(`Erro: ${saved.error}`); setBusy(false); return; }
    const notes: string[] = [];
    let total = 1;
    for (let i = 0; i < total; i++) {
      setStatus(`Lendo as conversas da equipe… parte ${i + 1}${total > 1 ? ` de ${total}` : ""}`);
      let r = await learnChunk(i);
      // IA gratuita tem limite por minuto: espera e tenta de novo.
      if (!r.ok && /limite|rate|429|muitas/i.test(r.error)) { setStatus("A IA pediu um tempo, continuo em 1 minuto…"); await pause(60_000); r = await learnChunk(i); }
      if (!r.ok) { setStatus(`Erro: ${r.error}`); setBusy(false); return; }
      total = r.chunks;
      if (r.notes) notes.push(r.notes);
      if (i + 1 < total) await pause(30_000);
    }
    setStatus("Montando o resumo do que ela aprendeu…");
    await pause(20_000);
    const fin = await learnFinish(notes);
    if (!fin.ok) { setStatus(`Erro: ${fin.error}`); setBusy(false); return; }
    const again = await getAnaRules();
    if ("rules" in again) setRules(again.rules);
    setStatus("Pronto. O que ela aprendeu está no fim do texto: confira e apague o que estiver errado."); setBusy(false);
  }

  return (
    <section className="card p-4">
      <h2 className="flex items-center gap-2 text-base font-black"><BookOpen className="h-5 w-5" /> Como a Ana atende</h2>
      <p className="mt-1 text-sm text-ink/70">
        Responda embaixo de cada pergunta (linha <b>R:</b>). O que ficar em branco ela ignora. Essas regras mandam mais que tudo.
        O botão <b>Aprender com as conversas</b> lê as últimas 1000 mensagens da equipe e anota como vocês atendem.
      </p>
      <textarea
        value={rules} onChange={(e) => setRules(e.target.value)} disabled={!loaded}
        className="mt-3 h-[28rem] w-full rounded-xl border border-sand/80 bg-cream p-3 font-mono text-xs leading-relaxed"
      />
      <div className="mt-2 flex flex-wrap gap-2">
        <button onClick={salvar} disabled={busy || !loaded} className="flex items-center gap-1 rounded-xl bg-forest px-3 py-2 text-xs font-bold text-white disabled:opacity-60"><Save className="h-4 w-4" /> Salvar regras</button>
        <button onClick={aprender} disabled={busy || !loaded} className="flex items-center gap-1 rounded-xl bg-cream px-3 py-2 text-xs font-bold disabled:opacity-60"><GraduationCap className="h-4 w-4" /> Aprender com as conversas</button>
      </div>
      {status && <p className="mt-2 text-xs text-ink/70">{status}</p>}
    </section>
  );
}
