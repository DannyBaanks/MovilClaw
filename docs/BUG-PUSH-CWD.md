# El push que iba a tu propio repositorio

Dos fallos se escondían en el mismo camino: empujar el trabajo del agente. Los dos son del
tipo que no da la cara: **no lanzaban ningún error visible**. Los encontré intentando abrir un
PR de verdad, no leyendo el código.

## Fallo 1 — `git` corría «donde estuviera el servidor»

**Qué pasaba.** `gitWithToken` montaba el comando con el token y lo ejecutaba **sin decirle en
qué directorio**. Git usa entonces el directorio de trabajo del proceso, que es donde se
arrancó el servidor: la raíz del proyecto.

**Consecuencia medida.** El push intentaba empujar `movilclaw/arreglar-saludar-2026-10-13` a:

```
error: falló el empuje de algunas referencias a
       'https://github.com/DannyBaanks/MovilClaw.git'
```

O sea, **al repositorio del propio proyecto**, no al repo de pruebas. Fracasó solo porque esa
rama no existía allí. Si el nombre hubiera coincidido con uno existente, habría empujado la
rama del agente dentro de MovilClaw.

**Arreglo.** `cwd` es obligatorio, no opcional, y hay un guard que lo exige:

```js
if (!options.cwd) {
  throw new GithubError("gitWithToken necesita un directorio de trabajo explicito");
}
```

Un comando de git con credenciales no puede ejecutarse «donde caiga».

## Fallo 2 — comparaba con la rama equivocada

**Qué pasaba.** Antes de empujar comprobaba si había algo que enviar con
`git rev-list --count main..HEAD`. En un clon `--depth 1`, después de extraer el `.git` del
sandbox encima, **la rama local `main` y `HEAD` pueden ser el mismo commit**, así que la
respuesta era `0` con el trabajo justo ahí.

**Medido en el mismo directorio:**

```
git rev-list --count main..HEAD          → 0     ← mentira
git rev-list --count origin/main..HEAD   → 1     ← la verdad
```

El resultado era el error *«no hay ningún cambio que empujar»*, sobre un directorio que sí
tenía el commit del agente.

**Arreglo.** Comparar contra `origin/<base>`, que es la referencia que todavía recuerda dónde
empezaba la rama.

## Cómo se evita que vuelvan

Tres pruebas nuevas en `tests/policy.test.mjs`:

- Cada `gitWithToken` del código lleva su `cwd`, y el guard sigue existiendo.
- La comprobación usa `origin/<base>` y no la rama local a secas.
- La regla de ramas se comprueba **antes** del push, así que una rama inválida se rechaza sin
  que salga ni un byte.

Y una que ya estaba: `main` nunca es un destino.

## El resultado

Con los dos arreglos, el flujo completo funciona de punta a punta:

```
rama:  movilclaw/arreglar-saludar-2026-10-13
PR:    https://github.com/DannyBaanks/movilclaw-prueba/pull/1
base:  main (solo lectura, intacta)
fusionado: false
```

## El otro fallo del camino

De paso apareció un tercero, en `docker.runCommand`: usar `promisify(execFile)` con la opción
`input` **no retornaba nunca** cuando el dato era un archivo tar. Se midió: colgado hasta que
lo cancelaban, mientras `spawn` extrae el mismo archivo en **9 ms**. Cambiado a `spawn`, que
además cierra `stdin` explícitamente.
