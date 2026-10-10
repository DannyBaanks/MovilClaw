# Dónde se construye cada cosa

Corrección importante respecto a la primera versión de este documento: **sí se puede compilar
una app iOS sin tener una Mac**, porque el CI presta el macOS. Me equivoqué al escribir lo
contrario y queda anotado.

## El reparto real

| Dónde | Qué se puede hacer |
| --- | --- |
| **Esta máquina (Linux)** | Orquestador, cliente web, tests, Docker real. **No** compila Swift |
| **GitHub Actions · `macos-latest`** | `xcodegen` + `xcodebuild`: compila la app, corre los tests en simulador y publica artefactos |

O sea: **Linux escribe, CI compila.** Un cambio en Swift viaja por git, el runner lo compila
y devuelve el resultado (o el error) como artefacto y log.

## Cómo lo hace ISyCodeMovil (el patrón a reutilizar)

Su workflow `ios-build.yml` corre en `macos-latest` y hace, en este orden:

1. Preflight de higiene (marcadores de conflicto, BOM en fuentes Swift).
2. Verifica el manifiesto de modelos GUS pinneados.
3. `brew install xcodegen` y `brew install cmake`.
4. Compila el XCFramework de llama.cpp para iOS.
5. `xcodegen generate` desde `project.yml`.
6. `xcodebuild -version`, `xcodebuild -list` y la compilación.
7. Sube artefactos, y en otro job corre los tests en el simulador.

Ese archivo es la plantilla: MovilClaw no necesita inventar nada para el lado iOS.

## Qué implica para este proyecto

- **El núcleo (Node + Docker) se prueba aquí**, con pruebas reales, hoy.
- **El cliente web se compila y se prueba aquí**, y se publica como demo por enlace.
- **Un cliente Swift, si entra, se compila en CI**: aquí solo se escribe y se revisa.
  Eso es aceptable y es exactamente lo que hace ISyCodeMovil, pero conviene decirlo: de ese
  lado la evidencia es el log del runner, no una ejecución local.

## Herramientas disponibles aquí

| Herramienta | Estado |
| --- | --- |
| Node.js 24 · npm 11 | disponible |
| Docker 29.8.2 (cgroup v2) | disponible; `--network none` probado |
| bubblewrap · Python 3.12 | disponible |
| Swift · Xcode · xcodegen | **no existen aquí** (sí en el runner de macOS) |
