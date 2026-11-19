#!/usr/bin/env bash
# Confere um motor da Calculadora de Tributos (Regime Regular): versão e o exemplo oficial
# (docs/exemplos.md do repositório ReceitaFederal/calculadora-rtc-regime-regular, v1.6.1).
# Uso: scripts/fiscal/verificar-motor.sh https://host/caminho/api   (sem barra no fim)
set -uo pipefail
BASE=${1:?informe a URL base da API, ex.: http://localhost:8080/api}
DIR=$(cd "$(dirname "$0")" && pwd)
echo "== versao"
curl -sS -m 30 -w "\nHTTP %{http_code} em %{time_total}s\n" "$BASE/calculadora/dados-abertos/versao" || echo "FALHOU: versao"
echo "== calculo do exemplo oficial (observabilidade)"
for i in 1 2 3; do
  curl -sS -m 30 -o /tmp/resp.json -w "HTTP %{http_code} em %{time_total}s\n" -X POST "$BASE/calculadora/observabilidade/regime-geral" \
    -H 'Content-Type: application/json' -d @"$DIR/exemplo-oficial-operacao.json" || echo "FALHOU: calculo"
done
python3 - <<'PY'
import json, sys
try: r = json.load(open('/tmp/resp.json'))
except Exception as e: print('resposta nao e JSON:', e); sys.exit(1)
t = r['total']['tribCalc']
obtido = {'vIS': t['ISTot']['vIS'], 'vBCIBSCBS': t['IBSCBSTot']['vBCIBSCBS'], 'vIBS': t['IBSCBSTot']['gIBS']['vIBS'], 'vCBS': t['IBSCBSTot']['gCBS']['vCBS'],
          'estados': [o['estadoItem'] for o in r['objetos']], 'erro_item4': [e['code'] for e in r['objetos'][3].get('erros', [])]}
publicado = {'vIS': '15.00', 'vBCIBSCBS': '1465.00', 'vIBS': '0.64', 'vCBS': '56.76',
             'estados': ['CALCULO_SIMULADO'] * 3 + ['INCONSISTENCIA_ENTRADA'], 'erro_item4': ['REG-011']}
print('obtido   :', obtido)
print('publicado:', publicado)
print('RESULTADO:', 'IGUAL AO PUBLICADO' if obtido == publicado else 'DIFERENTE')
sys.exit(0 if obtido == publicado else 1)
PY
