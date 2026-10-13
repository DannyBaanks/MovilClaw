# Instalar la app en tu iPhone desde Linux, sin Mac

## El reparto, que es lo que hace esto posible

```
Tu CI (runner de macOS)        →  COMPILA la IPA       ← Xcode vive ahí, y solo ahí
Tu Linux (aquí) + xtool        →  INSTALA y FIRMA      ← esto sí funciona sin Mac
```

No se compila iOS en Linux: haría falta el SDK de Apple. Pero la app **ya viene compilada** del
CI, así que el último paso se puede hacer desde aquí.

## Antes de nada: comprueba

```bash
npm run ios:instalar -- --comprobar
```

No instala ni autentica nada. Solo dice qué tienes y qué falta, **con el comando exacto** para
arreglarlo:

```
1. Herramientas
  ✗ xtool no esta instalado
     Descargalo de https://github.com/xtool-org/xtool/releases
       curl -L -o xtool https://github.com/xtool-org/xtool/releases/download/1.21.0/xtool-x86_64.AppImage
       chmod +x xtool && sudo mv xtool /usr/local/bin/
  ✓ gh (para bajar la IPA del CI)
  ✓ unzip (para validar la IPA)
3. La IPA
  ✓ ultimo run verde: 38330138604
```

## Instalar xtool (una vez)

```bash
curl -L -o xtool https://github.com/xtool-org/xtool/releases/download/1.21.0/xtool-x86_64.AppImage
chmod +x xtool
sudo mv xtool /usr/local/bin/
xtool --help        # comprueba que arranca
```

`xtool` es un AppImage: no se instala de verdad, se ejecuta. Funciona porque no depende de
Xcode, solo de `swiftc` y del SDK cuando toca compilar.

## Autenticarte con Apple (la decisión es tuya)

**El script no autentica por ti.** Elige una vía:

| Vía | Comando | Coste | Qué implica |
| --- | --- | --- | --- |
| **Apple Developer Program** | `xtool auth --api-key` | 99 $/año | API públicas y soportadas. **Recomendado** |
| **Apple ID normal** | `xtool auth` | Gratis | Usa **API privadas** de Apple. La herramienta avisa de que no es oficial |

La de pago cuesta, pero es la única que Apple soporta. Con la gratis funciona hoy, y puede
romperse el día que Apple cambie algo — con tu Apple ID personal en medio.

## Instalar la app

Con el iPhone conectado por USB y desbloqueado:

```bash
npm run ios:instalar
```

Qué hace, en orden:

1. Comprueba herramientas y sesión.
2. **Baja la IPA** del último run verde de tu CI (`gh run download`).
3. **Valida que sea una IPA**: un zip con `Payload/<App>.app` dentro. Un zip cualquiera se
   rechaza **aquí**, no en el iPhone con un error incomprensible.
4. Lista tus dispositivos (`xtool devices`).
5. Instala (`xtool install`) y lanza (`xtool launch`).

Si ya tienes una IPA, sáltate la descarga:

```bash
bash scripts/instalar-ios.sh --ipa /ruta/a/MovilClaw.ipa
```

## Qué puede fallar, y qué significa

| Síntoma | Qué pasa |
| --- | --- |
| `xtool: no esta instalado` | Falta el AppImage. El script te da el comando |
| `xtool devices` no lista nada | iPhone no conectado por USB, o bloqueado, o sin confiar en el equipo |
| Firma rechazada | Con cuenta gratis, la app caduca en 7 días y hay que reinstalar |
| `eso no es un zip` | El archivo no es una IPA. Revisa de dónde salió |
| Varios dispositivos y no sé cuál | `xtool devices` primero; `xtool install` acepta el destino |

## Lo que NO se puede hacer

- **Compilar iOS en Linux.** Haría falta el SDK de Apple (`Xcode.xip`, `Xcode.app` o
  `darwin.xtoolsdk`), que no es redistribuible. `xtool sdk install` **no lo descarga: se lo
  tienes que dar**. Tu CI sigue siendo el que compila.
- **Instalar sin cuenta de Apple.** Ni de pago ni gratis: alguna hace falta para firmar.
- **Firmar para el App Store.** Eso es otro camino, con certificados de distribución.

## Por qué `xtool` y no otra cosa

Se comprobó: `swiftc` 6.4 y `swift-build` funcionan en esta máquina, y `xtool` arranca. Lo que
no hay es el SDK de Apple. Así que `xtool` entra justo donde aporta — **el despliegue** — y no
donde no puede: la compilación.
