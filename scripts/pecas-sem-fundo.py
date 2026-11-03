"""Remove o fundo branco das ilustracoes das pecas (public/catalogo/pecas).

So o branco ligado as bordas vira transparente (preenchimento a partir das
bordas), para nao apagar as faces claras do metal. Assim a peca fica bonita
tambem nas linhas cinza da tabela do orcamento.
Uso: pip install pillow && python3 scripts/pecas-sem-fundo.py
"""
from collections import deque
from pathlib import Path

from PIL import Image

LIMITE = 244  # canal acima disso conta como fundo branco

for arquivo in sorted((Path(__file__).resolve().parent.parent / "public" / "catalogo" / "pecas").glob("*.png")):
    im = Image.open(arquivo).convert("RGBA")
    w, h = im.size
    px = im.load()
    branco = lambda x, y: px[x, y][3] > 0 and min(px[x, y][:3]) >= LIMITE
    fila = deque([(x, y) for x in range(w) for y in (0, h - 1)] + [(x, y) for y in range(h) for x in (0, w - 1)])
    visto = set()
    while fila:
        x, y = fila.popleft()
        if (x, y) in visto or not (0 <= x < w and 0 <= y < h) or not branco(x, y):
            continue
        visto.add((x, y))
        px[x, y] = (255, 255, 255, 0)
        fila.extend([(x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)])
    # Borda suave: pixels quase brancos vizinhos do fundo ficam semitransparentes.
    for x in range(w):
        for y in range(h):
            r, g, b, a = px[x, y]
            if a and min(r, g, b) >= 225 and any((nx, ny) in visto for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1))):
                px[x, y] = (r, g, b, int(255 * (255 - min(r, g, b)) / (255 - 225 + 1)))
    im.save(arquivo, optimize=True)
    print(arquivo.name, f"{len(visto) * 100 // (w * h)}% fundo removido")
