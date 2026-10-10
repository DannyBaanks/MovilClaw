# MovilClaw

Cliente de bolsillo y orquestador de **sandboxes kamikaze** para AutoClaw. Proyecto nuevo,
hecho con AutoClaw y pensado para que otra gente use AutoClaw sin montar nada en su máquina.

## Qué hace hoy (probado, no prometido)

```
Teléfono / navegador  ──►  PWA  ──►  Orquestador  ──►  sandbox aislado
                                      (5 a la vez)      ├── sin red
                                                        ├── sin tu disco
                                                        ├── sin root
                                                        └── caduca solo
```

- **Crear** un sandbox con la cuenta atrás que elijas: 30 min, 2 h o 12 h.
- **Usarlo** reinicia la cuenta. Un sandbox no muere mientras trabajas.
- **Descargar** el archivo del sandbox y guardarlo en el teléfono.
- **Destruir**: se niega si aún no descargaste el archivo.
- **Traer un repositorio** público: el sandbox abre la red **solo para eso** y la cierra al
  terminar. Si el clonado falla, también la cierra.
- **Trabajar en él** con las herramientas del agente: leer, buscar, escribir, editar,
  `git status`/`diff`/`stage`, commit y ejecutar programas.
- **Sellar** el sandbox con una frase secreta tuya: lo guardado queda cifrado y **el
  servidor no puede abrirlo** (no existe función de descifrado en su lado).
- **Firmar un permiso por tiempo**: dice quién puede abrirlo y hasta cuándo, caduca solo,
  y no se puede pedir uno eterno (tope de 24 h).

## Arrancarlo

```bash
npm run sandbox:build     # imagen del sandbox (una vez)
npm start                 # y abre http://127.0.0.1:8788
```

**Un proceso, un puerto, una URL.** `/` es la app y `/api/*` es la API, en el mismo origen:
se puede abrir desde el móvil apuntando al servidor, sin CORS y sin adivinar rutas.

> Antes eran dos puertos con la app detrás de un proxy. Lo primero que hizo una persona fue
> abrir el puerto de la API, recibir `{"error":"not found"}` y pensar, con razón, que estaba
> roto. El diseño era malo, no el usuario.

## Lo que se comprobó de verdad

Pruebas de aislamiento **con Docker real**, no simuladas (`npm run test:isolation`):

| Prueba | Resultado |
| --- | --- |
| Salir a internet desde el sandbox | `OSError: [Errno 101] Network unreachable` |
| Leer `/home/danny` desde el sandbox | `oculto` |
| Ejecutar como root | `id -u` → `1000` |
| Reservar 1 GiB con tope de 256m | rechazado por el kernel |
| Destruir y dejar restos | contenedor y volumen eliminados |
| El servidor lee lo que guardó | solo hay ciphertext; sin la frase no se abre |
| Permiso caducado | rechazado; y uno "eterno" se limita a 24 h |
| Clonar un repo real | trae el commit exacto de `github.com/octocat/Hello-World` |
| Red después de clonar | cerrada: `curl` a github desde dentro da `bloqueado` |
| Clonado que falla | también deja la red cerrada |
| Editar y commitear | el cambio se ve en `git status` y el commit lleva el mensaje |
| Ruta `../../etc/passwd` | rechazada |

Y el ciclo de vida completo, con Docker de verdad:

```
crear → activo → (inactividad) → SUSPENDIDO → [descargar archivo] → DESTRUIDO
                                      │
                                      └── sin el archivo descargado, se queda aquí
```

## Tres cosas que aprendimos probando (y que valen más que el código)

1. **`docker rm --volumes` no borra volúmenes con nombre.** El contenedor desaparece y el
   dato sigue ahí, montable otra vez. La política decía "borrado irreversible" y era falso.
   Ahora el volumen se borra explícitamente, y si falla se avisa en vez de callar.
2. **`import.meta.url` viene percent-encoded.** Compararlo con una ruta armada a mano nunca
   coincide si la carpeta lleva un espacio ("ISyCo Git"): el servidor no arrancaba y no decía
   por qué. Se usa `fileURLToPath`.
