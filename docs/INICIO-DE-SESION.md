# Iniciar sesión con GitHub

Para traer repos **privados** y abrir **PRs** hace falta tu cuenta de GitHub. Hay dos caminos,
y el recomendado no requiere pegar ningún token.

## Camino 1: entrar con GitHub (recomendado)

Un código de 8 dígitos, sin pegar tokens:

1. En MovilClaw: **Iniciar sesión con GitHub**.
2. Te aparece un código, por ejemplo `4798-9A85`, y el enlace `github.com/login/device`.
3. Lo abres, escribes el código y autorizas.
4. MovilClaw recibe el token y lo guarda **en el servidor**. La página nunca lo ve.

Detrás está el *device flow* de GitHub: el token se canjea de servidor a servidor.

### Antes hace falta registrar tu OAuth App (una vez, 2 minutos, gratis)

Es obligatorio, y no es un capricho: sin un `client_id` propio, GitHub mostraría **el nombre
de otra app** en la pantalla de permisos. Estarías autorizando algo distinto de lo que crees.
Por eso MovilClaw **se niega a arrancar el flujo sin tu `client_id`** y te dice cómo obtenerlo,
en vez de usar uno prestado.

1. Abre https://github.com/settings/applications/new
2. **Application name:** `MovilClaw`
3. **Homepage URL:** `http://127.0.0.1:8788`
4. Marca **Enable Device Flow**
5. **Register application**, y copia el **Client ID** (el *secret* no hace falta)
6. Guárdalo una vez en el `.env` del proyecto:

```bash
cp .env.example .env
# edita .env y pon tu client_id en MOVILCLAW_GITHUB_CLIENT_ID
npm start
```

`.env` está en `.gitignore`: **nunca se commitea**. Y el entorno real siempre gana sobre el
archivo, así que puedes seguir sobreescribiéndolo puntualmente con
`MOVILCLAW_GITHUB_CLIENT_ID=otro npm start` si algún día quieres probar con otra app.

Solo se leen estas claves del archivo: `MOVILCLAW_GITHUB_CLIENT_ID`, `MOVILCLAW_STATE`,
`MOVILCLAW_ALLOW_EXEC`, `MOVILCLAW_GRANT_SECRET`, `PORT` y `HOST`. Nada de `PATH` ni
`NODE_OPTIONS`: un archivo de configuración no es una puerta trasera.

Si no está configurado, la interfaz **te muestra estos pasos** en vez de fallar en silencio.
Al arrancar, el servidor dice si lo tiene o no:

```
Configuracion de /ruta/.env: MOVILCLAW_GITHUB_CLIENT_ID
Inicio de sesion con GitHub: listo (client_id Ov23liGP…)
```

Solo muestra los primeros caracteres: suficiente para confirmar que es tu app, sin volcar el
valor entero en los logs.

## Camino 2: pegar un token a mano

Funciona hoy y sin registrar nada. En **Tu cuenta de GitHub → O pega un token a mano**.
Sirve para probar; para uso diario, el device flow es mejor porque no dejas un token copiado
por ahí.

## Qué pasa después, en los dos caminos

| | |
| --- | --- |
| Dónde vive el token | En el servidor, **en memoria**; o sellado con tu frase si quieres que sobreviva al reinicio |
| Entra al sandbox | **Nunca.** Ni en `.git/config`, ni en variables de entorno, ni en un archivo |
| Se muestra en la interfaz | Tipo, huella (`57128db0`) y scopes. **Nunca el token** |
| Se imprime en logs | Nunca |
| Scopes | Se piden `repo` y `read:org`. Un token con `delete_repo` o `admin:org` se **rechaza** |

## Lo que se puede hacer con la cuenta

- **Traer repos privados**: el servidor clona con tu token, le quita el remote con
  credenciales, y entrega el código. Medido: **0 archivos con credenciales** dentro del sandbox.
- **Abrir PR**: empuja a `movilclaw/<tarea>-<fecha>` y abre el PR. **Nunca a `main`**, y el PR
  **no se fusiona solo**.

## Qué no se puede hacer, aunque tengas cuenta

Borrar repositorios, cambiar su visibilidad, tocar webhooks, colaboradores o secrets, borrar
ramas o etiquetas, `push --force`, fusionar PRs ajenos o cerrar issues. No están desaconsejados:
**no existen en el código**, y hay un test que exige que sigan sin existir.

## Si algo falla

| Síntoma | Qué pasa |
| --- | --- |
| "falta el `client_id`" | No arrancaste con `MOVILCLAW_GITHUB_CLIENT_ID`. La interfaz lista los pasos |
| "el código caducó" | Pasaron más de 15 min sin autorizar. Vuelve a empezar |
| "cancelaste la autorización" | Le diste a cancelar en GitHub |
| "no se encontró el repositorio, o el token no tiene acceso" | El repo es privado y la cuenta guardada no es la dueña |

---

## Verificado de punta a punta (13 de octubre de 2026)

El flujo completo se ejecutó con la cuenta real del dueño, **sin pegar ningún token**:

```
1. Iniciar sesión con GitHub    →  código de 8 dígitos, autorizado en github.com
2. El servidor recibe el token  →  kind: oauth, via: github-device-flow
3. Traer un repo PRIVADO        →  DannyBaanks/do-not-publish
                                   credenciales dentro del sandbox: ninguna
4. Comprobado desde dentro      →  red: sin red
                                   tokens en /work: 0
                                   usuario: 1000 (no root)
5. El agente trabajó            →  escribió, commiteó
6. PR abierto                   →  movilclaw/prueba-movilclaw-2026-10-13 → main
                                   main intacta, PR sin fusionar
```

Lo importante de ese recorrido: en **ningún** momento el token estuvo dentro del sandbox.

### Dos fallos reales que aparecieron y se arreglaron

**Un parpadeo de red tiraba el login entero.** Cuando el servidor iba a canjear el código por
el token, perdió el DNS un instante (`EAI_AGAIN github.com`) y **descartó una autorización que
la persona ya había concedido**. Arreglado: los fallos de red (`EAI_AGAIN`, `ETIMEDOUT`,
`ECONNRESET`, `ECONNREFUSED`, `ENOTFOUND`, `EPIPE`) se marcan como transitorios y se reintentan
hasta 5 veces. Un error que **no** es de red sigue parando en seco.

**El código caducaba sin que se viera.** Dos intentos se perdieron autorizando un código ya
vencido. Ahora la interfaz muestra una cuenta atrás (`el código caduca en 11:43`) y, al vencer,
dice que se pida otro.
