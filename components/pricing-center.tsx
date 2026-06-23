import Link from "next/link";
import { ArrowLeft, Boxes, Briefcase, History, Package, Palette, Plus, Save, Tag, Trash2, Search } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { money, shortDate, cn } from "@/lib/utils";
import { gutterProducts, gutterThicknesses, gutterCuts, gutterColors } from "@/lib/gutters";
import {
  saveGutterPrice, deleteGutterPrice,
  savePaint, deletePaint,
  saveSpecialPart, deleteSpecialPart,
  savePricingService, deletePricingService,
  saveCommercialTable, deleteCommercialTable,
} from "@/app/(crm)/actions";
import { getAllPrices } from "@/app/(crm)/pricing-actions";
import { PricingSpreadsheet } from "@/components/pricing-spreadsheet";
import { ConfirmButton } from "@/components/confirm-button";

// ─── Listas de referência ───────────────────────────────────────────────────
const EXTRA_PRODUCTS = [
  "Calha Platibanda","Calha de Beiral","Calha Condutora",
  "Rufo","Rufo com Pingadeira","Rufo de Acabamento","Rufo Água Furtada",
  "Rufo de Cumeeira","Rufo Sobre Calha",
  "Pingadeira","Pingadeira com Rufo","Pingadeira de Marquise",
];
const ALL_PRODUCTS = Array.from(new Set([...gutterProducts, ...EXTRA_PRODUCTS])).sort();
const ALL_CUTS = Array.from(new Set([...gutterCuts, 450])).sort((a,b)=>a-b);
const PAINT_COLORS = ["Branco","Preto","Grafite","Marrom","Bronze","Cinza","Areia","Personalizada"];
const PART_NAMES = [
  "Vedante MS40","Silicone","Corrente para Calha","Abraçadeira",
  "Curva de Condutor","Joelho","Emenda","Tampa Lateral",
  "Canto Interno","Canto Externo","Saída de Água","Boca de Lobo",
  "Suporte de Condutor","Rebites","Parafusos","Buchas","Peça Especial Sob Medida",
];
const PART_UNITS = ["Unidade","Metro","Peça","Tubo","Kit","Caixa","Bisnaga","Par"];
const SERVICE_NAMES = [
  "Mão de Obra de Instalação","Mão de Obra de Manutenção",
  "Mão de Obra de Abertura de Telhado","Mão de Obra de Fechamento de Telhado",
  "Deslocamento de Equipe","Frete","Diária de Equipe","Hora Técnica",
  "Caminhão Munck","Plataforma Elevatória","Andaime","Locação de Equipamentos",
];
const SERVICE_UNITS = ["Hora","Diária","Viagem","Serviço","Metro","Metro Quadrado"];
const COMMERCIAL_DEFAULTS = ["Cliente Final","Construtora","Calheiro Parceiro","Parceiro Comercial","Revenda","Especial"];

// ─── Tabs ───────────────────────────────────────────────────────────────────
const TABS = [
  { key:"materia-prima",       label:"Matéria-Prima",        icon: Package    },
  { key:"pintura",             label:"Pintura",               icon: Palette    },
  { key:"pecas-especiais",     label:"Peças Especiais",       icon: Boxes      },
  { key:"servicos",            label:"Serviços e Logística",  icon: Briefcase  },
  { key:"tabelas-comerciais",  label:"Tabelas Comerciais",    icon: Tag        },
  { key:"historico",           label:"Histórico",             icon: History    },
] as const;
type TabKey = typeof TABS[number]["key"];

// ─── Tipos ──────────────────────────────────────────────────────────────────
type GutterRow   = { id:string; product:string; thickness:string; cut_mm:number; color:string|null; unit_price:number; notes:string|null; active:boolean };
type PaintRow    = { id:string; color:string; price_per_meter:number; notes:string|null; active:boolean };
type PartRow     = { id:string; item_name:string; unit:string; unit_price:number; notes:string|null; active:boolean };
type ServiceRow  = { id:string; service_name:string; unit:string; price:number; notes:string|null; active:boolean };
type CommercialRow = { id:string; name:string; description:string|null; adjustment_type:string; adjustment_value:number; active:boolean };
type LogRow      = { id:string; table_name:string; operation:string; old_data:Record<string,unknown>|null; new_data:Record<string,unknown>|null; reason:string|null; created_at:string; user:{ full_name:string }|null };