3. **Un test que pasa por el motivo equivocado no prueba nada.** El de "pasa al enlazar" se
   ponía en rojo por los permisos del archivo, no por la cadena rota.

## Aislamiento y candado: la promesa honesta

Todo está en [docs/AISLAMIENTO.md](docs/AISLAMIENTO.md) con su "cómo se comprueba". Lo
importante, partido en dos porque cada mitad es distinta:

| Estado del sandbox | Qué se garantiza |
| --- | --- |
| **En reposo** | Cifrado real: en disco solo hay ciphertext y sin tu frase no se abre |
| **Encendido** | Aislamiento por contenedor (sin red, sin tu disco, sin root). **No** confidencialidad frente al operador: eso necesita hardware (SEV/TDX) que esta máquina no tiene |

No prometo invisibilidad con el sandbox encendido porque sería falso y se puede desmentir
leyendo `/proc/cpuinfo`. Lo que sí prometo es verificable, y las 27 pruebas lo verifican.

La regla que manda: **nunca se destruye trabajo que no se haya entregado antes.**

## Estructura

| Ruta | Qué es |
| --- | --- |
| `server/lifecycle.mjs` | La máquina de estados: activo → suspendido → destruido |
| `server/docker.mjs` | **Todo** el aislamiento, en un solo sitio auditable |
| `server/orchestrator.mjs` | Une el ciclo de vida, Docker y el reloj |
| `server/api.mjs` | Cinco operaciones HTTP, sin dependencias |
| `web/index.html` | La PWA (la sirve `server/api.mjs`, sin proxy) |
| `web/seal.mjs` | El cifrado: PBKDF2 + AES-GCM. **La clave nunca sale del navegador** |
| `server/network.mjs` | La red por fases: qué destinos se abren y por qué |
| `server/grant.mjs` | El permiso firmado con vencimiento (HMAC + caducidad) |
| `server/sealed.mjs` | Guarda ciphertext. No tiene, a propósito, ninguna función para descifrarlo |
| `tests/` | Ciclo de vida, cifrado y aislamiento con Docker real |

Sin dependencias de npm: solo Node 20+ y Docker.

## La red por fases

Un sandbox nace **sin red**. La puerta se abre para una tarea concreta y se cierra al acabar:

| Fase | A quién alcanza | Cuándo |
| --- | --- | --- |
| `cerrada` | a nadie | por defecto, y al terminar cada tarea |
| `repo` | github.com y sus servidores de entrega | traer o publicar un repositorio |
| `deps` | npm, PyPI y los repositorios del sistema | instalar dependencias declaradas |

No hay una fase "abrir todo": la lista de destinos está en `server/network.mjs` con el
motivo de cada uno. Se enforce con la conexión de red de Docker, y se comprueba desde
dentro midiendo que la salida falla.

## Las herramientas del agente

Todas son `argv` fijos: eliges la herramienta y sus argumentos, nunca una cadena de shell.

| Tool | Qué hace |
| --- | --- |
| `read` / `write` / `edit` | leer, escribir y reemplazar texto (el `edit` exige que el texto sea único) |
| `list` / `search` | listar y buscar con ripgrep |
| `git` | `status`, `diff`, `staged`, `log`, `branch`, `stage`. `push` y `reset` **no** están |
| `commit` | commit con mensaje |
| `run` | ejecutar un programa (node, python, tests) con límite de tiempo y de salida |

## Qué NO hay todavía

- **No abre PRs** con un token efímero: la estructura está, la llamada a GitHub no.
- **No empuja cambios**: `git push` está fuera de la lista a propósito; eso necesita el
  token efímero y su propia decisión.
- **No hay reinyección**: el archivo se descarga, pero un sandbox nuevo aún no lo monta.
- **No hay app iOS.** El cliente es web. Ver [docs/ENTORNO.md](docs/ENTORNO.md): el runner
  de macOS puede compilar Swift, y `ISyCodeMovil` es la plantilla, pero eso es otra entrega.
- **Sin TLS ni autenticación en la API.** Escucha en loopback; exponerlo a una red es una
  decisión del operador, y debe ir detrás de TLS.

## Licencia

MIT.
