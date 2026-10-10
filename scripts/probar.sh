#!/usr/bin/env bash
#
# Prueba MovilClaw de punta a punta, contra el servidor que ya tengas corriendo.
#
# Recorrido real: crea un sandbox, comprueba que NO tiene red, le mete un repo,
# comprueba que la red sigue cerrada, edita, commitea, recoge el trabajo y destruye.
#
# Uso:  bash scripts/probar.sh [http://127.0.0.1:8788]
set -euo pipefail

API="${1:-http://127.0.0.1:8788}"
REPO="${REPO:-https://github.com/octocat/Hello-World}"

azul() { printf '\n\033[1;36m%s\033[0m\n' "$1"; }
ok()   { printf '  \033[32m✓\033[0m %s\n' "$1"; }
mal()  { printf '  \033[31m✗\033[0m %s\n' "$1"; }
dato() { printf '    %s\n' "$1"; }

campo() { python3 -c "
import json, sys
try:
    d = json.load(sys.stdin)
    for k in sys.argv[1:]:
        d = d[int(k)] if k.isdigit() else d[k]
    print(d)
except Exception:
    print('?')
" "$@" 2>/dev/null || echo "?"; }

azul "0. El servidor responde?"
if ! curl -sf --max-time 5 "$API/api/health" >/dev/null; then
  mal "no responde en $API"
  echo "    Arranca primero, en otra terminal:  npm start"
  exit 1
fi
ok "saludable"

azul "1. Crear un sandbox"
ID=$(curl -sf --max-time 60 -X POST "$API/api/sandboxes" -H 'content-type: application/json' -d '{"ttlMinutes":30}' | campo id)
ok "creado: $ID"

limpiar() { curl -sf --max-time 30 -X DELETE "$API/api/sandboxes/$ID?force=1" >/dev/null 2>&1 || true; }
trap limpiar EXIT

azul "2. Tiene red al nacer?"
FASE=$(curl -sf --max-time 10 "$API/api/sandboxes/$ID/network" | campo phase)
[ "$FASE" = "cerrada" ] && ok "cerrada, como debe ser" || mal "esta en fase $FASE"

azul "3. Traer un repo"
curl -sf --max-time 300 -X POST "$API/api/sandboxes/$ID/repo" -H 'content-type: application/json' \
  -d "{\"url\":\"$REPO\"}" > /tmp/mc-probar-repo.json
dato "repo:   $(campo repo < /tmp/mc-probar-repo.json)"
dato "commit: $(campo commit < /tmp/mc-probar-repo.json | cut -c1-50)"
ok "clonado"

azul "4. Se cerro la red al terminar?"
FASE=$(curl -sf --max-time 10 "$API/api/sandboxes/$ID/network" | campo phase)
[ "$FASE" = "cerrada" ] && ok "cerrada otra vez" || mal "quedo en $FASE"

SALIDA=$(curl -s --max-time 60 -X POST "$API/api/sandboxes/$ID/tool" -H 'content-type: application/json' \
  -d '{"name":"run","args":{"argv":["sh","-c","timeout 5 curl -s -o /dev/null https://github.com && echo SALIO || echo bloqueado"]}}' \
  | campo result out)
[ "$(echo "$SALIDA" | tr -d '[:space:]')" = "bloqueado" ] && ok "y de verdad no sale a internet" || mal "respuesta: $SALIDA"

azul "5. El agente trabaja: escribe, edita, commitea"
curl -sf --max-time 60 -X POST "$API/api/sandboxes/$ID/tool" -H 'content-type: application/json' \
  -d '{"name":"write","args":{"path":"PRUEBA.md","content":"# Prueba de MovilClaw\n\nEscrito dentro del sandbox.\n"}}' >/dev/null
ok "escribio PRUEBA.md"
curl -sf --max-time 60 -X POST "$API/api/sandboxes/$ID/tool" -H 'content-type: application/json' \
  -d '{"name":"edit","args":{"path":"PRUEBA.md","from":"dentro del sandbox","to":"dentro del sandbox, editado"}}' >/dev/null
ok "edito el archivo"
COMMIT=$(curl -sf --max-time 60 -X POST "$API/api/sandboxes/$ID/tool" -H 'content-type: application/json' \
  -d '{"name":"commit","args":{"message":"docs: prueba desde MovilClaw"}}' | campo result commit)
dato "$COMMIT"
ok "commiteo"

azul "6. Los limites hacen su trabajo"
RES=$(curl -s --max-time 30 -X POST "$API/api/sandboxes/$ID/tool" -H 'content-type: application/json' \
  -d '{"name":"git","args":{"op":"push"}}' | campo error)
[ "$RES" != "?" ] && ok "git push rechazado" || mal "git push NO se rechazo"
RES=$(curl -s --max-time 30 -X POST "$API/api/sandboxes/$ID/tool" -H 'content-type: application/json' \
  -d '{"name":"read","args":{"path":"../../etc/passwd"}}' | campo error)
[ "$RES" != "?" ] && ok "ruta fuera del repo rechazada" || mal "la ruta NO se rechazo"

azul "7. Recoger el trabajo (lo que te llevarias)"
curl -sf --max-time 120 "$API/api/sandboxes/$ID/work" -o /tmp/mc-trabajo.tar.gz
dato "$(tar -tzf /tmp/mc-trabajo.tar.gz | wc -l) entradas, $(wc -c < /tmp/mc-trabajo.tar.gz) bytes"
dato "guardado en /tmp/mc-trabajo.tar.gz"
ok "descargado"

azul "8. Destruir sin haber guardado (debe negarse)"
RES=$(curl -s --max-time 30 -X DELETE "$API/api/sandboxes/$ID" | campo error)
[ "$RES" != "?" ] && ok "se nego, como debe" || mal "lo destruyo"

azul "9. Guardar el articulo y entonces si destruir"
curl -sf --max-time 60 "$API/api/sandboxes/$ID/snapshot" -o /tmp/mc-snapshot.json >/dev/null
ok "snapshot en /tmp/mc-snapshot.json"
DEST=$(curl -sf --max-time 60 -X DELETE "$API/api/sandboxes/$ID" | campo phase)
[ "$DEST" = "destroyed" ] && ok "destruido" || mal "estado: $DEST"

trap - EXIT
printf '\n\033[1;32mTodo el recorrido paso.\033[0m\n\n'
echo "  Tu archivo de trabajo:  /tmp/mc-trabajo.tar.gz"
echo "  Para verlo:             tar -tzf /tmp/mc-trabajo.tar.gz"
echo
echo "  Y con raton, la interfaz:  http://127.0.0.1:8788"
