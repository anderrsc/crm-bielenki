import type { Metadata } from "next";
import Link from "next/link";
import { getAuthUser, getRequestClient } from "@/lib/supabase/server";
import { selectOwnProfile } from "@/lib/own-profile";
import { money, shortDate, todayISO } from "@/lib/utils";
import { PrintButton } from "@/components/print-button";
import { AuthorSignature } from "@/components/brand-logo";
import { formaLabel, parseStatement, statementPeriod } from "@/lib/account-statement";

export const metadata: Metadata = { title: { absolute: "Extrato por conta – Marquinhos Calhas e Esquadrias" } };

type Company = { trade_name?: string | null; name?: string | null; tax_id?: string | null; phone?: string | null; whatsapp?: string | null; address?: string | null; neighborhood?: string | null; city?: string | null; state?: string | null };

const cnpj = (v?: string | null) => { const d = (v ?? "").replace(/\D/g, ""); return d.length === 14 ? d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5") : (v ?? ""); };
const fone = (v?: string | null) => { const d = (v ?? "").replace(/\D/g, "").replace(/^55(?=\d{10,11}$)/, ""); return /^\d{10,11}$/.test(d) ? `(${d.slice(0, 2)}) ${d.slice(2, -4)}-${d.slice(-4)}` : (v ?? ""); };

export default async function ExtratoPage({ searchParams }: { searchParams: Promise<{ conta?: string; de?: string; ate?: string }> }) {
  const search = await searchParams;
  const db = await getRequestClient();
  const user = await getAuthUser(db);
  if (!user) return <p role="alert" className="p-6">Entre novamente no CRM.</p>;
  const today = todayISO();
  const { from, to } = statementPeriod(search.de, search.ate, today);
  const [{ data: accounts }, profile] = await Promise.all([
    db.from("receiving_accounts").select("id,name,active").order("active", { ascending: false }).order("name"),
    selectOwnProfile<{ company: Company }>(db, "company:companies(trade_name,name,tax_id,phone,whatsapp,address,neighborhood,city,state)"),
  ]);
  const company = (profile.data?.company ?? {}) as Company;
  const contas = accounts ?? [];
  const contaId = contas.some(c => c.id === search.conta) ? search.conta! : contas[0]?.id;
  const result = contaId ? await db.rpc("account_statement", { p_account: contaId, p_from: from, p_to: to }) : null;
  const st = result && !result.error ? parseStatement(result.data) : null;
  const erro = result?.error ? (result.error.code === "P0001" ? result.error.message : "Não foi possível gerar o extrato. Tente novamente.") : null;
  const nomeEmpresa = (company.trade_name || company.name || "Marquinhos Calhas e Esquadrias").toUpperCase();
  const endereco = [company.address, company.neighborhood, [company.city, company.state].filter(Boolean).join(" - ")].filter(Boolean).join(", ");
  const contato = [fone(company.phone), company.whatsapp && fone(company.whatsapp) !== fone(company.phone) ? `WhatsApp ${fone(company.whatsapp)}` : ""].filter(Boolean).join(" · ");

  return <div className="min-h-screen bg-[#f0f0f0] pb-10 print:min-h-0 print:bg-white print:p-0">
    <div className="no-print sticky top-0 z-10 border-b bg-white px-4 py-3 shadow-sm">
      <form method="get" className="mx-auto flex max-w-[210mm] flex-wrap items-end gap-3 text-sm text-[#111]">
        <Link href="/financeiro/caixa" className="self-center font-bold text-[#b30b0b] underline">Voltar</Link>
        <label><span className="block text-xs font-bold">Conta</span>
          <select name="conta" defaultValue={contaId} className="h-10 rounded-lg border border-[#ddd] bg-white px-2">
            {contas.map(c => <option key={c.id} value={c.id}>{c.name}{c.active ? "" : " (inativa)"}</option>)}
          </select></label>
        <label><span className="block text-xs font-bold">De</span><input type="date" name="de" defaultValue={from} max={today} className="h-10 rounded-lg border border-[#ddd] bg-white px-2" /></label>
        <label><span className="block text-xs font-bold">Até</span><input type="date" name="ate" defaultValue={to} className="h-10 rounded-lg border border-[#ddd] bg-white px-2" /></label>
        <button className="h-10 rounded-lg border border-[#ddd] bg-white px-4 font-bold">Gerar extrato</button>
        {st && <PrintButton label="Imprimir / PDF" />}
      </form>
    </div>

    {!contas.length && <p className="mx-auto mt-8 max-w-[210mm] rounded-xl bg-white p-6 text-[#111]">Nenhuma conta cadastrada. Cadastre as contas de pagamento no Financeiro.</p>}
    {erro && <p role="alert" className="mx-auto mt-8 max-w-[210mm] rounded-xl bg-red-50 p-6 text-red-800">{erro}</p>}

    {st && <div className="overflow-x-auto print:overflow-visible"><article className="quote-sheet print-sheet statement-sheet mx-auto mt-6 bg-white shadow-lg print:mt-0 print:shadow-none" aria-label="Extrato da conta">
      <header className="flex items-center gap-6 border-b-2 border-[#d71920] pb-4">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand/original/marquinhos-logo.svg" alt="Marquinhos Calhas e Esquadrias" className="h-[22mm] w-[52mm] object-contain" />
        <div className="min-w-0 flex-1 text-[8px] leading-relaxed text-[#333]">
          <p className="mb-1 text-[12px] font-black text-[#111]">{nomeEmpresa}</p>
          {company.tax_id && <p>CNPJ {cnpj(company.tax_id)}</p>}
          {endereco && <p>{endereco}</p>}
          {contato && <p>{contato}</p>}
        </div>
        <div className="text-right">
          <p className="text-[8px] font-bold uppercase tracking-[.2em] text-[#d71920]">Extrato</p>
          <p className="text-[13px] font-black text-[#111]">{st.conta.nome}</p>
          <p className="text-[8px] text-[#555]">{shortDate(st.de)} a {shortDate(st.ate)}</p>
        </div>
      </header>

      <section className="mt-4 grid grid-cols-4 overflow-hidden rounded-[2mm] border border-[#e4e4e7] bg-[#f7f7f8] text-[#111]">
        {[["Saldo anterior", st.saldo_anterior, ""], ["Entradas", st.entradas, "text-emerald-700"], ["Saídas", -st.saidas, "text-[#b30b0b]"], ["Saldo final", st.saldo_final, st.saldo_final < 0 ? "text-[#b30b0b]" : ""]].map(([l, v, c], i) => (
          <div key={String(l)} className={`p-3 ${i ? "border-l border-[#e4e4e7]" : ""}`}>
            <p className="text-[7px] font-bold uppercase tracking-wider text-[#666]">{l}</p>
            <p className={`text-[11px] font-black tabular-nums ${c}`}>{money(Number(v))}</p>
          </div>
        ))}
      </section>

      <table className="mt-4 w-full border-collapse text-[8px] text-[#111]">
        <thead>
          <tr className="border-y border-[#e4e4e7] bg-[#f7f7f8] text-left text-[7px] uppercase tracking-wider">
            <th className="w-[16mm] p-1.5">Data</th><th className="p-1.5">Descrição</th><th className="w-[22mm] p-1.5">Forma</th>
            <th className="w-[24mm] p-1.5 text-right">Valor</th><th className="w-[24mm] p-1.5 text-right">Saldo</th>
          </tr>
        </thead>
        <tbody>
          <tr className="border-b border-[#e4e4e7] text-[#555]"><td className="p-1.5">{shortDate(st.de)}</td><td className="p-1.5" colSpan={3}>Saldo anterior</td><td className="p-1.5 text-right tabular-nums">{money(st.saldo_anterior)}</td></tr>
          {st.movimentos.map((m, i) => (
            <tr key={i} className="break-inside-avoid border-b border-[#e4e4e7]">
              <td className="p-1.5 align-top">{shortDate(m.data)}</td>
              <td className="p-1.5 align-top"><span className="font-semibold">{m.descricao}</span>{m.pessoa && <span className="block text-[#666]">{m.pessoa}</span>}</td>
              <td className="p-1.5 align-top">{formaLabel(m.forma)}</td>
              <td className={`p-1.5 text-right align-top font-bold tabular-nums ${m.valor < 0 ? "text-[#b30b0b]" : "text-emerald-700"}`}>{m.valor < 0 ? "− " : "+ "}{money(Math.abs(m.valor))}</td>
              <td className="p-1.5 text-right align-top tabular-nums">{money(m.saldo)}</td>
            </tr>
          ))}
          {!st.movimentos.length && <tr><td colSpan={5} className="p-4 text-center text-[#666]">Nenhuma entrada ou saída nesta conta no período.</td></tr>}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-[#111] font-black"><td className="p-1.5" colSpan={3}>Saldo final em {shortDate(st.ate)}</td><td /><td className="p-1.5 text-right tabular-nums">{money(st.saldo_final)}</td></tr>
        </tfoot>
      </table>
      {st.conta.saldo_inicial_data && st.conta.saldo_inicial_data > st.de && <p className="mt-3 text-[7px] text-[#666]">O saldo desta conta é contado a partir de {shortDate(st.conta.saldo_inicial_data)}; baixas anteriores a essa data não entram no extrato.</p>}
      <div className="quote-paper-credit"><span>Emitido em {new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}</span><AuthorSignature /></div>
    </article></div>}
  </div>;
}
