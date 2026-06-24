export const gutterFabricationCategories = ["Calhas", "Rufos", "Pingadeiras"] as const;
export const gutterSpecialCategories = ["Condutores", "Acessórios", "Serviços", "Itens Especiais"] as const;
export const gutterCategories = [...gutterFabricationCategories, ...gutterSpecialCategories] as const;

export const gutterProductsByCategory = {
  Calhas: [
    "Calha de Beiral",
    "Calha Platibanda",
    "Calha Coletora",
    "Calha de Meio (Cocho)",
    "Calha Água Furtada",
    "Calha Moldura",
    "Calha Quadrada",
  ],
  Rufos: [
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
  Pingadeiras: [
    "Pingadeira",
    "Pingadeira com Rufo",
    "Pingadeira Dupla",
    "Pingadeira para Muro",
    "Pingadeira de Marquise",
  ],
  Condutores: [
    "Condutor de PVC Redondo 75 mm",
    "Condutor de PVC Redondo 100 mm",
    "Condutor Retangular em Alumínio",
    "Condutor Quadrado em Alumínio",
    "Curva para Condutor",
    "Joelho para Condutor",
    "Saída/Bocal para Condutor",
  ],
  Acessórios: [
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
  Serviços: [
    "Mão de Obra para Instalação de Calhas",
    "Mão de Obra para Instalação de Rufos",
    "Mão de Obra para Instalação de Pingadeiras",
    "Mão de Obra para Limpeza de Calhas",
    "Mão de Obra para Manutenção de Calhas",
    "Mão de Obra para Vedação com PU",
    "Mão de Obra para Troca de Calhas",
    "Mão de Obra para Troca de Rufos",
    "Mão de Obra e Materiais para Pintura de Calhas",
    "Deslocamento",
    "Frete",
    "Mão de Obra de Manutenção",
    "Mão de Obra de Abertura e Fechamento de Telhado",
  ],
  "Itens Especiais": [
    "Coifa em Alumínio",
    "Chaminé em Alumínio Ø300 mm",
    "Chaminé em Alumínio Ø250 mm",
    "Chaminé em Alumínio Ø400 mm",
    "Chaminé em Alumínio Ø500 mm",
    "Exaustor Eólico",
    "Coifa Interna em Alumínio",
    "Duto Especial",
    "Chaminé em Inox 304 Ø150 mm",
    "Peça Sob Medida",
    "Corte e Dobra Especial",
  ],
} as const;

export const gutterProducts = gutterCategories.flatMap((category) => [...gutterProductsByCategory[category]]);
export const gutterFabricationProducts = gutterFabricationCategories.flatMap((category) => [...gutterProductsByCategory[category]]);

export const gutterThicknesses = ["0.50 mm", "0.60 mm", "0.70 mm", "1.00 mm"];
export const gutterCuts = [150, 200, 250, 300, 330, 350, 400, 500, 600, 700, 800, 900, 1000, 1200];
export const gutterCutOptions = gutterCuts.map((cut) => `C/ ${cut}`);
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

export const gutterAccessoryUnits = ["Peça", "Unidade", "Tubo", "Caixa"];
export const gutterServiceUnits = ["Metro", "Unidade", "Hora", "Serviço", "Diária"];
export const gutterCondutorUnits = ["Metro", "Unidade"];
export const gutterSpecialItemUnits = ["Unidade", "Metro", "Serviço"];
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

export const quoteBlockLabels = [
  "CALHAS",
  "RUFOS E PINGADEIRAS",
  "CONDUTORES E ACESSÓRIOS",
  "SERVIÇOS E ITENS ESPECIAIS",
] as const;

const ascii = (value: string) =>
  value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

export function normalizeGutterThickness(value?: string | null) {
  const raw = String(value ?? "").replace(",", ".").replace(/\s/g, "").toLowerCase();
  if (raw === "0.5mm" || raw === "0.50mm" || raw === "0.5") return "0.50 mm";
  if (raw === "0.6mm" || raw === "0.60mm" || raw === "0.6") return "0.60 mm";
  if (raw === "0.7mm" || raw === "0.70mm" || raw === "0.7") return "0.70 mm";
  if (raw === "1.0mm" || raw === "1.00mm" || raw === "1.0" || raw === "1") return "1.00 mm";
  return value ?? "";
}

export function normalizeGutterColor(value?: string | null) {
  const raw = ascii(String(value ?? ""));
  if (!raw || raw === "natural") return "Aluminio Natural";
  if (raw === "branco") return "Pintura Branco";
  if (raw === "preto") return "Pintura Preto";
  if (raw === "marrom") return "Pintura Marrom";
  if (raw === "cinza") return "Pintura Cinza";
  if (raw === "personalizada" || raw === "personalizado" || raw === "outra") return "Pintura Personalizado";
  return value ?? "";
}

export function gutterCategoryForProduct(product?: string | null) {
  const p = ascii(String(product ?? ""));
  for (const category of gutterCategories) {
    if (gutterProductsByCategory[category].some((name) => ascii(name) === p)) return category;
  }
  if (p.includes("rufo")) return "Rufos";
  if (p.includes("pingadeira")) return "Pingadeiras";
  if (p.includes("condutor") || p.includes("joelho") || p.includes("bocal")) return "Condutores";
  if (p.includes("mao de obra") || p.includes("frete") || p.includes("deslocamento")) return "Serviços";
  if (p.includes("coifa") || p.includes("chamine") || p.includes("duto")) return "Itens Especiais";
  if (p.includes("suporte") || p.includes("rebite") || p.includes("silicone") || p.includes("vedante")) return "Acessórios";
  return "Calhas";
}

export function gutterItemTypeForCategory(category?: string | null) {
  if (category === "Serviços") return "servico";
  if (category === "Acessórios" || category === "Itens Especiais") return "item_especial";
  if (category === "Condutores") return "condutor";
  return "fabricacao";
}

export function isFabricationCategory(category?: string | null) {
  return gutterFabricationCategories.includes((category || "") as typeof gutterFabricationCategories[number]);
}

export function isPvcCondutor(product?: string | null) {
  return ascii(String(product ?? "")).includes("pvc");
}

export function isAluminumCondutor(product?: string | null) {
  return ascii(String(product ?? "")).includes("aluminio");
}

export function quoteBlockForCategory(category?: string | null, product?: string | null) {
  const resolved = category || gutterCategoryForProduct(product);
  if (resolved === "Calhas") return "CALHAS";
  if (resolved === "Rufos" || resolved === "Pingadeiras") return "RUFOS E PINGADEIRAS";
  if (resolved === "Condutores" || resolved === "Acessórios") return "CONDUTORES E ACESSÓRIOS";
  return "SERVIÇOS E ITENS ESPECIAIS";
}

export type GutterPrice = {
  id: string;
  product: string;
  category?: string | null;
  item_type?: string | null;
  thickness?: string | null;
  cut_mm?: number | null;
  unit?: string | null;
  color: string | null;
  unit_price: number;
  install_price?: number | null;
  notes: string | null;
  active: boolean;
};

export type QuoteClient = { id: string; name: string; phone?: string | null; city?: string | null };
