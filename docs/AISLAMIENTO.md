# Aislamiento: qué se garantiza y qué no

Un sandbox promete mucho y casi siempre prueba poco. Este documento separa las dos cosas,
para que nadie tenga que creerse nada.

## Lo que sí se garantiza (y cómo se comprueba)

| Garantía | Cómo se implementa | Cómo se comprueba |
| --- | --- | --- |
| Sin red | `--network none` en el contenedor | Un `curl`/`socket` dentro del sandbox debe fallar |
| Sin el disco del anfitrión | Cero montajes del host; solo el volumen del sandbox | `ls /` dentro no expone ningún path del anfitrión |
| Sin privilegios extra | sin `--privileged`, sin `--cap-add`, usuario no root | `id` dentro del sandbox |
| Recursos acotados | `--memory`, `--cpus`, `--pids-limit` | Una reserva de memoria excesiva es rechazada por el kernel |
| Token efímero | Token de GitHub de un solo repo y vida corta | El token deja de servir al expirar el sandbox |
| Caducidad automática | Reloj del orquestador; suspende y luego destruye | Esperar la expiración y ver el estado |

## Lo que **NO** se garantiza

Hay tres cosas que sería bonito prometer y sería mentira. Van escritas aquí a propósito:

1. **Invisibilidad frente al operador del servidor.** Quien controla el anfitrión puede leer
   la memoria del invitado; eso lo permite la virtualización, no una mala configuración.
   Lo que sí se promete es la **política**: no se leen los volúmenes y el borrado es
   automático e irreversible. Una política se audita; la invisibilidad no se puede.
2. **Resistencia a un exploit del kernel.** El aislamiento es por contenedor (namespaces +
   cgroup). Un fallo del kernel puede escaparlo. Para eso haría falta microVM.
3. **Confidencialidad de lo que el propio usuario pegue dentro.** Si alguien escribe una
   clave en el sandbox, esa clave está dentro del sandbox.

## Política de borrado

Orden obligatorio, sin atajos:

```
activo  ──(inactividad)──►  SUSPENDIDO  ──(snapshot entregado)──►  DESTRUIDO
   │                             │
   │                             └── el contenedor se pausa; los datos siguen ahí
   └── sigue trabajando: la cuenta atrás se reinicia con cada uso real
```

**Nunca se destruye trabajo que no se haya entregado antes.** Si el snapshot no llegó a
descargarse, el sandbox se queda suspendido, no borrado. El "kamikaze" es el cómputo.

## Caducidad que elige la persona

Al crear el sandbox se elige una cuenta atrás. Cuenta desde el **último uso real**, no desde
la creación, para que a nadie se le muera el sandbox mientras trabaja.

---

# Candado: cifrado que el servidor no puede abrir

El sandbox puede sellarse con **una frase secreta tuya**. Lo que se guarda queda cifrado y
el servidor **no tiene forma de abrirlo**, ni yo, ni nadie con acceso a la máquina.

## Cómo funciona

```
TU NAVEGADOR                                  EL SERVIDOR
frase secreta                                 (nunca la ve)
    │
    ├─ PBKDF2-SHA256, 600.000 rondas
    │  → clave AES-256 que NO es extraíble
    │
    ├─ cifra (AES-256-GCM, sal y IV nuevos cada vez)
    │
    └──────────────►  guarda ciphertext + manifiesto
                      no hay función de descifrado
```

Del lado del servidor hay **cero funciones para descifrar**: no es que no las llame, es que
no existen. Guarda bytes, comprueba que el sobre tiene el formato esperado, y los devuelve.

## El permiso firmado por tiempo

El "permiso" es un token con firma HMAC y su propia fecha de caducidad:

- Dice **quién** puede abrir y **hasta cuándo**. No lleva la frase ni la clave.
- No se puede falsificar sin el secreto del servidor, ni mover a otro sandbox.
- **Caduca**: pasada su hora, el servidor ya no lo acepta.
- Hay un **tope de 24 h**: no se puede pedir un permiso eterno, ni por error de tecleo.
- Si no configuras `MOVILCLAW_GRANT_SECRET`, los permisos no sobreviven a un reinicio
  (el valor por defecto es seguro; el servidor lo avisa al arrancar).

## Qué se comprueba

Trece pruebas en `tests/seal.test.mjs`, cada una capaz de fallar:

| Prueba | Qué demuestra |
| --- | --- |
| El texto plano no está en el sello | El cifrado es real, no un envoltorio |
| Con tu frase abre | El camino legítimo funciona |
| Con otra frase falla | Sin la clave no hay puerta trasera |
| Un byte alterado falla | AES-GCM detecta la manipulación |
| Sal y IV distintos cada vez | Dos sellos del mismo archivo no se comparan |
| Frase corta rechazada | No se acepta una clave silenciosamente débil |
| En disco solo hay ciphertext | El servidor no puede leer lo que guarda |
| El archivo es privado (0600) | Otra cuenta de la máquina no lo lee |
| Se rechaza lo que no es sello | No sirve como vertedero de archivos |
| Destruir borra de verdad | No queda copia |
| El permiso vale y luego caduca | La caducidad es real, no decorativa |
| Permiso de otro sandbox o falsificado: no | La firma ata el permiso a su sandbox |
| El permiso eterno se limita a 24 h | El tope no se puede saltar |

## Lo que esto NO protege (y ya no se promete)

**Con el sandbox encendido, quien es root en la máquina puede leer su memoria.** Eso no se
arregla con configuración: hace falta cifrado de memoria por hardware (AMD SEV, Intel TDX) y
esta máquina no lo tiene. Lo verifiqué: no aparecen `sev_snp` ni `tdx` en `/proc/cpuinfo`.

Así que la promesa queda partida en dos, y cada mitad es verdad:

| Estado del sandbox | Qué se garantiza |
| --- | --- |
| **En reposo** (suspendido o destruido) | Cifrado real: en disco solo hay ciphertext y sin tu frase no se abre |
| **Encendido** (trabajando) | Aislamiento por contenedor (sin red, sin tu disco, sin root), **no** confidencialidad frente al operador |

Prometer lo segundo sería mentir, y el jurado puede desmentirlo leyendo `/proc/cpuinfo`.
