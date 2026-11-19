"""Desenha, no mesmo traço das outras ilustrações do catálogo, as peças que
entraram no site 3D depois do catálogo original (sobrecalha e rufo colarinho).

Perfil frontal em preto grosso, extrusão para cima/direita, faces deitadas
claras e faces em pé escuras. Medidas padrão de pecas-3d.html.
Gera public/catalogo/pecas/{id}.png (fundo transparente) e
public/catalogo/pecas-impressao/{id}.png (fundo branco), 330x190.
Uso: pip install pillow && python3 scripts/desenhar-pecas.py
"""
import math
from pathlib import Path

from PIL import Image, ImageDraw

W, H, S = 330, 190, 4  # tamanho final e supersampling
CLARO, ESCURO, BORDA, PRETO = (221, 225, 228, 255), (162, 173, 179, 255), (112, 122, 128, 255), (26, 26, 26, 255)
RAIZ = Path(__file__).resolve().parent.parent / "public" / "catalogo"


def sobrecalha():
    A, B, C, D, E = 1, 3, 1.4, 4, 1.5
    x, y = 18, 8 + D
    top = y + B
    n1, n2 = math.hypot(.47, .88), math.hypot(.82, .57)
    pts = [(x - .47 / n1 * A, top - .88 / n1 * A), (x, top), (x, y), (x - C, y), (x - C, y - D),
           (x - C + .82 / n2 * E, y - D - .57 / n2 * E)]
    return pts, 16.0, None


def rufo_colarinho():
    A, B, D, ang = 40, 3, 15, 25
    pts = [(-A / 2, -B), (-A / 2, 0), (A / 2, 0), (A / 2, -B)]
    a = D / 2 + .3
    b = a / math.cos(math.radians(ang))
    return pts, 70.0, (a, b)


def desenhar(pts, comprimento, furo):
    # Projeção oblíqua: profundidade z vai para cima e para a direita.
    kx, ky = math.cos(math.radians(30)) * .5, math.sin(math.radians(30)) * .5

    def proj(p, z=0.0):
        return (p[0] + z * kx, p[1] + z * ky)

    todos = [proj(p, z) for p in pts for z in (0, comprimento)]
    xs, ys = [p[0] for p in todos], [p[1] for p in todos]
    esc = min((W - 36) / (max(xs) - min(xs)), (H - 30) / (max(ys) - min(ys)))
    ox = (W - (max(xs) - min(xs)) * esc) / 2 - min(xs) * esc
    oy = (H - (max(ys) - min(ys)) * esc) / 2 + max(ys) * esc

    def tela(p, z=0.0):
        q = proj(p, z)
        return ((ox + q[0] * esc) * S, (oy - q[1] * esc) * S)

    im = Image.new("RGBA", (W * S, H * S), (255, 255, 255, 0))
    d = ImageDraw.Draw(im)
    # Faces de trás para a frente: o observador está à frente, à direita e acima.
    faces = []
    for p, q in zip(pts, pts[1:]):
        mx, my = (p[0] + q[0]) / 2, (p[1] + q[1]) / 2
        deitada = abs(q[1] - p[1]) < abs(q[0] - p[0])
        faces.append((mx * kx + my * ky, p, q, deitada))
    faces.sort(key=lambda f: f[0])
    for _, p, q, deitada in faces:
        poli = [tela(p), tela(q), tela(q, comprimento), tela(p, comprimento)]
        d.polygon(poli, fill=CLARO if deitada else ESCURO, outline=BORDA, width=S)
    if furo:
        a, b = furo
        cz = comprimento / 2
        elipse = [tela((a * math.cos(t), 0), cz + b * math.sin(t))
                  for t in (i * 2 * math.pi / 120 for i in range(120))]
        d.polygon(elipse, fill=(255, 255, 255, 0), outline=BORDA, width=S)
    d.line([tela(p) for p in pts], fill=PRETO, width=int(2.6 * S), joint="curve")
    return im.resize((W, H), Image.LANCZOS)


for nome, peca in (("sobrecalha", sobrecalha), ("rufo-colarinho", rufo_colarinho)):
    im = desenhar(*peca())
    im.save(RAIZ / "pecas" / f"{nome}.png")
    branco = Image.new("RGB", (W, H), "white")
    branco.paste(im, mask=im.split()[3])
    branco.save(RAIZ / "pecas-impressao" / f"{nome}.png")
    print(nome, "ok")
