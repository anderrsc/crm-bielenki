// ─── Categorias de orçamento ──────────────────────────────────────────────────
export const FABRICATED_CATEGORIES = ["Calhas", "Rufos", "Pingadeiras"] as const;
export const OTHER_CATEGORIES = ["Condutores", "Acessórios", "Serviços", "Itens Especiais"] as const;
export const ALL_QUOTE_CATEGORIES = [...FABRICATED_CATEGORIES, ...OTHER_CATEGORIES] as const;
export type FabricatedCategory = typeof FABRICATED_CATEGORIES[number];
export type OtherCategory = typeof OTHER_CATEGORIES[number];
export type QuoteCategory = typeof ALL_QUOTE_CATEGORIES[number];

// ─── Produtos por categoria ───────────────────────────────────────────────────
export const PRODUCTS_BY_CATEGORY: Record<QuoteCategory, string[]> = {
  "Calhas": [
    "Calha de Beiral",
    "Calha Platibanda",
    "Calha Coletora",
    "Calha de Meio (Cocho)",
    "Calha Água Furtada",
    "Calha Moldura",
    "Calha Quadrada",
  ],
  "Rufos": [
    "Rufo",
    "Rufo Externo",
    "Rufo Interno",
    "Rufo de Marquise",
    "Rufo com Pingadeira",
    "Rufo Chapéu",
    "Rufo de Acabamento",
    "Rufo de Cumeeira",
    "Rufo Sobre Calha",
    "Rufo para Chaminé",
  ],
  "Pingadeiras": [
    "Pingadeira",
    "Pingadeira com Rufo",
    "Pingadeira Dupla",
    "Pingadeira para Muro",
    "Pingadeira de Marquise",
  ],
  "Condutores": [
    "Condutor de PVC Redondo 75mm",
    "Condutor de PVC Redondo 100mm",
    "Condutor Retangular em Alumínio",
    "Condutor Quadrado em Alumínio",
    "Curva para Condutor",
    "Joelho para Condutor",
    "Saída/Bocal para Condutor",
  ],
  "Acessórios": [
    "Par de Cabeceira",
    "Suporte Interno U",
    "Suporte Externo (Gancho)",
    "Bocal de Saída",
    "Curva",
    "Cinto de Amarração de Condutor",
    "Fixadores",
    "Rebites",
    "Silicone Neutro",
    "Tubo Vedante PU MS40",
  ],
  "Serviços": [
    "Mão de Obra para Instalação de Calhas",
    "Mão de Obra para Instalação de Rufos",
    "Mão de Obra para Instalação de Pingadeiras",
    "Mão de Obra para Limpeza de Calhas",
    "Mão de Obra para Manutenção de Calhas",
    "Mão de Obra para Vedação com PU",
    "Mão de Obra para Troca de Calhas",
    "Mão de Obra para Troca de Rufos",
    "Mão de Obra e Materiais para Pintura de Calhas",
    "Mão de Obra de Manutenção",
    "Mão de Obra de Abertura e Fechamento de Telhado",
    "Deslocamento",
    "Frete",
  ],
  "Itens Especiais": [
    "Coifa em Alumínio",
    "Chaminé em Alumínio Ø300mm",
    "Chaminé em Alumínio Ø250mm",
    "Chaminé em Alumínio Ø400mm",
    "Chaminé em Alumínio Ø500mm",
    "Exaustor Eólico",
    "Coifa Interna em Alumínio",
    "Duto Especial",
    "Chaminé em Inox 304 Ø150mm",
    "Peça Sob Medida",
    "Corte e Dobra Especial",
  ],
};

// Lista plana de todos os produtos de fabricação própria (para autocomplete)
export const gutterProducts: string[] = [
  ...PRODUCTS_BY_CATEGORY["Calhas"],
  ...PRODUCTS_BY_CATEGORY["Rufos"],
  ...PRODUCTS_BY_CATEGORY["Pingadeiras"],
];

// ─── Espessuras, cortes, cores ────────────────────────────────────────────────
export const gutterThicknesses = ["0.5mm", "0.6mm", "0.7mm", "1.0mm"];

export const gutterCuts = [150, 200, 250, 300, 330, 350, 400, 500, 600, 700, 800, 900, 1000, 1200];

export const gutterColors = [
  "Aluminio Natural",
  "Pintura Branco",
  "Galvanizado Branco",
  "Pintura Preto",
  "Galvanizado Preto",
  "Pintura Marrom",
  "Pintura Cinza",
  "Pintura Personalizado",
];

