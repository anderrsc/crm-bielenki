import { AlertCircle,ArrowRight,CheckCircle2 } from "lucide-react";
import { login } from "./actions";
import { AuthorSignature,BrandLogo } from "@/components/brand-logo";
import { ThemeToggle } from "@/components/theme-toggle";
export default async function Login({searchParams}:{searchParams:Promise<{erro?:string}>}){
 const {erro}=await searchParams;
 return <main className="login-screen">
  <section className="login-story"><BrandLogo/><div><p className="login-kicker">Do primeiro contato à obra concluída</p><h1>Uma operação<br/>à altura de<br/>cada projeto.</h1><div className="login-features">{["Orçamentos com peças em 3D","Controle da venda à instalação","Financeiro e estoque integrados","Equipe conectada em campo"].map(text=><div key={text}><CheckCircle2 size={17}/><span>{text}</span></div>)}</div></div><div><p className="text-xs text-ink/50">Calhas e Esquadrias Marquinhos · Industriais e Residenciais</p><AuthorSignature/></div></section>
  <section className="login-panel"><ThemeToggle/><div className="login-card"><div className="login-mobile-logo"><BrandLogo/></div><span className="login-kicker">Bem-vindo de volta</span><h2>Entre na sua conta.</h2><p>Acesse seus clientes, orçamentos e a operação em um só lugar.</p>
   <form action={login}><div><label className="label" htmlFor="login-email">E-mail</label><input id="login-email" className="field" name="email" type="email" required autoComplete="username" placeholder="Seu e-mail de acesso"/></div><div><label className="label" htmlFor="login-password">Senha</label><input id="login-password" className="field" name="password" type="password" required autoComplete="current-password" placeholder="Sua senha"/></div>{erro&&<p className="login-error" role="alert"><AlertCircle size={17}/>{erro}</p>}<button className="button w-full">Entrar no sistema<ArrowRight size={17}/></button></form>
   <p className="mt-6 text-center text-xs text-ink/50">Precisa de acesso? Fale com o administrador da empresa.</p><div className="login-credit"><AuthorSignature/></div>
  </div></section>
 </main>;
}
