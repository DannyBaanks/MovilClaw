# Entorno de construcción y sus límites

Este proyecto se está construyendo en **Linux**, y eso decide qué se puede verificar y qué no.

## Lo que hay

| Herramienta | Estado |
| --- | --- |
| Node.js 24 | disponible |
| npm 11 | disponible |
| Docker 29.8.2 (cgroup v2) | disponible; `--network none` probado |
| bubblewrap | disponible |
| Python 3.12 | disponible |

## Lo que NO hay

| Herramienta | Consecuencia |
| --- | --- |
| Swift / Xcode / xcodebuild | **No se puede compilar ni probar una app iOS aquí** |
| xcodegen | No se puede generar el `.xcodeproj` |
| macOS | Solo existe en los runners `macos-latest` de GitHub Actions |

## Por qué importa

`ISyCodeMovil` es una app Swift que se compila en un runner de macOS. Si la base de MovilClaw
fuera esa app, aquí solo se podría **escribir** código Swift, sin compilarlo, sin ejecutarlo y
sin probarlo. Eso choca con la regla del proyecto: no se afirma que algo funciona si no se
ejecutó.

Por eso la decisión de stack (nativa o web) no es cosmética: cambia si el resultado se puede
demostrar o solo describir.
