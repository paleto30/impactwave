# Roadmap

Criterio de foco: una mejora entra aquí solo si hace que el **núcleo de
análisis** (símbolos modificados, consumidores, grafo, cobertura de impacto,
score) sea más **correcto o más preciso** en proyectos TypeScript reales.
Todo lo demás — superficies nuevas, comandos auxiliares, integraciones — se
mantiene aparcado al final de este documento hasta que el núcleo sea
confiable en los escenarios difíciles.

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

- **v1.2.0**: precisión del núcleo — imports dinámicos (`import()`/`require()`
  con argumento estático) crean aristas en el grafo y lo no resoluble se
  reporta con warning; cobertura de tests transitiva vía grafo con tope de
  profundidad (4 saltos, configurable); re-exports (`export { X } from`,
  `export *`) clasificados como cableado pasivo; peso opcional
  `testCallerImpact` para no inflar el score con tests. Documentación del
  alcance de descubrimiento corregida (symlinks no se siguen).

- **v1.1.0**: salida JSON con contrato versionado (`meta.schemaVersion`),
  `analyzeProject()` programático, capa de output desacoplada, golden file
  de consola byte a byte y esquema publicado (`docs/schema-v1.json`).
- **v1.0.x**: descubrimiento resiliente de fuentes (directorios hostiles,
  tsconfig sin `include`, opciones heredadas), publicación en npm.
