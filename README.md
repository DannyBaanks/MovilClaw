# MovilClaw

Cliente de bolsillo y orquestador de sandboxes para AutoClaw. **Proyecto nuevo**, hecho con
AutoClaw y pensado para que otra gente use AutoClaw sin montar nada en su máquina.

## Estado

**Nada implementado todavía.** Este commit solo crea el proyecto, su razón de ser y su
política de aislamiento. El código entra después, y cada pieza se anuncia como funciona
solo cuando hay una prueba que la respalde.

## La idea

Un agente necesita un sitio donde trabajar que no sea la máquina de quien lo usa. MovilClaw
da eso: **sandboxes que se crean, se usan, se guardan y se destruyen solos**.

```
Teléfono / navegador
        │  (emparejar, pedir sandbox, ver estado, abrir PR, bajar el archivo)
        ▼
   Orquestador  ──►  1..N sandboxes aislados
                       ├── sin red
                       ├── sin acceso al disco del anfitrión
                       ├── token de GitHub efímero, un repo
                       └── caducidad automática
```

Cada sandbox es **kamikaze por diseño**: nace con una cuenta atrás que elige la persona.
Cuando expira, el cómputo se apaga. **Antes de borrar nada, primero se guarda.**

## Qué reutiliza

| De dónde | Qué | Por qué sirve |
| --- | --- | --- |
| `ISyCodeMovil` · `Bridge/bin/*.mjs` | Protocolo de emparejamiento y orquestación de runtimes (Node ESM) | Corre en Linux y ya está probado |
| `ISyCodeMovil` · `Catalog/models.json` | Catálogo GUS: 22 modelos con SHA-256 y licencia | Dato puro, sin dependencias |
| `ISyCodeMovil` · `docs/isycode-mobile-host-contract-v1.md` | Contrato de host/cliente v1 | Ya define quién manda: el host autoriza, el cliente muestra |
| `ISyCode` | `AGENTS.md`: autoridad explícita, journal, sin claims sin prueba | Es la disciplina que este proyecto hereda |

## Qué NO reutiliza

- **No hereda la app Swift** de ISyCodeMovil como base: una app iOS necesita macOS y Xcode,
  que no existen en el entorno donde se está construyendo esto. Ver `docs/ENTORNO.md`.

## Principios

1. **Sin red por defecto.** Un sandbox no puede sacar el repo de tu máquina.
2. **Sin montajes del anfitrión.** Solo ve su propio volumen.
3. **Credenciales efímeras.** El token de GitHub vive lo que vive el sandbox, y solo alcanza
   el repo para el que se pidió.
4. **Guardar antes de borrar.** La caducidad no destruye trabajo no entregado.
5. **Prometer solo lo verificable.** Ver `docs/AISLAMIENTO.md`: dice explícitamente lo que
   **no** se garantiza.

## Licencia

MIT.
