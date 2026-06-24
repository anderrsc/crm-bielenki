import Link from "next/link";
import { ArrowLeft, LockKeyhole, Plus, Save, Trash2 } from "lucide-react";
import { deleteGutterPrice, saveGutterPrice } from "@/app/(crm)/actions";
import { gutterColors, gutterCuts, gutterFabricationProducts, gutterThicknesses, type GutterPrice } from "@/lib/gutters";
import { createClient } from "@/lib/supabase/server";
import { money } from "@/lib/utils";

export async function GutterPricesPage({ error, saved }: { error?: string; saved?: boolean }) {
  let prices: GutterPrice[] = [];
  let loadError = "";
  let canView = false;
  let canManage = false;

  if (process.env.NEXT_PUBLIC_SUPABASE_URL) {
    const db = await createClient();
    const [viewPermission, editPermission, result] = await Promise.all([
      db.rpc("has_table_access", { resource: "gutter_prices", action: "select" }),
      db.rpc("has_table_access", { resource: "gutter_prices", action: "update" }),
      db
        .from("gutter_prices")
        .select("id,product,category,item_type,thickness,cut_mm,unit,color,unit_price,install_price,notes,active")
        .order("product")
        .order("thickness")
        .order("cut_mm"),
    ]);
    canView = Boolean(viewPermission.data);
    canManage = Boolean(editPermission.data);
    prices = (result.data as GutterPrice[]) ?? [];
    loadError = result.error?.message ?? viewPermission.error?.message ?? "";
  }

  if (process.env.NEXT_PUBLIC_SUPABASE_URL && !canView && !loadError) {
    return (
      <div className="card mx-auto max-w-xl p-10 text-center">
        <LockKeyhole className="mx-auto h-8 w-8 text-ink/25" />
        <h1 className="mt-4 text-2xl font-black">Acesso restrito</h1>
        <p className="mt-2 text-sm text-ink/50">Seu perfil não possui permissão para visualizar preços de calhas.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl">
      <Link href="/configuracoes" className="mb-5 inline-flex items-center gap-2 text-sm font-bold text-ink/55">
        <ArrowLeft className="h-4 w-4" />
        Voltar
      </Link>
      <div className="mb-7 flex items-end justify-between gap-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-[.22em] text-forest">Precificação real</p>
          <h1 className="mt-2 text-3xl font-black">Tabela de preços de calhas</h1>
          <p className="mt-1 text-sm text-ink/50">Preço por metro conforme produto, espessura, C/ e cor.</p>
        </div>
        {!canManage && <span className="rounded-full bg-blue-50 px-3 py-1.5 text-xs font-bold text-blue-700">Somente leitura</span>}
      </div>

      {(error || loadError) && <p className="mb-5 rounded-xl bg-red-50 p-4 text-sm text-red-700">{error || loadError}</p>}
      {saved && <p className="mb-5 rounded-xl bg-emerald-50 p-4 text-sm text-emerald-700">Preço salvo e disponível na calculadora.</p>}
      {canManage && (
        <details className="card mb-5">
          <summary className="flex cursor-pointer list-none items-center gap-2 p-5 font-black">
            <Plus className="h-4 w-4" />
            Adicionar preço
          </summary>
          <PriceForm />
        </details>
      )}

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[950px] text-left text-sm">
            <thead className="bg-cream/70 text-[11px] uppercase tracking-wider text-ink/45">
              <tr>
                <th className="p-4">Produto</th>
                <th className="p-4">Espessura</th>
                <th className="p-4">C/</th>
                <th className="p-4">Cor</th>
                <th className="p-4">Preço / metro</th>
                <th className="p-4">Observação</th>
                <th className="p-4">Ativo</th>
                {canManage && <th className="p-4" />}
              </tr>
            </thead>
            <tbody className="divide-y">
              {prices.map((price) => (canManage ? <EditableRow price={price} key={price.id} /> : <ReadOnlyRow price={price} key={price.id} />))}
              {!prices.length && (
                <tr>
                  <td className="p-10 text-center text-ink/45" colSpan={8}>
                    Nenhum preço cadastrado.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      {prices.length > 0 && <p className="mt-3 text-right text-xs text-ink/40">{prices.length} combinações cadastradas</p>}
    </div>
  );
}

function EditableRow({ price }: { price: GutterPrice }) {
  return (
    <tr>
      <td colSpan={8}>
        <form action={saveGutterPrice} className="grid grid-cols-[1.4fr_1fr_.7fr_.9fr_.8fr_1.4fr_.4fr_auto] items-center gap-2 p-3">
          <input type="hidden" name="id" value={price.id} />
          <select className="field" name="product" defaultValue={price.product}>
            {gutterFabricationProducts.map((product) => (
              <option key={product}>{product}</option>
            ))}
          </select>
          <select className="field" name="thickness" defaultValue={price.thickness ?? gutterThicknesses[0]}>
            {gutterThicknesses.map((thickness) => (
              <option key={thickness}>{thickness}</option>
            ))}
          </select>
          <select className="field" name="cut_mm" defaultValue={price.cut_mm ?? gutterCuts[0]}>
            {gutterCuts.map((cut) => (
              <option value={cut} key={cut}>
                {cut} mm
              </option>
            ))}
          </select>
          <select className="field" name="color" defaultValue={price.color ?? gutterColors[0]}>
            {gutterColors.map((color) => (
              <option key={color}>{color}</option>
            ))}
          </select>
          <input className="field" name="unit_price" type="number" step="0.01" min="0" defaultValue={price.unit_price} />
          <input className="field" name="notes" defaultValue={price.notes ?? ""} />
          <input className="h-5 w-5 accent-forest" name="active" type="checkbox" defaultChecked={price.active} />
          <div className="flex gap-1">
            <button title="Salvar" className="button-ghost p-2">
              <Save className="h-4 w-4" />
            </button>
            <button title="Excluir" formAction={deleteGutterPrice} className="button-ghost p-2 text-red-600">
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        </form>
      </td>
    </tr>
  );
}

function ReadOnlyRow({ price }: { price: GutterPrice }) {
  return (
    <tr>
      <td className="p-4 font-bold">{price.product}</td>
      <td className="p-4">{price.thickness ?? "-"}</td>
      <td className="p-4">{price.cut_mm ? `${price.cut_mm} mm` : "-"}</td>
      <td className="p-4">{price.color ?? "-"}</td>
      <td className="p-4 font-black">{money(price.unit_price)}/m</td>
      <td className="p-4 text-ink/50">{price.notes || "-"}</td>
      <td className="p-4">{price.active ? "Sim" : "Não"}</td>
    </tr>
  );
}

function PriceForm() {
  return (
    <form action={saveGutterPrice} className="grid gap-4 border-t p-5 sm:grid-cols-2 lg:grid-cols-4">
      <div>
        <label className="label">Produto</label>
        <select className="field" name="product">
          {gutterFabricationProducts.map((product) => (
            <option key={product}>{product}</option>
          ))}
        </select>
      </div>
      <div>
        <label className="label">Espessura</label>
        <select className="field" name="thickness">
          {gutterThicknesses.map((thickness) => (
            <option key={thickness}>{thickness}</option>
          ))}
        </select>
      </div>
      <div>
        <label className="label">C/</label>
        <select className="field" name="cut_mm">
          {gutterCuts.map((cut) => (
            <option value={cut} key={cut}>
              {cut} mm
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="label">Cor</label>
        <select className="field" name="color">
          {gutterColors.map((color) => (
            <option key={color}>{color}</option>
          ))}
        </select>
      </div>
      <div>
        <label className="label">Preço por metro</label>
        <input className="field" type="number" name="unit_price" min="0" step="0.01" required />
      </div>
      <div className="sm:col-span-2 lg:col-span-2">
        <label className="label">Observação</label>
        <input className="field" name="notes" />
      </div>
      <label className="flex items-center gap-2 self-end pb-3 text-sm font-bold">
        <input className="h-4 w-4 accent-forest" name="active" type="checkbox" defaultChecked />
        Preço ativo
      </label>
      <button className="button sm:col-span-2 lg:col-span-4">
        <Save className="h-4 w-4" />
        Salvar preço
      </button>
    </form>
  );
}