// ─── Unidades por categoria ───────────────────────────────────────────────────
export const UNITS_BY_CATEGORY: Record<OtherCategory, string[]> = {
  "Condutores": ["metro", "unidade", "peça"],
  "Acessórios": ["peça", "unidade", "tubo", "caixa"],
  "Serviços": ["metro", "unidade", "hora", "serviço", "diária"],
  "Itens Especiais": ["unidade", "peça", "serviço", "metro"],
};

// ─── Tipos ────────────────────────────────────────────────────────────────────
export type GutterPrice = {
  id: string;
  product: string;
  thickness: string;
  cut_mm: number;
  color: string | null;
  unit_price: number;
  notes: string | null;
  active: boolean;
};

export type QuoteClient = {
  id: string;
  name: string;
  phone?: string | null;
  city?: string | null;
};

// ─── Aliases e helpers para pricing-spreadsheet e gutter-prices-page ─────────
export const gutterFabricationCategories = FABRICATED_CATEGORIES;
export const gutterSpecialCategories = OTHER_CATEGORIES;
export const gutterCategories = ALL_QUOTE_CATEGORIES;
export const gutterProductsByCategory = PRODUCTS_BY_CATEGORY;
export const gutterFabricationProducts = FABRICATED_CATEGORIES.flatMap((c) => [...PRODUCTS_BY_CATEGORY[c]]);

export const gutterPricingUnits = [
  "Metro Linear (m)",
  "Metro",
  "Unidade",
  "Peça",
  "Tubo",
  "Caixa",
  "Hora",
  "Serviço",
  "Diária",
];

const ascii = (v: string) => v.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export function gutterCategoryForProduct(product?: string | null): QuoteCategory {
  const p = ascii(String(product ?? ""));
  for (const category of ALL_QUOTE_CATEGORIES) {
    if (PRODUCTS_BY_CATEGORY[category].some((name) => ascii(name) === p)) return category;
  }
  if (p.includes("rufo")) return "Rufos";
  if (p.includes("pingadeira")) return "Pingadeiras";
  if (p.includes("condutor") || p.includes("joelho") || p.includes("bocal")) return "Condutores";
  if (p.includes("mao de obra") || p.includes("frete") || p.includes("deslocamento")) return "Serviços";
  if (p.includes("coifa") || p.includes("chamine") || p.includes("duto")) return "Itens Especiais";
  if (p.includes("suporte") || p.includes("rebite") || p.includes("silicone") || p.includes("vedante")) return "Acessórios";
  return "Calhas";
}

export function gutterItemTypeForCategory(category?: string | null): string {
  if (category === "Serviços") return "servico";
  if (category === "Acessórios" || category === "Itens Especiais") return "item_especial";
  if (category === "Condutores") return "condutor";
  return "fabricacao";
}

export function isFabricationCategory(category?: string | null): boolean {
  return FABRICATED_CATEGORIES.includes((category || "") as FabricatedCategory);
}

export function isPvcCondutor(product?: string | null): boolean {
  return ascii(String(product ?? "")).includes("pvc");
}

export function isAluminumCondutor(product?: string | null): boolean {
  return ascii(String(product ?? "")).includes("aluminio");
}

export function normalizeGutterThickness(value?: string | null): string {
  const raw = String(value ?? "").replace(",", ".").replace(/\s/g, "").toLowerCase();
  if (raw === "0.5mm" || raw === "0.50mm") return "0.50 mm";
  if (raw === "0.6mm" || raw === "0.60mm") return "0.60 mm";
  if (raw === "0.7mm" || raw === "0.70mm") return "0.70 mm";
  if (raw === "1.0mm" || raw === "1.00mm" || raw === "1mm") return "1.00 mm";
  return value ?? "";
}

export function normalizeGutterColor(value?: string | null): string {
  const raw = ascii(String(value ?? ""));
  if (!raw || raw === "natural" || raw === "aluminio natural") return "Aluminio Natural";
  if (raw === "branco") return "Pintura Branco";
  if (raw === "preto") return "Pintura Preto";
  if (raw === "marrom") return "Pintura Marrom";
  if (raw === "cinza") return "Pintura Cinza";
  if (raw.includes("personaliz")) return "Pintura Personalizado";
  return value ?? "";
}
