"""Regera os textos pequenos do logo Marquinhos para ficarem legiveis.

O logo original (public/brand/*.svg) e um vetor tracado de imagem: casa,
faixas e "Marquinhos" ficam como estao; "CALHAS E ESQUADRIAS" e
"INDUSTRIAIS E RESIDENCIAIS" eram contornos finos que somem no menu.
Este script troca esses contornos por texto em Inter Bold (fonte do sistema) convertido em
curvas (mesma caixa, traco mais grosso), nas quatro versoes do logo.

Uso: pip install fonttools && python3 scripts/gerar-logo.py
Os originais ficam em public/brand/original/ (sao a entrada do script).
"""
import re
from pathlib import Path

from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont

ROOT = Path(__file__).resolve().parent.parent
BRAND = ROOT / "public" / "brand"
FONT = TTFont(next((ROOT / "public" / "fonts").glob("UcCO3FwrK3iLTeHuS_nVMrMxCp50SjIw2boKoduKmMEVuFuYMZg.ttf")))
assert FONT["OS/2"].usWeightClass == 700, "esperado Inter Bold"
CMAP = FONT.getBestCmap()
GLYPHS = FONT.getGlyphSet()
CAP = FONT["OS/2"].sCapHeight

# Indices dos <path> do original (ordem do arquivo) que formam cada texto.
TOP_TEXT = range(16, 33)      # CALHAS E ESQUADRIAS
BOTTOM_TEXT = range(34, 58)   # INDUSTRIAIS E RESIDENCIAIS

# Caixa de cada texto no sistema de coordenadas do logo (viewBox 35 420 2340 800).
TEXTS = [
    # texto, x inicial, largura, linha de base, espacamento entre letras
    # (unidades da fonte), condensacao horizontal (1 = sem condensar)
    ("CALHAS E ESQUADRIAS", 537, 785, 792, 0, 0.84),
    ("INDUSTRIAIS E RESIDENCIAIS", 1138, 1211, 1198, 60, 1),
]


def text_path(text, x, width, baseline, tracking, condense):
    advances = [GLYPHS[CMAP[ord(c)]].width for c in text]
    raw_width = sum(advances) + tracking * (len(text) - 1)
    scale = width / (raw_width * condense)
    pen = SVGPathPen(GLYPHS)
    cursor = 0
    for char, advance in zip(text, advances):
        name = CMAP[ord(char)]
        # fonte: y para cima; SVG: y para baixo
        GLYPHS[name].draw(TransformPen(pen, (scale * condense, 0, 0, -scale, x + cursor * scale * condense, baseline)))
        cursor += advance + tracking
    return pen.getCommands(), CAP * scale


def rebuild(svg):
    paths = re.findall(r"<path[^>]*/>", svg)
    fill = re.search(r'fill="([^"]+)"', paths[TOP_TEXT[0]]).group(1)
    replacements = {}
    for (text, x, width, baseline, tracking, condense), indexes in zip(TEXTS, (TOP_TEXT, BOTTOM_TEXT)):
        d, cap = text_path(text, x, width, baseline, tracking, condense)
        for i in indexes:
            replacements[i] = ""
        replacements[indexes[0]] = f'<path fill="{fill}" aria-label="{text}" d="{d}"/>'
        print(f"  {text}: altura das maiusculas {cap:.0f}")
    out, i = [], 0
    for chunk in re.split(r"(<path[^>]*/>)", svg):
        if chunk.startswith("<path"):
            out.append(replacements.get(i, chunk))
            i += 1
        else:
            out.append(chunk)
    return "".join(out)


for source in sorted((BRAND / "original").glob("marquinhos-logo*.svg")):
    print(source.name)
    (BRAND / source.name).write_text(rebuild(source.read_text()))
