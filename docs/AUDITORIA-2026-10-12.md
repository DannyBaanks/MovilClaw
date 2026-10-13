# Auditoría de MovilClaw — 12 de octubre de 2026

Revisión del proyecto después de los commits de Daniel (app iOS, dual-engine, pulido de UI).
Método: leer el código, ejecutar la suite, y **atacar las propias garantías** para ver si
seguían en pie. Todo lo que sigue se midió; nada se supone.

Base: `9ae1578`. Resultado: **60/60 pruebas en verde** antes y después de los arreglos.

## Lo que sigue bien (verificado, no asumido)

| Garantía | Comprobación |
| --- | --- |
| `main` es de solo lectura | `main`, `master` y `develop` siguen rechazándose |
| Las operaciones destructivas no existen | Las 12 siguen en `FORBIDDEN` con su motivo |
| El sandbox nace sin red | Fase `cerrada` por defecto, y se cierra tras cada tarea |
| El candado cifra en reposo | 13 pruebas de sellado intactas |
| Nada de credenciales en el sandbox | 0 archivos con credenciales tras clonar un privado |

La app iOS que añadió Daniel (`ios/App/`, 1166 líneas Swift) trae su propio sandbox local, y
su docstring ya declara las tres reglas correctas: nada sale de `/work/app`, sin Keychain ni
credenciales, con límites de tamaño.

## Hallazgo 1 — Un enlace simbólico se saltaba la frontera del repositorio (alto)

**Lo que estaba mal.** Las herramientas comprobaban la ruta como *texto*:

```js
if (path.startsWith("/") || path.includes("..")) throw ...
```

y el sandbox de iOS hacía lo mismo con `standardizedFileURL`, que normaliza el texto pero
**no resuelve enlaces**. Un enlace *dentro* del repositorio que apunta fuera conserva su ruta
textual dentro, así que pasaba todas las comprobaciones mientras el archivo real estaba en
otro sitio.

**Reproducido, no teorizado:**

```console
$ ln -s /work/secreto.txt /work/app/enlace.txt
$ cat /work/app/enlace.txt
SECRETO FUERA
```

El archivo está fuera de `/work/app`, y las herramientas lo leían igual. La frontera que dice
"el agente solo trabaja en el repositorio" era permeable.

**Arreglado en los dos lados:**

- Servidor: `resolveInsideRepo` pregunta al sandbox dónde cae la ruta de verdad (`readlink -m`)
  y rechaza lo que salga. Aplicado a `read`, `write`, `edit` y `list`.
- iOS: `resolveSafePath` usa `resolvingSymlinksInPath` y comprueba además **tramo a tramo**,
  para que un enlace en medio del camino tampoco cuele.

**Cómo se comprueba ahora** (dos pruebas nuevas en `tests/repo.test.mjs`):

- Un enlace que sale del repositorio: **rechazado**, y el archivo de fuera queda intacto.
- Un enlace que apunta **dentro** del repositorio: **permitido**. La regla no es "rechazar
  todo", o rompería casos legítimos.

## Hallazgo 2 — El badge de tests mentía (bajo)

El README decía `58/58`. La realidad medida eran **60**. Corregido.

No es cosmético: un número que se desincroniza solo hace dudar de todos los demás. Es el
mismo defecto que se corrigió en TamagotchIA, y conviene no reintroducirlo.

## Hallazgo 3 — El fallo del inicio de sesión que viste, ya resuelto (informativo)

En la captura del 10 de octubre, **Iniciar sesión con GitHub** devolvía *"no hay ningún inicio
de sesión en curso con ese código"*.

Era real: el servidor guardaba el flujo por `device_code` (largo, secreto) y el navegador solo
tenía el `userCode` (corto, el que tecleas). Al emparejar por el código corto, se arregló
(`3b275dd`, a las 10:17). Ya no existe.

Lo dejo escrito porque conviene saber **por qué** pasó: la primera versión mezclaba dos
identificadores distintos del mismo flujo.

## Lo que sigue sin probarse, y por qué

- **La app iOS no se ha ejecutado aquí.** No hay Swift ni Xcode en Linux; compila en el runner
  de macOS. Los cambios en `LocalDeviceSandbox.swift` están **escritos y razonados, no
  ejecutados**: su prueba es el CI de iOS.
- **El device flow de GitHub no se ha completado de punta a punta.** Necesita un `client_id`
  propio; no se usa el de otra app a propósito. La lógica está probada con dobles.
- **No hay tests para el sandbox de iOS.** El servidor tiene 60 pruebas; el lado Swift no tiene
  ninguna, y esa asimetría es una deuda real.
