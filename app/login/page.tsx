import { ArrowRight, CheckCircle2 } from "lucide-react";
import { login } from "./actions";

export default async function Login({ searchParams }: { searchParams: Promise<{ erro?: string }> }) {
  const { erro } = await searchParams;
  return (
    <main className="grid min-h-screen lg:grid-cols-[1.1fr_.9fr]">
      <section className="relative hidden overflow-hidden bg-ink p-16 text-white lg:flex lg:flex-col lg:justify-between">
        <div className="absolute -right-40 -top-40 h-[520px] w-[520px] rounded-full border-[90px] border-lime/10" />
        <div className="relative text-xl font-black tracking-tight">BIELENKI <span className="text-lime">/ CRM</span></div>
        <div className="relative max-w-2xl">
          <p className="mb-6 text-xs font-bold uppercase tracking-[.3em] text-lime">Da venda à instalação</p>
          <h1 className="text-6xl font-black leading-[.98] tracking-[-.055em]">A operação inteira, sem pontos cegos.</h1>
          <div className="mt-10 grid grid-cols-2 gap-4 text-sm text-white/70">
            {["Compras vinculadas ao pedido", "Financeiro sem planilhas", "Produção liberada por material", "Checklist com responsáveis"].map((x) => <div className="flex gap-2" key={x}><CheckCircle2 className="h-5 w-5 text-lime" />{x}</div>)}
          </div>
        </div>
        <p className="relative text-xs text-white/35">CRM Bielenki · Ambiente operacional seguro</p>
      </section>
      <section className="flex items-center justify-center p-6">
        <div className="w-full max-w-md">
          <div className="mb-10 lg:hidden"><b>BIELENKI</b> <span className="text-forest">/ CRM</span></div>
          <p className="text-xs font-bold uppercase tracking-[.25em] text-forest">Bem-vindo de volta</p>
          <h2 className="mt-3 text-4xl font-black tracking-tight">Entre na sua conta</h2>
          <p className="mt-3 text-sm text-ink/55">Use o acesso criado pelo administrador da empresa.</p>
          <form action={login} className="mt-9 space-y-5">
            <div><label className="label">E-mail</label><input className="field" name="email" type="email" required placeholder="voce@bielenki.com.br" /></div>
            <div><label className="label">Senha</label><input className="field" name="password" type="password" required placeholder="••••••••" /></div>
            {erro && <p className="rounded-xl bg-red-50 p-3 text-sm font-medium text-red-700">{erro}</p>}
            <button className="button w-full py-3.5">Entrar no sistema <ArrowRight className="h-4 w-4" /></button>
          </form>
        </div>
      </section>
    </main>
  );
}
