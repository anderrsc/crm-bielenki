"use client";

import { useRef, useState, useCallback, useTransition } from "react";
import {
  Upload, X, AlignLeft, AlignCenter, AlignRight, Save,
  Eye, RotateCcw, Maximize2, ImagePlus, Check
} from "lucide-react";
import { saveLogoSettings, uploadLogo, removeLogo } from "@/app/(crm)/identity-actions";

/* ─── Tipos ──────────────────────────────────────────────────────────────── */
export type LogoConfig = {
  logo_url?: string | null;
  logo_width?: number | null;
  logo_max_height?: number | null;
  logo_align?: "left" | "center" | "right" | null;
  logo_margin_top?: number | null;
  logo_margin_bottom?: number | null;
  primary_color?: string | null;
  trade_name?: string | null;
  name?: string | null;
  tax_id?: string | null;
  phone?: string | null;
  whatsapp?: string | null;
  email?: string | null;
  website?: string | null;
  address?: string | null;
  neighborhood?: string | null;
  city?: string | null;
  state?: string | null;
  quote_footer?: string | null;
};

type Preview = "orcamento" | "ficha";

/* ─── Constantes ─────────────────────────────────────────────────────────── */
const A4_W_PX = 400;           // largura do preview em px
const A4_H_PX = 566;           // 297/210 × 400
const A4_SCALE = A4_W_PX / 210; // px por mm (≈1.905)