// ─── Main component ─────────────────────────────────────────────────────────
export async function PricingCenter({
  tab = "materia-prima",
  thickness = "0.50 mm",
  q,
  error,
  saved,
  backHref = "/configuracoes",
  selfHref = "/configuracoes/tabela-calhas",
}: {
  tab?: TabKey;
  thickness?: string;
  q?: string;
  error?: string;
  saved?: boolean;
  backHref?: string;
  selfHref?: string;
}) {
  let canManage = false;
  let prices: GutterRow[] = [];
  let paints: PaintRow[] = [];
  let parts: PartRow[] = [];
  let services: ServiceRow[] = [];
  let commercials: CommercialRow[] = [];
  let logs: LogRow[] = [];

  if (process.env.NEXT_PUBLIC_SUPABASE_URL) {
    const db = await createClient();
    const { data: { user } } = await db.auth.getUser();
    const { data: profile } = user ? await db.from("profiles").select("company_id").eq("id", user.id).single() : { data: null };
    const cid = profile?.company_id;

    const [perm] = await Promise.all([db.rpc("has_table_access", { resource: "gutter_prices", action: "update" })]);
    canManage = Boolean(perm.data);

    if (cid) {
      if (tab === "materia-prima") {
        prices = (await getAllPrices()) as unknown as GutterRow[];
      } else if (tab === "pintura") {
        let req = db.from("pricing_paints").select("*").eq("company_id", cid).order("color");
        if (q) req = req.ilike("color", `%${q}%`);
        paints = ((await req).data ?? []) as PaintRow[];
      } else if (tab === "pecas-especiais") {
        let req = db.from("pricing_special_parts").select("*").eq("company_id", cid).order("item_name");
        if (q) req = req.ilike("item_name", `%${q}%`);
        parts = ((await req).data ?? []) as PartRow[];
      } else if (tab === "servicos") {
        let req = db.from("pricing_services").select("*").eq("company_id", cid).order("service_name");
        if (q) req = req.ilike("service_name", `%${q}%`);
        services = ((await req).data ?? []) as ServiceRow[];
      } else if (tab === "tabelas-comerciais") {
        let req = db.from("pricing_commercial_tables").select("*").eq("company_id", cid).order("name");
        if (q) req = req.ilike("name", `%${q}%`);
        commercials = ((await req).data ?? []) as CommercialRow[];
      } else if (tab === "historico") {
        const req = db.from("pricing_change_log").select("id,table_name,operation,old_data,new_data,reason,created_at,user:profiles(full_name)").eq("company_id", cid).order("created_at", { ascending: false }).limit(200);
        logs = ((await req).data ?? []) as unknown as LogRow[];
      }
    }
  }

  const tabHref = (t: TabKey, extra?: string) => `${selfHref}?aba=${t}${extra ?? ""}`;
  const thickHref = (th: string) => `${selfHref}?aba=materia-prima&espessura=${encodeURIComponent(th)}`;

  return (
    <div className="mx-auto max-w-7xl">
      <Link href={backHref} className="mb-5 inline-flex items-center gap-2 text-sm font-bold text-ink/55">
        <ArrowLeft className="h-4 w-4" />Voltar
      </Link>

      <div className="mb-7 flex items-end justify-between gap-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-[.22em] text-forest">Precificação</p>
          <h1 className="mt-2 text-3xl font-black">Central de Preços</h1>
          <p className="mt-1 text-sm text-ink/50">Matéria-prima, pintura, peças, serviços e políticas comerciais em um só lugar.</p>
        </div>
        {!canManage && <span className="rounded-full bg-blue-50 px-3 py-1.5 text-xs font-bold text-blue-700">Somente leitura</span>}
      </div>

      {error  && <p className="mb-5 rounded-xl bg-red-50     p-4 text-sm text-red-700">{error}</p>}
      {saved  && <p className="mb-5 rounded-xl bg-emerald-50 p-4 text-sm text-emerald-700">Salvo com sucesso.</p>}

      {/* ─── Tabs ─────────────────────────────────── */}
      <div className="mb-6 flex gap-1 overflow-x-auto rounded-2xl bg-cream p-1">
        {TABS.map(({ key, label, icon: Icon }) => (
          <Link key={key} href={tabHref(key)}
            className={cn("flex items-center gap-2 whitespace-nowrap rounded-xl px-4 py-2.5 text-sm font-bold transition",
              tab === key ? "bg-white shadow text-ink" : "text-ink/50 hover:text-ink")}>
            <Icon className="h-4 w-4" />{label}
          </Link>
        ))}
      </div>

      {/* ─── Matéria-Prima — planilha interativa ─── */}
      {tab === "materia-prima" && (
        <PricingSpreadsheet
          initialRows={prices as unknown as import("@/components/pricing-spreadsheet").PriceRow[]}
          canManage={canManage}
        />
      )}

      {/* ─── Pintura ───────────────────────────────── */}
      {tab === "pintura" && (
        <div className="space-y-5">
          <SearchBar q={q} selfHref={selfHref} tab="pintura" placeholder="Buscar cor..." />
          {canManage && (
            <details className="card">
              <summary className="flex cursor-pointer list-none items-center gap-2 p-5 font-black"><Plus className="h-4 w-4" />Nova cor de pintura</summary>
              <form action={savePaint} className="grid gap-4 border-t p-5 sm:grid-cols-2 lg:grid-cols-4">
                <input type="hidden" name="_back" value={`${selfHref}?aba=pintura`} />
                <div>
                  <label className="label">Cor</label>
                  <input className="field" name="color" list="color-list" required placeholder="Ex.: Branco" />
                  <datalist id="color-list">{PAINT_COLORS.map(c => <option key={c} value={c} />)}</datalist>
                </div>
                <div>
                  <label className="label">Preço por metro</label>
                  <input className="field" name="price_per_meter" type="number" step="0.0001" min="0" required placeholder="0,00" />
                </div>
                <div>
                  <label className="label">Observação</label>
                  <input className="field" name="notes" />
                </div>
                <label className="flex items-center gap-2 self-end pb-3 text-sm font-bold">
                  <input className="h-4 w-4 accent-forest" type="checkbox" name="active" defaultChecked />Ativo
                </label>
                <button className="button sm:col-span-2 lg:col-span-4"><Save className="h-4 w-4" />Salvar</button>
              </form>
            </details>
          )}
          <PricingTable
            headers={["Cor","Preço / m","Observação","Ativo"]}
            rows={paints}
            empty="Nenhuma cor cadastrada."
            renderEdit={row => (
              <form action={savePaint} className="grid grid-cols-[1.5fr_1fr_1.5fr_.4fr_auto] items-center gap-2 px-4 py-2">
                <input type="hidden" name="id" value={row.id} />
                <input type="hidden" name="_back" value={`${selfHref}?aba=pintura`} />
                <input className="field h-8 font-semibold" name="color" defaultValue={row.color} />
                <input className="field h-8 font-black" name="price_per_meter" type="number" step="0.0001" min="0" defaultValue={row.price_per_meter} />
                <input className="field h-8" name="notes" defaultValue={row.notes ?? ""} />
                <input className="h-4 w-4 accent-forest" type="checkbox" name="active" defaultChecked={row.active} />
                <RowActions deleteAction={deletePaint} />
              </form>
            )}
            renderRead={row => <ReadCells cells={[row.color, money(row.price_per_meter)+"/m", row.notes ?? "—", row.active ? "Sim" : "Não"]} bold={[0,1]} />}
            canManage={canManage}
          />
        </div>
      )}

      {/* ─── Peças Especiais ───────────────────────── */}
      {tab === "pecas-especiais" && (
        <div className="space-y-5">
          <SearchBar q={q} selfHref={selfHref} tab="pecas-especiais" placeholder="Buscar peça..." />
          {canManage && (
            <details className="card">
              <summary className="flex cursor-pointer list-none items-center gap-2 p-5 font-black"><Plus className="h-4 w-4" />Nova peça especial</summary>
              <form action={saveSpecialPart} className="grid gap-4 border-t p-5 sm:grid-cols-2 lg:grid-cols-4">
                <input type="hidden" name="_back" value={`${selfHref}?aba=pecas-especiais`} />
                <div className="lg:col-span-2">
                  <label className="label">Item</label>
                  <input className="field" name="item_name" list="part-list" required placeholder="Ex.: Abraçadeira" />
                  <datalist id="part-list">{PART_NAMES.map(n => <option key={n} value={n} />)}</datalist>
                </div>
                <div>
                  <label className="label">Unidade</label>
                  <select className="field" name="unit">{PART_UNITS.map(u => <option key={u}>{u}</option>)}</select>
                </div>
                <div>
                  <label className="label">Valor unitário</label>
                  <input className="field" name="unit_price" type="number" step="0.0001" min="0" required placeholder="0,00" />
                </div>
                <div className="sm:col-span-2">
                  <label className="label">Observação</label>
                  <input className="field" name="notes" />
                </div>
                <label className="flex items-center gap-2 self-end pb-3 text-sm font-bold">
                  <input className="h-4 w-4 accent-forest" type="checkbox" name="active" defaultChecked />Ativo
                </label>
                <button className="button sm:col-span-2 lg:col-span-4"><Save className="h-4 w-4" />Salvar</button>
              </form>
            </details>
          )}
          <PricingTable
            headers={["Item","Unidade","Valor Unit.","Observação","Ativo"]}
            rows={parts}
            empty="Nenhuma peça cadastrada."
            renderEdit={row => (
              <form action={saveSpecialPart} className="grid grid-cols-[2fr_.8fr_.8fr_1.5fr_.4fr_auto] items-center gap-2 px-4 py-2">
                <input type="hidden" name="id" value={row.id} />
                <input type="hidden" name="_back" value={`${selfHref}?aba=pecas-especiais`} />
                <input className="field h-8 font-semibold" name="item_name" defaultValue={row.item_name} />
                <select className="field h-8" name="unit" defaultValue={row.unit}>{PART_UNITS.map(u => <option key={u}>{u}</option>)}</select>
                <input className="field h-8 font-black" name="unit_price" type="number" step="0.0001" min="0" defaultValue={row.unit_price} />
                <input className="field h-8" name="notes" defaultValue={row.notes ?? ""} />
                <input className="h-4 w-4 accent-forest" type="checkbox" name="active" defaultChecked={row.active} />
                <RowActions deleteAction={deleteSpecialPart} />
              </form>
            )}
            renderRead={row => <ReadCells cells={[row.item_name, row.unit, money(row.unit_price), row.notes ?? "—", row.active ? "Sim" : "Não"]} bold={[0,2]} />}
            canManage={canManage}
          />
        </div>
      )}

      {/* ─── Serviços e Logística ──────────────────── */}
      {tab === "servicos" && (
        <div className="space-y-5">
          <SearchBar q={q} selfHref={selfHref} tab="servicos" placeholder="Buscar serviço..." />
          {canManage && (
            <details className="card">
              <summary className="flex cursor-pointer list-none items-center gap-2 p-5 font-black"><Plus className="h-4 w-4" />Novo serviço</summary>
              <form action={savePricingService} className="grid gap-4 border-t p-5 sm:grid-cols-2 lg:grid-cols-4">
                <input type="hidden" name="_back" value={`${selfHref}?aba=servicos`} />
                <div className="lg:col-span-2">
                  <label className="label">Serviço</label>
                  <input className="field" name="service_name" list="service-list" required placeholder="Ex.: Mão de Obra de Instalação" />
                  <datalist id="service-list">{SERVICE_NAMES.map(n => <option key={n} value={n} />)}</datalist>
                </div>
                <div>
                  <label className="label">Unidade</label>
                  <select className="field" name="unit">{SERVICE_UNITS.map(u => <option key={u}>{u}</option>)}</select>
                </div>
                <div>
                  <label className="label">Valor</label>
                  <input className="field" name="price" type="number" step="0.0001" min="0" required placeholder="0,00" />
                </div>
                <div className="sm:col-span-2">
                  <label className="label">Observação</label>
                  <input className="field" name="notes" />
                </div>
                <label className="flex items-center gap-2 self-end pb-3 text-sm font-bold">
                  <input className="h-4 w-4 accent-forest" type="checkbox" name="active" defaultChecked />Ativo
                </label>
                <button className="button sm:col-span-2 lg:col-span-4"><Save className="h-4 w-4" />Salvar</button>
              </form>
            </details>
          )}
          <PricingTable
            headers={["Serviço","Unidade","Valor","Observação","Ativo"]}
            rows={services}
            empty="Nenhum serviço cadastrado."
            renderEdit={row => (
              <form action={savePricingService} className="grid grid-cols-[2fr_.8fr_.8fr_1.5fr_.4fr_auto] items-center gap-2 px-4 py-2">
                <input type="hidden" name="id" value={row.id} />
                <input type="hidden" name="_back" value={`${selfHref}?aba=servicos`} />
                <input className="field h-8 font-semibold" name="service_name" defaultValue={row.service_name} />
                <select className="field h-8" name="unit" defaultValue={row.unit}>{SERVICE_UNITS.map(u => <option key={u}>{u}</option>)}</select>
                <input className="field h-8 font-black" name="price" type="number" step="0.0001" min="0" defaultValue={row.price} />
                <input className="field h-8" name="notes" defaultValue={row.notes ?? ""} />
                <input className="h-4 w-4 accent-forest" type="checkbox" name="active" defaultChecked={row.active} />
                <RowActions deleteAction={deletePricingService} />
              </form>
            )}
            renderRead={row => <ReadCells cells={[row.service_name, row.unit, money(row.price), row.notes ?? "—", row.active ? "Sim" : "Não"]} bold={[0,2]} />}
            canManage={canManage}
          />
        </div>
      )}

      {/* ─── Tabelas Comerciais ────────────────────── */}
      {tab === "tabelas-comerciais" && (
        <div className="space-y-5">
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
            <b>Como funciona:</b> as tabelas comerciais aplicam ajuste percentual ou multiplicador no momento da formação do orçamento, sem alterar os preços base cadastrados.
          </div>
          <SearchBar q={q} selfHref={selfHref} tab="tabelas-comerciais" placeholder="Buscar tabela..." />
          {canManage && (
            <details className="card">
              <summary className="flex cursor-pointer list-none items-center gap-2 p-5 font-black"><Plus className="h-4 w-4" />Nova tabela comercial</summary>
              <form action={saveCommercialTable} className="grid gap-4 border-t p-5 sm:grid-cols-2 lg:grid-cols-4">
                <input type="hidden" name="_back" value={`${selfHref}?aba=tabelas-comerciais`} />
                <div className="sm:col-span-2">
                  <label className="label">Nome da tabela</label>
                  <input className="field" name="name" list="commercial-list" required placeholder="Ex.: Construtora" />
                  <datalist id="commercial-list">{COMMERCIAL_DEFAULTS.map(n => <option key={n} value={n} />)}</datalist>
                </div>
                <div className="sm:col-span-2">
                  <label className="label">Descrição</label>
                  <input className="field" name="description" placeholder="Ex.: Desconto aplicado a construtoras parceiras" />
                </div>
                <div>
                  <label className="label">Tipo de ajuste</label>
                  <select className="field" name="adjustment_type">
                    <option value="desconto">Desconto (%)</option>
                    <option value="acrescimo">Acréscimo (%)</option>
                    <option value="multiplicador">Multiplicador</option>
                  </select>
                </div>
                <div>
                  <label className="label">Percentual / Multiplicador</label>
                  <input className="field" name="adjustment_value" type="number" step="0.01" min="0" required placeholder="0" />
                </div>
                <label className="flex items-center gap-2 self-end pb-3 text-sm font-bold">
                  <input className="h-4 w-4 accent-forest" type="checkbox" name="active" defaultChecked />Ativo
                </label>
                <button className="button sm:col-span-2 lg:col-span-4"><Save className="h-4 w-4" />Salvar</button>
              </form>
            </details>
          )}

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {commercials.map(c => (
              <div key={c.id} className={cn("card overflow-hidden", !c.active && "opacity-50")}>
                <div className="border-b p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-black">{c.name}</p>
                      {c.description && <p className="mt-0.5 text-xs text-ink/50">{c.description}</p>}
                    </div>
                    <span className={cn("rounded-full px-2 py-0.5 text-xs font-bold", c.active ? "bg-emerald-50 text-emerald-700" : "bg-ink/5 text-ink/40")}>
                      {c.active ? "Ativo" : "Inativo"}
                    </span>
                  </div>
                  <div className="mt-3 flex items-center gap-3">
                    <span className="rounded-lg bg-forest/10 px-3 py-1 text-xs font-bold text-forest">
                      {c.adjustment_type === "desconto" ? "Desconto" : c.adjustment_type === "acrescimo" ? "Acréscimo" : "Multiplicador"}
                    </span>
                    <span className="text-xl font-black">
                      {c.adjustment_type === "multiplicador" ? `${c.adjustment_value}×` : `${c.adjustment_value}%`}
                    </span>
                  </div>
                </div>
                {canManage && (
                  <form action={saveCommercialTable} className="grid grid-cols-2 gap-3 p-4">
                    <input type="hidden" name="id" value={c.id} />
                    <input type="hidden" name="_back" value={`${selfHref}?aba=tabelas-comerciais`} />
                    <div className="col-span-2">
                      <label className="label">Nome</label>
                      <input className="field h-8 text-sm" name="name" defaultValue={c.name} />
                    </div>
                    <div className="col-span-2">
                      <label className="label">Descrição</label>
                      <input className="field h-8 text-sm" name="description" defaultValue={c.description ?? ""} />
                    </div>
                    <div>
                      <label className="label">Tipo</label>
                      <select className="field h-8 text-sm" name="adjustment_type" defaultValue={c.adjustment_type}>
                        <option value="desconto">Desconto (%)</option>
                        <option value="acrescimo">Acréscimo (%)</option>
                        <option value="multiplicador">Multiplicador</option>
                      </select>
                    </div>
                    <div>
                      <label className="label">Valor</label>
                      <input className="field h-8 text-sm font-bold" name="adjustment_value" type="number" step="0.01" min="0" defaultValue={c.adjustment_value} />
                    </div>
                    <label className="flex items-center gap-2 text-xs font-bold">
                      <input className="h-4 w-4 accent-forest" type="checkbox" name="active" defaultChecked={c.active} />Ativo
                    </label>
                    <div className="flex items-center justify-end gap-2">
                      <ConfirmButton formAction={deleteCommercialTable} className="button-ghost gap-1.5 p-2 text-red-600 hover:bg-red-50" title="Excluir"><Trash2 className="h-4 w-4" /></ConfirmButton>
                      <button className="button gap-1.5 px-4 py-2 text-sm"><Save className="h-3.5 w-3.5" />Salvar</button>
                    </div>
                  </form>
                )}
              </div>
            ))}
            {!commercials.length && (
              <div className="card col-span-3 p-10 text-center text-sm text-ink/40">Nenhuma tabela comercial cadastrada.</div>
            )}
          </div>
        </div>
      )}

      {/* ─── Histórico ─────────────────────────────── */}
      {tab === "historico" && (
        <div className="space-y-4">
          <div className="card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[700px] text-left text-sm">
                <thead className="bg-cream/70 text-[11px] uppercase tracking-wider text-ink/45">
                  <tr>
                    <th className="px-4 py-3">Data / Hora</th>
                    <th className="px-4 py-3">Usuário</th>
                    <th className="px-4 py-3">Tabela</th>
                    <th className="px-4 py-3">Operação</th>
                    <th className="px-4 py-3">Valor anterior</th>
                    <th className="px-4 py-3">Valor novo</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {logs.map(l => {
                    const oldKey = l.old_data ? Object.keys(l.old_data).find(k => k.includes("price") || k.includes("value")) : null;
                    const newKey = l.new_data ? Object.keys(l.new_data).find(k => k.includes("price") || k.includes("value")) : null;
                    const nameKey = l.new_data ? Object.keys(l.new_data).find(k => ["product","color","item_name","service_name","name"].includes(k)) : null;
                    const itemName = nameKey ? (l.new_data?.[nameKey] ?? l.old_data?.[nameKey] ?? "—") : "—";
                    return (
                      <tr key={l.id} className="hover:bg-cream/30">
                        <td className="px-4 py-3 text-xs text-ink/60">{shortDate(l.created_at)}</td>
                        <td className="px-4 py-3">{l.user?.full_name ?? "Sistema"}</td>
                        <td className="px-4 py-3 text-xs">
                          <span className="rounded bg-ink/5 px-2 py-0.5 font-mono">{l.table_name.replace("pricing_","")}</span>
                          <span className="ml-2 text-ink/50">{String(itemName)}</span>
                        </td>
                        <td className="px-4 py-3">
                          <span className={cn("rounded-full px-2 py-0.5 text-xs font-bold",
                            l.operation === "INSERT" ? "bg-emerald-50 text-emerald-700" :
                            l.operation === "DELETE" ? "bg-red-50 text-red-700" :
                            "bg-amber-50 text-amber-700")}>
                            {l.operation === "INSERT" ? "Criou" : l.operation === "DELETE" ? "Excluiu" : "Editou"}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-ink/50">{oldKey && l.old_data ? money(Number(l.old_data[oldKey]))+"/m" : "—"}</td>
                        <td className="px-4 py-3 font-semibold">{newKey && l.new_data ? money(Number(l.new_data[newKey]))+"/m" : "—"}</td>
                      </tr>
                    );
                  })}
                  {!logs.length && (
                    <tr><td colSpan={6} className="p-10 text-center text-ink/40">Nenhuma alteração registrada ainda.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
          {logs.length > 0 && <p className="text-right text-xs text-ink/40">{logs.length} registro{logs.length !== 1 ? "s" : ""}</p>}
        </div>
      )}
    </div>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────────────
function SearchBar({ q, selfHref, tab, placeholder }: { q?: string; selfHref: string; tab: string; placeholder: string }) {
  return (
    <form className="relative max-w-sm" action={selfHref}>
      <input type="hidden" name="aba" value={tab} />
      <Search className="absolute left-3 top-3 h-4 w-4 text-ink/35" />
      <input className="field pl-9" name="q" defaultValue={q} placeholder={placeholder} />
    </form>
  );
}

function PricingTable<T extends { id: string; active: boolean }>({
  headers, rows, empty, renderEdit, renderRead, canManage,
}: {
  headers: string[];
  rows: T[];
  empty: string;
  renderEdit: (row: T) => React.ReactNode;
  renderRead: (row: T) => React.ReactNode;
  canManage: boolean;
}) {
  return (
    <div className="card overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[600px] text-left text-sm">
          <thead className="bg-cream/70 text-[11px] uppercase tracking-wider text-ink/45">
            <tr>
              {headers.map(h => <th key={h} className="px-4 py-3">{h}</th>)}
              {canManage && <th className="px-4 py-3" />}
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.map(row => (
              <tr key={row.id} className={cn("transition hover:bg-cream/30", !row.active && "opacity-40")}>
                <td colSpan={headers.length + (canManage ? 1 : 0)}>
                  {canManage ? renderEdit(row) : renderRead(row)}
                </td>
              </tr>
            ))}
            {!rows.length && (
              <tr><td colSpan={headers.length + (canManage ? 1 : 0)} className="p-10 text-center text-ink/40">{empty}</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ReadCells({ cells, bold = [] }: { cells: (string|number)[]; bold?: number[] }) {
  return (
    <div className="flex items-center gap-4 px-4 py-3">
      {cells.map((c, i) => (
        <span key={i} className={cn("flex-1", bold.includes(i) ? "font-black" : "text-ink/65")}>{c}</span>
      ))}
    </div>
  );
}

function RowActions({ deleteAction }: { deleteAction: (fd: FormData) => Promise<void> }) {
  return (
    <div className="flex gap-1">
      <button title="Salvar" className="button-ghost p-1.5"><Save className="h-3.5 w-3.5" /></button>
      <ConfirmButton formAction={deleteAction} className="button-ghost p-1.5 text-red-600 hover:bg-red-50"><Trash2 className="h-3.5 w-3.5" /></ConfirmButton>
    </div>
  );
}
