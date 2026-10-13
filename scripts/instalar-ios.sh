#!/usr/bin/env bash
#
# Instala la app de MovilClaw en un iPhone, desde Linux, sin Mac.
#
# El reparto de trabajo, que es el motivo de este script:
#   - Tu CI (runner de macOS) COMPILA la IPA. Aqui no hay Xcode y no hace falta.
#   - xtool INSTALA y FIRMA en el dispositivo. Eso si funciona en Linux.
#
# Este script no compila nada, no autentica nada y no instala nada sin que se lo pidas.
#
# Uso:
#   bash scripts/instalar-ios.sh --comprobar      # solo mira si tienes lo necesario
#   bash scripts/instalar-ios.sh                  # baja la IPA e instala
#   bash scripts/instalar-ios.sh --ipa /ruta.ipa  # usa una IPA que ya tengas
set -euo pipefail

REPO="${REPO:-DannyBaanks/MovilClaw}"
WORKFLOW="${WORKFLOW:-ios-build.yml}"
VERDE='\033[32m'; ROJO='\033[31m'; AMBAR='\033[33m'; AZUL='\033[1;36m'; FIN='\033[0m'
ok()   { printf "  ${VERDE}✓${FIN} %s\n" "$1"; }
falta(){ printf "  ${ROJO}✗${FIN} %s\n" "$1"; }
aviso(){ printf "  ${AMBAR}!${FIN} %s\n" "$1"; }
paso() { printf "\n${AZUL}%s${FIN}\n" "$1"; }

COMPROBAR=0
IPA=""
while [ $# -gt 0 ]; do
  case "$1" in
    --comprobar) COMPROBAR=1 ;;
    --ipa) shift; IPA="${1:-}" ;;
    -h|--help) sed -n '2,16p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "opcion desconocida: $1"; exit 2 ;;
  esac
  shift
done

FALTAN=0

paso "1. Herramientas"
command -v xtool >/dev/null 2>&1 && ok "xtool: $(command -v xtool)" || {
  falta "xtool no esta instalado"
  echo "     Descargalo de https://github.com/xtool-org/xtool/releases"
  echo "       curl -L -o xtool https://github.com/xtool-org/xtool/releases/download/1.21.0/xtool-x86_64.AppImage"
  echo "       chmod +x xtool && sudo mv xtool /usr/local/bin/"
  FALTAN=1
}
command -v gh >/dev/null 2>&1 && ok "gh (para bajar la IPA del CI)" || { falta "gh no esta instalado"; FALTAN=1; }
command -v unzip >/dev/null 2>&1 && ok "unzip (para validar la IPA)" || { falta "unzip no esta instalado"; FALTAN=1; }

paso "2. Sesion de Apple (esto NO lo hace el script)"
if command -v xtool >/dev/null 2>&1 && xtool auth --help >/dev/null 2>&1; then
  if xtool devices >/dev/null 2>&1; then
    ok "hay sesion de Apple y xtool responde"
  else
    aviso "xtool no puede hablar con Apple todavia"
    cat <<'AYUDA'
     Elige UNA via y ejecutala tu. El script no autentica por ti:

     a) Cuenta de pago (Apple Developer Program, 99 $/ano) — RECOMENDADO
          xtool auth --api-key   # API publicas, soportadas por Apple

     b) Apple ID normal (gratis)
          xtool auth             # usa API PRIVADAS de Apple; la herramienta lo advierte

AYUDA
    FALTAN=1
  fi
fi

paso "3. La IPA"
if [ -n "$IPA" ]; then
  [ -f "$IPA" ] && ok "usando la que me diste: $IPA" || { falta "no existe $IPA"; FALTAN=1; }
else
  echo "     Se baja del ultimo run verde de $REPO ($WORKFLOW)"
  if command -v gh >/dev/null 2>&1; then
    RUN=$(gh run list --repo "$REPO" --workflow="$WORKFLOW" --status success --limit 1 --json databaseId --jq '.[0].databaseId' 2>/dev/null || true)
    if [ -n "$RUN" ] && [ "$RUN" != "null" ]; then
      ok "ultimo run verde: $RUN"
    else
      aviso "no encontre ningun run verde de $WORKFLOW"
      FALTAN=1
    fi
  fi
fi

if [ "$FALTAN" -ne 0 ]; then
  paso "Falta algo de lo de arriba"
  echo "  Arreglalo y vuelve a ejecutar. No he instalado ni autenticado nada."
  exit 1
fi

if [ "$COMPROBAR" -eq 1 ]; then
  paso "Todo listo (modo --comprobar: no se instala nada)"
  echo "  Con el iPhone conectado por USB, ejecuta:  bash scripts/instalar-ios.sh"
  exit 0
fi

paso "4. Bajando la IPA del CI"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
if [ -z "$IPA" ]; then
  gh run download "$RUN" --repo "$REPO" --name "MovilClaw-iOS-IPA" --dir "$TMP/ipa"
  IPA=$(find "$TMP/ipa" -name '*.ipa' | head -1)
  [ -n "$IPA" ] || { falta "el artefacto no traia ninguna .ipa"; exit 1; }
  ok "IPA: $(basename "$IPA") ($(du -h "$IPA" | cut -f1))"
fi

paso "5. Validando la IPA antes de tocar el telefono"
# Una IPA es un zip con Payload/<App>.app dentro. Si no lo es, se rechaza aqui y no en el iPhone.
if ! unzip -l "$IPA" >/dev/null 2>&1; then
  falta "eso no es un zip: no puede ser una IPA"
  exit 1
fi
if ! unzip -l "$IPA" | grep -q 'Payload/.*\.app/'; then
  falta "el zip no tiene Payload/<App>.app: no es una IPA instalable"
  echo "     Un zip cualquiera no vale; se rechaza aqui, no en el dispositivo."
  exit 1
fi
ok "es una IPA valida ($(unzip -l "$IPA" | tail -1 | awk '{print $2}') archivos)"

paso "6. Tus dispositivos"
xtool devices || { falta "no pude listar dispositivos (iPhone conectado por USB?)"; exit 1; }

paso "7. Instalando"
read -r -p "  Empareja el iPhone si hace falta y pulsa Enter para instalar... " _
xtool install "$IPA" || { falta "la instalacion fallo"; exit 1; }
ok "instalada"

paso "8. Lanzando"
xtool launch || aviso "se instalo, pero no pude lanzarla. Abrela desde el telefono."

echo
printf "${VERDE}Listo.${FIN} La app salio del CI y se instalo desde Linux, sin Mac.\n"
