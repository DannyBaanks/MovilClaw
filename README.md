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

## Aislamiento: la promesa honesta

Lo que **sí** se garantiza está en [docs/AISLAMIENTO.md](docs/AISLAMIENTO.md), con su
"cómo se comprueba" y tres cosas que **no** se garantizan: invisibilidad frente al operador
del servidor, resistencia a un exploit del kernel, y lo que el propio usuario pegue dentro.

La regla que manda: **nunca se destruye trabajo que no se haya entregado antes.**

## Estructura

| Ruta | Qué es |
| --- | --- |
| `server/lifecycle.mjs` | La máquina de estados: activo → suspendido → destruido |
| `server/docker.mjs` | **Todo** el aislamiento, en un solo sitio auditable |
| `server/orchestrator.mjs` | Une el ciclo de vida, Docker y el reloj |
| `server/api.mjs` | Cinco operaciones HTTP, sin dependencias |
| `web/index.html` | La PWA (la sirve `server/api.mjs`, sin proxy) |
| `tests/` | Ciclo de vida con reloj falso + aislamiento con Docker real |

Sin dependencias de npm: solo Node 20+ y Docker.

## Qué NO hay todavía

- **No abre PRs** con un token efímero: la estructura está, la llamada a GitHub no.
- **No hay reinyección**: el archivo se descarga, pero un sandbox nuevo aún no lo monta.
- **No hay app iOS.** El cliente es web. Ver [docs/ENTORNO.md](docs/ENTORNO.md): el runner
  de macOS puede compilar Swift, y `ISyCodeMovil` es la plantilla, pero eso es otra entrega.
- **Sin TLS ni autenticación en la API.** Escucha en loopback; exponerlo a una red es una
  decisión del operador, y debe ir detrás de TLS.

## Licencia

MIT.
