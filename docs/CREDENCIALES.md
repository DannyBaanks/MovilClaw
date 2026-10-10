# Credenciales, ramas y lo que el agente no puede hacer

Este documento explica dónde vive cada credencial, por qué el sandbox no tiene ninguna, y
qué operaciones no existen en el código. Es la parte del proyecto donde equivocarse sale caro.

## El invariante

> **Ninguna credencial entra en un sandbox.**

Ni el token de GitHub, ni la clave del proveedor de modelos (Z.ai/GLM, NVIDIA, el que sea),
ni la tuya de ningún servicio. El sandbox trabaja, pero no puede gastar tu dinero ni actuar
en tu nombre.

```
TÚ ──login──► HOST: perfiles de auth + token, SELLADOS con tu frase
                 ├─ GitHub: clona privados, empuja a movilclaw/…, abre el PR
                 ├─ Proveedor: los turnos los paga el Gateway
                 └─ entrega el CÓDIGO al sandbox
                                        └─ sandbox: CERO credenciales
```

## Dónde vive el token de GitHub

| Dónde | Cómo |
| --- | --- |
| En memoria | Por defecto. Muere al reiniciar: no hay nada en disco que robar |
| Sellado en disco | Solo si tú lo pides. El mismo AES-256-GCM del candado: el servidor guarda ciphertext que no puede abrir |
| En el sandbox | **Nunca.** Ni en `.git/config`, ni en variable de entorno, ni en un archivo |
| En un log | **Nunca.** La API devuelve tipo, huella y scopes; jamás el token |

Lo que la UI puede mostrar de una cuenta:

```json
{ "id": "github", "kind": "oauth", "fingerprint": "57128db0",
  "scopes": ["repo", "read:org"], "sealed": false }
```

`fingerprint` es un hash corto para que distingas dos cuentas sin que se muestre ninguna.

## Cómo viaja un repo privado, sin llevar el token

1. El **host** clona con el token, en una cabecera HTTP (`Authorization: Basic`, porque git
   habla Basic; `x-access-token` como usuario).
2. El host **reescribe el remote** para dejarlo sin credenciales.
3. Se empaqueta y el sandbox lo recibe.
4. Comprobado con una búsqueda dentro del sandbox: **0 archivos con credenciales**.

Detalle que costó un bug: git quiere `Basic`, la API REST de GitHub quiere `Bearer`. Mezclarlos
da `remote: invalid credentials`, que parece un token malo y no lo es.

## Permisos: se piden los mínimos

- **Se piden:** `repo`, `read:org`.
- **Se rechazan:** `delete_repo`, `admin:org`, `admin:public_key`, `admin:repo_hook`,
  `write:packages`, `delete:packages`. Un token que los traiga se **rechaza** al guardarlo.

## Ramas: `main` nunca, y el nombre es la atribución

```
main  ─────────────────────────────►  solo lectura
  │
  └─ movilclaw/<tarea>-<fecha>  ──►  commits  ──►  PR  ──►  tú fusionas
```

- Nunca se empuja a `main`, `master`, `trunk`, `develop` ni `development`.
- La rama **debe** empezar por `movilclaw/`: no puedo firmar un commit como Claude ni como
  Copilot, así que el nombre de la rama es la atribución honesta, y se borra en un comando.
- El PR **se abre, no se fusiona**. Fusionar es decisión humana.

## Lo que no existe en el código

No es que esté desaconsejado: la operación no está escrita, así que la ruta no existe.

| Operación | Por qué no |
| --- | --- |
| Borrar un repositorio | Irreversible y no hace falta para trabajar |
| Cambiar visibilidad, settings, transferir | Toca el repositorio, no el código |
| Borrar ramas o etiquetas | Pierde trabajo y deja el PR huérfano |
| `push --force` | Convierte un error en una pérdida |
| Fusionar el PR | Es una decisión tuya |
| Cerrar PRs ajenos | Mete al agente donde no lo llamaron |
| Escribir secrets, colaboradores, webhooks | Entrega datos fuera del repositorio |

## Lo que queda pendiente

- **Device flow de GitHub**: implementado, pero necesita que registres una OAuth App
  (`client_id`). Sin él se usa el token pegado, que funciona hoy. No se inventa un `client_id`
  ni se usa el de otra app.
- **Login del proveedor de modelos**: se apoya en el que tu app ya tiene
  (`openclaw models auth login --provider zai-global`, `zai-coding-global`, `zai-cn`, …). La
  capa de UI para elegirlo desde MovilClaw está por hacer.
