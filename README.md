# ImpactWave

> **🌐 [English](README.en.md) | Español**

**Analizador de blast radius para TypeScript y JavaScript.**

ImpactWave es una CLI que analiza tus cambios en Git antes de hacer merge y responde una pregunta:

> **"¿Qué puedo romper con este cambio y qué debería probar?"**

---

## El problema

En un codebase real, un cambio "pequeño" puede romper cosas muy lejos del archivo editado. Los revisores lo detectan por intuición, los tests globales no te dicen *qué* probar primero, y el impacto real se descubre en producción.

ImpactWave convierte esa intuición en datos: qué símbolos exportados tocaste físicamente, quién los consume de verdad, qué áreas afectadas quedan sin tests y cuánto riesgo acumula el cambio — con un score determinístico y razones explicables.

## Qué hace

Dado un rango de commits (`rama base → HEAD`), genera un reporte en consola con:

- **Símbolos modificados** — funciones, clases, métodos públicos, interfaces, tipos… detectados vía AST ([ts-morph](https://ts-morph.com)), no texto plano: solo cuenta lo que el diff tocó físicamente.
- **Consumidores reales** — cada uso activo de los símbolos modificados, con archivo, línea y snippet. Un `import` puro no ejecuta nada y no cuenta como impacto.
- **Blast radius** — todos los archivos alcanzados a través del grafo de dependencias (incluye barrel files), agrupados por nivel de cascada.
- **Cobertura de impacto** — qué porcentaje de las áreas afectadas está cubierto por tests, y la lista exacta de las que no.
- **Risk score 0–100** — determinístico (misma entrada → mismo score) y explicable: cada punto viene acompañado de su razón.

### ¿Qué es el blast radius?

El *radio de explosión* es el conjunto de código que puede verse afectado cuando cambias un archivo: quienes lo importan directamente, quienes importan a esos, y así en cascada. Conocerlo antes del merge significa saber exactamente dónde mirar y qué tests ejecutar — no descubrirlo por un bug report.

## Instalación

```bash
npm install -g impactwave   # o úsalo sin instalar:
npx impactwave
```

Requisitos: Node ≥ 22.12, un repositorio Git local y un proyecto TypeScript/JavaScript.

## Uso

Ejecútalo en la raíz de tu proyecto:

```bash
cd mi-proyecto
impactwave
```

> `analyze` es el comando por defecto: `impactwave` y `impactwave analyze` son equivalentes. Solo se analizan cambios **commiteados** (`base..HEAD`); el working tree sin commitear no entra en el análisis.

```text
$ impactwave --help

ImpactWave answers one question before you merge:

  "What can I break with this change, and what should I test?"

It combines your Git diff with AST analysis to find the exported symbols you
modified, who really consumes them, whether tests cover the affected areas,
and computes a deterministic risk score (0-100) with explainable reasons.

Usage: impactwave [options] [command]

Analyze the blast radius of your code changes before merging

Options:
  -V, --version      output the version number
  -h, --help         display help for command

Commands:
  analyze [options]  Analyze changed code impact in this repository
  help [command]     display help for command

Documentation: https://github.com/paleto30/impactwave#readme

Tip: running bare "impactwave" inside a Git repository is equivalent to
"impactwave analyze". Run "impactwave analyze --help" for options and examples.
```

### Opciones

| Opción | Descripción |
|---|---|
| `-b, --base <branch>` | Rama base a comparar (autodetección: `origin/HEAD` → `main`/`master` → `HEAD~1`) |
| `--risk-weights <json>` | Pesos personalizados de los factores de riesgo. Ver [modelo de riesgo](#modelo-de-riesgo) |
| `--json` | Reporte como JSON en stdout, con contrato versionado (`meta.schemaVersion`) y [esquema publicado](docs/schema-v1.json). Ideal para CI |

### Ejemplos

```bash
# HEAD contra la rama base autodetectada
impactwave

# Comparar contra una rama base explícita
impactwave analyze -b main

# Dar más peso a los huecos de cobertura de tests
impactwave --risk-weights '{"callerImpact":30,"testGaps":35}'

# Puntuar solo por consumidores directos de los símbolos modificados
impactwave analyze --risk-weights '{"callerImpact":100}'

# Salida machine-readable para pipelines (stdout puro, warnings en stderr)
impactwave --json | jq '.risk'

# Gate de merge: falla si el nivel no es LOW ni MEDIUM
impactwave analyze --json -b main | jq -e '.risk.level | inside("LOW|MEDIUM")' > /dev/null
```

## Cómo funciona

1. **Git**: detecta el repo, la rama base y los archivos modificados (A/M/D).
2. **AST**: ts-morph extrae exports e imports de los archivos cambiados, usando un único proyecto con los `compilerOptions` de tu `tsconfig.json` raíz y los archivos descubiertos por un recorrido propio del árbol (tolerante a directorios ilegibles).
3. **Símbolos modificados**: intersecta los rangos de líneas de cada símbolo exportado con las líneas del diff.
4. **Consumidores reales**: `findReferences` encuentra los usos activos de cada símbolo (los imports puros no cuentan como impacto).
5. **Grafo de dependencias**: índice inverso y directo de imports relativos + recorrido transitivo (BFS) con profundidad.
6. **Test mapping**: detecta archivos `*.test.ts`/`*.spec.ts` y mapea qué código cubren.
7. **Risk engine**: score determinístico 0-100 con razones explicables.

## Modelo de riesgo

Cinco factores con umbrales de saturación. Pesos por defecto (configurables con `--risk-weights`):

| Factor | Peso | Señal |
|---|---|---|
| Caller impact | 30 | consumidores directos de símbolos modificados (umbral 10) |
| Affected files | 20 | archivos alcanzados transitivamente (umbral 15) |
| Dependency depth | 15 | niveles de profundidad máxima (umbral 4) |
| Test gaps | 20 | proporción de áreas afectadas sin tests |
| Change size | 15 | líneas modificadas (umbral 200) |

Niveles: `0-25 LOW · 26-50 MEDIUM · 51-75 HIGH · 76-100 CRITICAL`.

Los nombres de los factores son las claves JSON de `--risk-weights` (todas opcionales; las omitidas valen 0).

## El reporte

Cada análisis imprime contexto Git, evaluación de riesgo con score y razones, cobertura de impacto, y por cada archivo cambiado: símbolos exportados (marcando los modificados), usos downstream con línea y snippet, blast radius en cascada y tests relacionados:

![Reporte de ejemplo de ImpactWave](https://raw.githubusercontent.com/paleto30/impactwave/master/docs/img-example.png)

```
╭─ Risk Assessment ────────────────────────────────────────╮
│ 🟡 MEDIUM RISK (score: 31/100)                           │
│ Changes affect a few dependent modules. Verify them...   │
│ 4 unique dependent files at risk                         │
│ Reasons:                                                 │
│   • 4 consumers of modified symbols (12 pts)             │
│   • 4 affected files (transitive reach) (5 pts)          │
│   • Impact reaches depth 1 dependency level (4 pts)      │
│   • 1 affected area without detected tests (10 pts)      │
│   • 1 line modified                                      │
╰──────────────────────────────────────────────────────────╯
```

📖 **Cómo leer el reporte completo, sección por sección** → [docs/GUIA.md](docs/GUIA.md)

### Ejemplo visual

Ejecución real de ImpactWave antes de hacer merge a `main`: análisis del refactor de un módulo de usuarios en un proyecto NestJS.

![Análisis de impacto antes de merge: refactor del módulo de usuarios en un proyecto NestJS](docs/impactwave.png)

> **Nota**: esta captura se tomó durante el desarrollo de la herramienta con una utilidad que guarda la salida completa de la terminal como imagen, por lo que pierde parte del diseño y formato del reporte. No representa exactamente el reporte final — es solo un ejemplo visual del análisis de impacto antes del merge; el reporte real se renderiza directamente en tu terminal.

### Salida JSON para CI

`impactwave analyze --json` emite el mismo reporte como un único documento
JSON en stdout (las advertencias van a `stderr`). El formato está versionado
(`meta.schemaVersion`) y publicado como [JSON Schema](docs/schema-v1.json):
dentro de una versión solo hay cambios aditivos. Los usos de símbolos viajan
sin filtrar, marcados con `importOnly: true` cuando son solo cableado de
contrato (`import`, re-exports).

## Limitaciones conocidas

- Compara commits; los cambios sin commitear en el working tree no se analizan.
- La cobertura de tests se basa en imports directos de los archivos de test (no transitiva).
- El grafo solo considera imports relativos (no `node_modules` ni path aliases).
- En monorepos con varios tsconfigs, solo se usa el de la raíz; el descubrimiento de fuentes recorre todo el árbol (omitiendo `node_modules`/`dist`/`build`, ocultos y rutas ilegibles).
- Los directorios sin permiso de lectura (ej. `pg_data`) se omiten; no abortan el análisis.

## Desarrollo

```bash
npm test       # suite de tests (node:test)
npm run build  # compilación a dist/
npm run dev    # ejecutar en desarrollo
```

Los fixtures en `test/fixtures/` validan el análisis contra proyectos artificiales: `simple-project` (cadena A→B→C), `circular-dependencies` (X↔Y), `barrel-exports` (re-exports por barrel) y `test-coverage` (servicios con y sin tests).

Para contribuir: abre un [issue](https://github.com/paleto30/impactwave/issues) o envía un PR. Las prioridades y mejoras candidatas están documentadas en [docs/ROADMAP.md](docs/ROADMAP.md); el historial de versiones, en [CHANGELOG.md](CHANGELOG.md).

## Licencia

[ISC](LICENSE)
