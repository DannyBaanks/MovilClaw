# Guía de Operación: MovilClaw en iOS (.ipa) y Arquitectura Dual-Engine

Esta guía explica cómo compilar, instalar y operar **MovilClaw en tu iPhone**, tanto como control remoto del sandbox en tu PC como **ejecutor de Python autónomo directamente en el teléfono**.

---

## 1. La Arquitectura Dual-Engine

MovilClaw opera en dos modalidades seleccionables al vuelo desde la cabecera:

```
                      ┌──────────────────────────────────────────────┐
                      │             MovilClaw para iOS               │
                      └──────────────────────┬───────────────────────┘
                                             │
                     ┌───────────────────────┴───────────────────────┐
                     ▼                                               ▼
         📱 Modo Local (iPhone)                          🖥️ Modo Remoto (PC Docker)
┌──────────────────────────────────────┐       ┌──────────────────────────────────────┐
│ • Sandbox en Documents/work/app      │       │ • Conecta a tu PC por Wi-Fi/Tailscale│
│ • Intérprete Python (WASM / CPython) │       │ • Docker kamikaze con Linux completo │
│ • Cero acceso a Keychain o root      │       │ • Herramientas: git, bash, node, pip │
│ • No requiere servidor ni conexión PC│       │ • Red controlada por fases (closed)  │
└──────────────────────────────────────┘       └──────────────────────────────────────┘
```

### Seguridad y Aislamiento en iOS: Sandbox vs Proceso
- **El reto de CPython embebido:** CPython corre en el mismo espacio de memoria que la app. Filtrar `import os` no es un sandbox real en sistemas operativos POSIX.
- **La solución de MovilClaw:**
  1. **Aislamiento de Archivos (`LocalDeviceSandbox.swift`):** Todas las rutas se resuelven contra `Documents/MovilClaw/work/app`. Cualquier intento de escape (`..`, `/`, `\0`, saltos de línea) recibe un `DENY` antes de tocar el filesystem.
  2. **Aislamiento de Cómputo (`PythonRunner.swift`):** Se ejecuta mediante **WebAssembly (Pyodide)** en un contexto aislado sin acceso a llamadas de sistema nativas ni al Keychain de iOS. Cuando se añade `Python.xcframework` (Python 3.13), corre con límites de permisos obligatorios (`.allowOnce` / `.allowAlways`).

---

## 2. Cómo Compilar el `.ipa` en GitHub Actions (Sin Mac)

No necesitas tener una computadora Mac para compilar la app. GitHub Actions provee máquinas virtuales con macOS y Xcode preinstalado:

1. **Sube tus cambios a tu repositorio en GitHub:**
   ```bash
   git add ios/ .github/
   git commit -m "feat(ios): soporte nativo y compilacion de IPA"
   git push origin main
   ```
2. **Ve a la pestaña "Actions" en GitHub:**
   - Selecciona el workflow **"Build iOS IPA"**.
   - Haz clic en **"Run workflow"**.
3. **El workflow ejecutará automáticamente:**
   - `brew install xcodegen`
   - Generación del proyecto con `xcodegen generate` desde `ios/project.yml`.
   - Compilación con `xcodebuild` para `iphoneos` sin firma obligatoria (`CODE_SIGNING_ALLOWED=NO`).
   - Empaquetado de la estructura estándar `Payload/MovilClaw.app` en `MovilClaw.ipa`.
4. **Descarga el artefacto:**
   - Al finalizar el job (aprox. 3-5 minutos), descarga el archivo comprimido que contiene **`MovilClaw.ipa`**.

---

## 3. Cómo Instalar el `.ipa` en tu iPhone

El archivo `.ipa` generado es universal y no requiere una cuenta de desarrollador de pago de Apple para instalarlo:

| Método | Cómo se usa | Ventaja |
| :--- | :--- | :--- |
| **AltStore / SideStore** | Abre el `.ipa` desde la app en el iPhone o mediante AltServer. | Firma automática con tu Apple ID gratuito. |
| **Sideloadly** | Conecta el iPhone a la PC por USB, arrastra el `.ipa` y dale a "Start". | Rápido y funciona en Windows y Linux/Wine. |
| **TrollStore** (iOS 14-16.6.1) | Comparte el `.ipa` directamente a TrollStore. | Instalación permanente sin límite de 7 días. |
| **Scarlet** | Instala directamente el `.ipa` desde Safari o la app. | Cómodo en el dispositivo. |

---

## 4. Probando el Sandbox de la PC desde el Celular

Para usar tu computadora como el motor pesado (Docker kamikaze con red cerrada):

1. **En tu PC (Linux):**
   Obtén la IP local de tu máquina en la red Wi-Fi:
   ```bash
   hostname -I
   # Ejemplo: 192.168.1.45
   ```
2. **Inicia el servidor escuchando en toda la red local:**
   ```bash
   HOST=0.0.0.0 npm start
   ```
   *Verás:* `MovilClaw listo: abre http://0.0.0.0:8788 en el navegador`.

3. **En tu iPhone (App MovilClaw):**
   - Abre la app y selecciona **🖥️ Modo Remoto (PC)**.
   - Escribe la URL de tu computadora: `http://192.168.1.45:8788`.
   - Toca **"Conectar al Servidor"**.
   - ¡Listo! Tendrás la interfaz completa estilo **ISyCode IDE** operando contra el contenedor Docker de tu PC.

---

## 5. Probando el Sandbox Local del iPhone (Sin PC)

Para ejecutar código y probar el iPhone como sandbox autónomo:

1. En la barra superior de la app, abre el selector y elige **📱 Sandbox iPhone (Local)**.
2. Escribe tu script en el editor:
   ```python
   def sumar(a, b):
       return a + b

   print("Resultado en iPhone:", sumar(20, 22))
   ```
3. Toca **"Ejecutar"**:
   - El script se guarda en `Documents/MovilClaw/work/app/main.py`.
   - Se ejecuta directamente en el procesador del iPhone mediante el motor aislado.
   - En la consola de salida verás:
     ```
     [✓ Exitoso (código 0)]
     Resultado en iPhone: 42
     ```
4. **Verificación de Aislamiento:**
   Intenta acceder a rutas del sistema con:
   ```python
   import os
   # El workspace está acotado y no puede salir de /work/app
   ```
   Las herramientas nativas rechazan cualquier ruta que contenga `..` o intente leer directorios privados del sistema operativo.
