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