/* ─── Componente principal ───────────────────────────────────────────────── */
export function CompanyIdentityEditor({ company }: { company: LogoConfig }) {
  const [logoUrl, setLogoUrl] = useState(company.logo_url ?? null);
  const [width, setWidth] = useState(company.logo_width ?? 80);
  const [maxHeight, setMaxHeight] = useState(company.logo_max_height ?? 60);
  const [align, setAlign] = useState<"left" | "center" | "right">(company.logo_align ?? "left");
  const [marginTop, setMarginTop] = useState(company.logo_margin_top ?? 0);
  const [marginBottom, setMarginBottom] = useState(company.logo_margin_bottom ?? 0);
  const [previewType, setPreviewType] = useState<Preview>("orcamento");
  const [uploading, setUploading] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [isPending, startTransition] = useTransition();

  const fileRef = useRef<HTMLInputElement>(null);
  const red = company.primary_color || "#D71920";
  const tradeName = company.trade_name || "Marquinhos Calhas e Esquadrias";
  const compAddr = [company.address, company.neighborhood, company.city, company.state].filter(Boolean).join(" — ");

  /* Upload */
  const handleFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 3 * 1024 * 1024) { setError("Arquivo muito grande. Máx. 3 MB."); return; }

    // Preview imediato
    const reader = new FileReader();
    reader.onload = ev => setLogoUrl(ev.target?.result as string);
    reader.readAsDataURL(file);

    setUploading(true);
    setError("");
    const fd = new FormData();
    fd.append("logo", file);
    const result = await uploadLogo(fd);
    setUploading(false);
    if (result?.error) { setError(result.error); return; }
    if (result?.url) setLogoUrl(result.url);
  }, []);

  /* Remover */
  const handleRemove = useCallback(async () => {
    setLogoUrl(null);
    startTransition(async () => {
      await removeLogo();
    });
  }, []);

  /* Salvar configurações */
  const handleSave = useCallback(() => {
    setError("");
    setSaved(false);
    startTransition(async () => {
      const result = await saveLogoSettings({ width, maxHeight, align, marginTop, marginBottom });
      if (result?.error) { setError(result.error); return; }
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    });
  }, [width, maxHeight, align, marginTop, marginBottom]);

  /* ── Logo px para preview (A4_SCALE ≈ 1.905 px/mm) ── */
  const previewLogoW = Math.round(width * A4_SCALE);
  const previewLogoH = Math.round(maxHeight * A4_SCALE);

  return (
    <div className="mx-auto max-w-6xl space-y-8">
      <div>
        <p className="text-xs font-bold uppercase tracking-[.22em] text-forest">Identidade Visual</p>
        <h1 className="mt-1 text-3xl font-black">Logo e Templates</h1>
        <p className="mt-1 text-sm text-ink/50">Configure a logo, posição e aparência nos documentos.</p>
      </div>

      {error && <p className="rounded-xl bg-red-50 p-4 text-sm text-red-700">{error}</p>}
      {saved && <p className="rounded-xl bg-emerald-50 p-4 text-sm text-emerald-700 flex items-center gap-2"><Check className="h-4 w-4" /> Configurações salvas com sucesso.</p>}

      <div className="grid gap-8 lg:grid-cols-[380px_1fr]">

        {/* ── Coluna esquerda: controles ── */}
        <div className="space-y-6">

          {/* Upload da logo */}
          <div className="card p-6 space-y-4">
            <h2 className="font-black text-lg">Logo da empresa</h2>

            {/* Preview da logo */}
            <div
              className="relative flex items-center justify-center rounded-xl border-2 border-dashed border-sand bg-cream cursor-pointer hover:border-forest transition-colors"
              style={{ minHeight: 140 }}
              onClick={() => fileRef.current?.click()}
            >
              {logoUrl ? (
                <>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={logoUrl} alt="Logo" className="max-h-[120px] max-w-[260px] object-contain p-4" />
                  {uploading && (
                    <div className="absolute inset-0 flex items-center justify-center rounded-xl bg-white/80">
                      <div className="h-8 w-8 animate-spin rounded-full border-4 border-forest border-t-transparent" />
                    </div>
                  )}
                </>
              ) : (
                <div className="flex flex-col items-center gap-2 py-8 text-ink/40">
                  <ImagePlus className="h-10 w-10" />
                  <p className="text-sm font-medium">Clique para enviar logo</p>
                  <p className="text-xs">PNG, JPG, WebP, SVG — até 3 MB</p>
                </div>
              )}
            </div>

            <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" className="hidden" onChange={handleFileChange} />

            <div className="flex gap-2">
              <button onClick={() => fileRef.current?.click()} disabled={uploading}
                className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-sand bg-white py-2 text-sm font-semibold hover:bg-cream disabled:opacity-50">
                <Upload className="h-4 w-4" /> {logoUrl ? "Trocar logo" : "Enviar logo"}
              </button>
              {logoUrl && (
                <button onClick={handleRemove}
                  className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700 hover:bg-red-100">
                  <X className="h-4 w-4" /> Remover
                </button>
              )}
            </div>
          </div>

          {/* Controles de posição e tamanho */}
          <div className="card p-6 space-y-5">
            <h2 className="font-black text-lg">Posição e tamanho</h2>

            <div>
              <div className="mb-2 flex items-center justify-between">
                <label className="label mb-0">Largura da logo</label>
                <span className="text-sm font-bold text-forest">{width} mm</span>
              </div>
              <input type="range" min={15} max={80} value={width} onChange={e => setWidth(Number(e.target.value))}
                className="w-full accent-forest" />
              <div className="flex justify-between text-xs text-ink/35 mt-1"><span>15 mm</span><span>80 mm</span></div>
            </div>

            <div>
              <div className="mb-2 flex items-center justify-between">
                <label className="label mb-0">Altura máxima</label>
                <span className="text-sm font-bold text-forest">{maxHeight} mm</span>
              </div>
              <input type="range" min={10} max={60} value={maxHeight} onChange={e => setMaxHeight(Number(e.target.value))}
                className="w-full accent-forest" />
              <div className="flex justify-between text-xs text-ink/35 mt-1"><span>10 mm</span><span>60 mm</span></div>
            </div>

            <div>
              <label className="label">Alinhamento</label>
              <div className="flex gap-2">
                {([
                  { v: "left",   icon: AlignLeft,   label: "Esquerda" },
                  { v: "center", icon: AlignCenter,  label: "Centro" },
                  { v: "right",  icon: AlignRight,   label: "Direita" },
                ] as const).map(({ v, icon: Icon, label }) => (
                  <button key={v} onClick={() => setAlign(v)}
                    className={`flex flex-1 items-center justify-center gap-1.5 rounded-xl border py-2.5 text-sm font-semibold transition-colors ${align === v ? "border-forest bg-lime/20 text-forest" : "border-sand bg-white text-ink/60 hover:bg-cream"}`}>
                    <Icon className="h-4 w-4" /> {label}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="label">Espaço acima (mm)</label>
                <input type="number" min={0} max={30} value={marginTop} onChange={e => setMarginTop(Number(e.target.value))}
                  className="field" />
              </div>
              <div>
                <label className="label">Espaço abaixo (mm)</label>
                <input type="number" min={0} max={30} value={marginBottom} onChange={e => setMarginBottom(Number(e.target.value))}
                  className="field" />
              </div>
            </div>

            <button onClick={handleSave} disabled={isPending}
              className="button w-full flex items-center justify-center gap-2">
              <Save className="h-4 w-4" />
              {isPending ? "Salvando..." : "Salvar configurações"}
            </button>
          </div>
        </div>

        {/* ── Coluna direita: preview A4 ── */}
        <div className="space-y-4">
          {/* Seletor de preview */}
          <div className="flex gap-2">
            <p className="flex items-center gap-2 text-sm font-bold text-ink/50 mr-2"><Eye className="h-4 w-4" /> Prévia:</p>
            {([
              { v: "orcamento", label: "Orçamento" },
              { v: "ficha",     label: "Ficha de Medição" },
            ] as const).map(({ v, label }) => (
              <button key={v} onClick={() => setPreviewType(v)}
                className={`rounded-xl border px-4 py-1.5 text-sm font-semibold transition-colors ${previewType === v ? "border-forest bg-forest text-white" : "border-sand bg-white text-ink/60 hover:bg-cream"}`}>
                {label}
              </button>
            ))}
          </div>

          {/* A4 preview */}
          <div className="overflow-hidden rounded-2xl border-2 border-sand shadow-xl" style={{ width: A4_W_PX + 4 }}>
            {/* Header da prévia */}
            <div className="flex items-center gap-2 border-b bg-cream px-4 py-2">
              <Maximize2 className="h-3.5 w-3.5 text-ink/40" />
              <span className="text-xs font-bold text-ink/40">
                Pré-visualização A4 — {previewType === "orcamento" ? "Orçamento" : "Ficha de Medição"}
              </span>
            </div>

            {/* Folha A4 */}
            <div
              style={{
                width: A4_W_PX,
                minHeight: A4_H_PX,
                background: "white",
                fontFamily: "'Segoe UI', Inter, system-ui, sans-serif",
                padding: `${10 * A4_SCALE}px ${12 * A4_SCALE}px`,
                boxSizing: "border-box",
                fontSize: `${8.5 * A4_SCALE * 0.5}px`,
              }}
            >
              {/* Logo area */}
              <div style={{ marginTop: marginTop * A4_SCALE, marginBottom: 4 }}>
                <div style={{
                  display: "flex",
                  justifyContent: align === "center" ? "center" : align === "right" ? "flex-end" : "flex-start",
                }}>
                  {logoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={logoUrl} alt="Logo"
                      style={{ width: previewLogoW, maxHeight: previewLogoH, objectFit: "contain" }} />
                  ) : (
                    <div style={{
                      width: previewLogoW, height: previewLogoH * 0.7,
                      background: red, borderRadius: 3,
                      display: "flex", alignItems: "center", justifyContent: "center",
                    }}>
                      <span style={{ color: "#fff", fontWeight: 900, fontSize: 12 }}>LOGO</span>
                    </div>
                  )}
                </div>
                <div style={{ height: marginBottom * A4_SCALE }} />
              </div>

              {/* Separador */}
              <div style={{ height: 2, background: red, margin: `${2 * A4_SCALE}px 0` }} />

              {previewType === "orcamento" ? (
                <OrcamentoPreview tradeName={tradeName} company={company} a4Scale={A4_SCALE} red={red} />
              ) : (
                <FichaPreview tradeName={tradeName} company={company} a4Scale={A4_SCALE} red={red} />
              )}
            </div>
          </div>

          <p className="text-xs text-ink/40 text-center">
            Esta prévia representa ~57% do tamanho real do A4. O documento impresso terá proporções exatas.
          </p>
        </div>
      </div>
    </div>
  );
}

/* ─── Prévia: Orçamento ──────────────────────────────────────────────────── */
function OrcamentoPreview({ tradeName, company, a4Scale, red }: { tradeName: string; company: LogoConfig; a4Scale: number; red: string }) {
  const s = (mm: number) => mm * a4Scale;
  const fs = (pt: number) => `${pt * a4Scale * 0.45}px`;
  const compAddr = [company.address, company.neighborhood, company.city, company.state].filter(Boolean).join(" — ");

  return (
    <div style={{ fontSize: fs(8) }}>
      {/* Cabeçalho empresa */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: s(3), marginBottom: s(3) }}>
        <div>
          <p style={{ fontSize: fs(12), fontWeight: 900, color: "#111", lineHeight: 1.1, margin: `0 0 ${s(0.8)}px` }}>{tradeName}</p>
          {company.name && company.name !== tradeName && <p style={{ color: "#555", margin: `0 0 ${s(0.6)}px` }}>{company.name}</p>}
          {company.tax_id && <p style={{ color: "#555", margin: 0 }}>CNPJ {company.tax_id}</p>}
          {compAddr && <p style={{ color: "#777", margin: 0, fontSize: fs(6.5) }}>{compAddr}</p>}
        </div>
        <div style={{ textAlign: "right", color: "#555", lineHeight: 1.8, fontSize: fs(7) }}>
          {company.whatsapp && <p>WhatsApp: {company.whatsapp}</p>}
          {company.phone && <p>{company.phone}</p>}
          {company.email && <p>{company.email}</p>}
        </div>
      </div>

      {/* "ORÇAMENTO" badge */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: s(3) }}>
        <div style={{ background: red, color: "#fff", padding: `${s(1.5)}px ${s(3)}px`, borderRadius: s(1.5), fontWeight: 900, fontSize: fs(11), letterSpacing: "0.1em" }}>ORÇAMENTO</div>
        <div style={{ textAlign: "right", fontSize: fs(7), color: "#666" }}>
          <p style={{ fontWeight: 700 }}>Nº 00001</p>
          <p>Validade: 01/07/2026</p>
        </div>
      </div>

      {/* Cliente */}
      <div style={{ background: "#f8f8f8", borderRadius: s(1.5), padding: `${s(2)}px ${s(3)}px`, marginBottom: s(3) }}>
        <p style={{ fontWeight: 700, color: "#888", fontSize: fs(6.5), letterSpacing: "0.1em", textTransform: "uppercase", margin: `0 0 ${s(1)}px` }}>CLIENTE</p>
        <p style={{ fontWeight: 700, fontSize: fs(9), margin: 0 }}>João da Silva</p>
        <p style={{ color: "#666", fontSize: fs(7), margin: 0 }}>Bairro Centro — Passo Fundo / RS</p>
      </div>

      {/* Tabela de itens */}
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: fs(7), marginBottom: s(2) }}>
        <thead>
          <tr style={{ background: red, color: "#fff" }}>
            {["Produto", "Qt.", "Un.", "Valor unit.", "Total"].map(h => (
              <th key={h} style={{ padding: `${s(1.2)}px ${s(1.5)}px`, textAlign: h === "Produto" ? "left" : "right", fontWeight: 700 }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {["Calha Platibanda 0.43mm", "Rufo Simples", "Mão de Obra"].map((item, i) => (
            <tr key={i} style={{ background: i % 2 === 0 ? "#fff" : "#fafafa", borderBottom: "1px solid #f0f0f0" }}>
              <td style={{ padding: `${s(1)}px ${s(1.5)}px` }}>{item}</td>
              <td style={{ padding: `${s(1)}px ${s(1.5)}px`, textAlign: "right" }}>5</td>
              <td style={{ padding: `${s(1)}px ${s(1.5)}px`, textAlign: "right" }}>m</td>
              <td style={{ padding: `${s(1)}px ${s(1.5)}px`, textAlign: "right" }}>R$ 35,00</td>
              <td style={{ padding: `${s(1)}px ${s(1.5)}px`, textAlign: "right", fontWeight: 700 }}>R$ 175,00</td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Total */}
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <div style={{ background: "#f0f7f4", borderRadius: s(1.5), padding: `${s(1.5)}px ${s(3)}px`, textAlign: "right" }}>
          <p style={{ color: "#666", fontSize: fs(7), margin: `0 0 ${s(0.5)}px` }}>TOTAL</p>
          <p style={{ fontWeight: 900, fontSize: fs(13), color: "#111", margin: 0 }}>R$ 525,00</p>
        </div>
      </div>

      {/* Rodapé */}
      {company.quote_footer && (
        <p style={{ marginTop: s(3), color: "#999", fontSize: fs(6.5), borderTop: `1px solid #eee`, paddingTop: s(2) }}>
          {company.quote_footer}
        </p>
      )}
    </div>
  );
}

/* ─── Prévia: Ficha de Medição ───────────────────────────────────────────── */
function FichaPreview({ tradeName, company, a4Scale, red }: { tradeName: string; company: LogoConfig; a4Scale: number; red: string }) {
  const s = (mm: number) => mm * a4Scale;
  const fs = (pt: number) => `${pt * a4Scale * 0.45}px`;
  const compAddr = [company.address, company.neighborhood, company.city, company.state].filter(Boolean).join(" — ");

  return (
    <div>
      {/* Linha 1 de campos */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: s(2), marginBottom: s(2) }}>
        {["CLIENTE","TELEFONE","BAIRRO","CIDADE"].map(l => (
          <div key={l} style={{ background: "#f7f7f7", borderRadius: s(1.5), padding: `${s(2)}px ${s(2)}px`, minHeight: s(8) }}>
            <p style={{ fontSize: fs(5.5), fontWeight: 700, color: "#888", textTransform: "uppercase", letterSpacing: "0.1em", margin: `0 0 ${s(0.8)}px` }}>{l}</p>
            <div style={{ borderBottom: "1px solid #ccc", height: s(3) }} />
          </div>
        ))}
      </div>
      {/* Linha 2 de campos */}
      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr", gap: s(2), marginBottom: s(3) }}>
        {["ENDEREÇO","DISPONIBILIDADE","MEDIDOR"].map(l => (
          <div key={l} style={{ background: "#f7f7f7", borderRadius: s(1.5), padding: `${s(2)}px ${s(2)}px`, minHeight: s(8) }}>
            <p style={{ fontSize: fs(5.5), fontWeight: 700, color: "#888", textTransform: "uppercase", letterSpacing: "0.1em", margin: `0 0 ${s(0.8)}px` }}>{l}</p>
            <div style={{ borderBottom: "1px solid #ccc", height: s(3) }} />
          </div>
        ))}
      </div>
      {/* Área de anotações */}
      <div style={{
        border: "1px solid #e0e0e0", borderRadius: s(1.5),
        backgroundImage: "linear-gradient(to bottom,transparent 19px,#e8e8e8 20px)",
        backgroundSize: "100% 20px", height: s(150),
      }} />
    </div>
  );
}
