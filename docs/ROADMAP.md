# Roadmap

Criterio de foco: una mejora entra aquí solo si hace que el **núcleo de
análisis** (símbolos modificados, consumidores, grafo, cobertura de impacto,
score) sea más **correcto o más preciso** en proyectos TypeScript reales.
Todo lo demás — superficies nuevas, comandos auxiliares, integraciones — se
mantiene aparcado al final de este documento hasta que el núcleo sea
confiable en los escenarios difíciles.

## v1.2.0 — Precisión del núcleo

Cuatro huecos de precisión auditados contra el código actual (cada uno con
test de regresión antes del fix):

1. **Imports dinámicos invisibles al grafo** — `import("./x")` y `require()`
   no crean aristas; un cambio puede romper a un consumidor que el blast
   radius no lista. Fix: extraer llamadas dinámicas además de declaraciones
   estáticas (`src/engine/graph/dependency.ts`).
2. **Cobertura de tests solo directa** — `getRelatedTests` mira imports
   directos del archivo de test; si el test importa `A` y `A` importa `B`
   modificado, la cobertura no cuenta. Fix: resolver transitivamente vía el
   mismo grafo ya disponible (`src/engine/testing/test-mapping.ts`).
3. **Filtro frágil de usos pasivos** — `isImportOnlyUsage` no reconoce
   `export { X } from "./y"` como cableado de contrato y puede clasificarlo
   como uso activo. Fix: cubrir re-exports y revisar heurística
   (`src/engine/analyzer/usage-filter.ts`).
4. **Los tests inflan el score** — un test que consume el símbolo modificado
   suma como consumidor normal (`callerImpact`). Decisión: pesar los tests
   por separado (factor propio opcional `testCallerImpact`, con migración de
   pesos documentada) para no penalizar dos veces lo que es buena señal
   (`src/engine/assessment.ts`).

Además: corregir la documentación que aún describe el alcance del análisis
como `<raíz>/src/**/*.ts` (el descubrimiento real recorre todo el árbol,
omitiendo `node_modules`/`dist`/`build`, directorios ocultos, symlinks y
rutas ilegibles).

## Aparcado (superficie, no núcleo)

Estos elementos aportan valor pero no mejoran la precisión del análisis;
se retoman cuando el núcleo pase la auditoría de v1.2.0:

- **`check` (gate de CI)** — envoltorio no interactivo con exit code según
  umbral (`--fail-on HIGH|CRITICAL`). Hoy se aproxima con
  `impactwave analyze --json | jq -e '.risk.level == "LOW"'`.
- **`init` + archivo de configuración** (`.impactwaverc`: pesos, rama base,
  patrones de test) — estandarización por equipo.
- **`doctor`** — diagnóstico de entorno (repo, base resoluble, parseos
  omitidos, timings por fase).
- **`--head <ref>`** — comparar entre dos refs arbitrarios (hoy siempre
  `base..HEAD`).
- Rendimiento en monorepos grandes (caché incremental sobre `findReferences`).

## Entregado

- **v1.1.0**: salida JSON con contrato versionado (`meta.schemaVersion`),
  `analyzeProject()` programático, capa de output desacoplada, golden file
  de consola byte a byte y esquema publicado (`docs/schema-v1.json`).
- **v1.0.x**: descubrimiento resiliente de fuentes (directorios hostiles,
  tsconfig sin `include`, opciones heredadas), publicación en npm.
