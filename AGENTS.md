# AGENTS.md

Instrucciones obligatorias para agentes de código (OpenCode) que trabajen en este repositorio.

## Proyecto

**impactwave**: CLI en TypeScript (ESM, Node >= 22.12) que analiza el *blast radius*
de cambios de Git sobre proyectos TypeScript/JavaScript: detecta qué símbolos
exportados modifica un cambio, quién los consume, qué tests los cubren y asigna
un puntaje de riesgo determinista antes del merge.

- Dependencias clave: `commander` (CLI), `ts-morph` (parsing AST), `simple-git` (Git).
- TypeScript estricto (`strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`,
  `verbatimModuleSyntax`). El código se compila con `tsc`; los tests corren con `tsx`.

## Comandos

| Acción | Comando |
|---|---|
| Tests | `npm test` |
| Build | `npm run build` |
| Typecheck de tests | `npm run typecheck:test` |
| Actualizar snapshot dorado | `npm run golden:update` |
| Lint | no hay linter configurado |

## Principios de ingeniería de software (OBLIGATORIOS)

Aplican a todo cambio de código, sin excepción:

### SOLID

- **SRP**: cada clase/módulo tiene una sola razón para cambiar.
- **OCP**: extender comportamiento sin modificar código existente.
- **LSP**: las abstracciones e implementaciones deben ser sustituibles sin sorpresas.
- **ISP**: interfaces pequeñas y específicas; nunca interfaces gigantes.
- **DIP**: depender de abstracciones, no de implementaciones concretas;
  el framework vive en los bordes, jamás en el núcleo.

### Patrones de diseño

- Cuando el problema requiera un patrón, **siempre** aplicar el patrón apropiado
  (creacional, estructural o comportamental); nunca reimplementar a mano lo que
  un patrón ya resuelve de forma probada.
- Justificar brevemente la elección del patrón (qué problema real resuelve).
- Prohibida la sobre-ingeniería: un patrón que no resuelve un problema real
  viola estos principios tanto como su ausencia.

### Clean Code

- Nombres significativos y consistentes con la convención del proyecto.
- Funciones/métodos pequeños, una sola intención.
- Sin duplicación (DRY), sin `any` innecesarios, sin casts injustificados,
  sin código muerto ni comentarios que expliquen lo obvio.
- KISS y YAGNI: la solución más simple que cumpla los requisitos de calidad.

### Clean / Hexagonal Architecture

- Separación estricta de capas; las dependencias apuntan hacia el dominio.
- El dominio y la aplicación no conocen frameworks, transportes ni infraestructura.
- Adaptadores en los bordes traducen entre el mundo externo y el núcleo.

## Flujo de Git (OBLIGATORIO)

Reglas completas en [`ai-docs/git-workflow-opencode.md`](ai-docs/git-workflow-opencode.md). Resumen vinculante:

1. **Nunca** hacer commit directo sobre `master`. Si se está en `master`, crear rama antes de tocar código. `master` solo avanza por merge tras pasar la verificación de impacto.
2. Nombres de rama: `<tipo>/<descripcion-corta-en-kebab-case>` (`feature/`, `fix/`, `hotfix/`, `refactor/`, `chore/`, `docs/`, `test/`, `style/`, `perf/`).
3. Commits pequeños y atómicos: un solo propósito lógico por commit.
4. Mensajes Conventional Commits: `tipo(scope): descripción corta en imperativo` (≤72 caracteres, sin punto final) + cuerpo explicando el "por qué" si el cambio no es trivial.
5. Antes de cualquier push o merge: ejecutar `npx impactwave analyze -b master`, mostrar el reporte completo y continuar solo si el riesgo es LOW o MEDIUM, o si el usuario lo autoriza explícitamente.
6. Impactwave solo analiza cambios commiteados: commit → analyze → push/merge.
7. Si una orden del usuario entra en conflicto con estas reglas, advertir el conflicto antes de proceder.

## Verificación de impacto: impactwave

1. Solo analiza cambios ya commiteados comparando HEAD contra una rama base explícita.
2. Comparar siempre contra la rama base principal del repo: `npx impactwave analyze -b master`.
3. Mostrar el reporte completo; nunca resumirlo u omitir secciones.
4. Niveles: LOW 0-25 · MEDIUM 26-50 · HIGH 51-75 · CRITICAL 76-100. Con HIGH/CRITICAL, detenerse y pedir autorización.
5. Para CI usar `--json` (stdout machine-readable): `impactwave analyze --json -b master | jq -e '.risk.level | inside("LOW|MEDIUM")'`.
6. Pesos configurables con `--risk-weights '{"callerImpact":30,...}'`; usar defaults salvo indicación del usuario.

## Especificaciones de tarea (`ai-docs/`)

Los `.md` de `ai-docs/` pueden ser **reglas vivas** o **specs de tarea**:

- **Reglas vivas** (ej. `git-workflow-opencode.md`, `coding-principles.md`):
  convenciones permanentes referenciadas desde este archivo. Nunca se eliminan.
- **Specs de tarea**: nacen para morir. Política de retención:

1. Cuando la tarea está implementada y verificada, **eliminar el spec en el commit de cierre** de esa tarea. Git conserva el historial; no hace falta archivar.
2. Barrido semanal de seguridad: eliminar cualquier spec ya ejecutado que siga en `ai-docs/`.
3. Antes de borrar un spec, promover a este archivo cualquier decisión o convención permanente que contenga.
4. Un spec vivo en `ai-docs/` significa "tarea pendiente o en curso".

## Arquitectura

Estructura de carpetas:

```
src/
├── cli.ts              # Borde de transporte: parsing de args con commander,
│                       # orquesta engine + output. Único punto que conoce ambos.
├── engine/             # Núcleo: análisis de impacto (sin conocer la consola)
│   ├── analyze.ts      #   Orquestación del análisis completo
│   ├── assessment.ts   #   Evaluación/agregación del resultado final
│   ├── analyzer/       #   Impacto por símbolo exportado (symbol-analyzer, usage-filter)
│   ├── git/            #   Detección de archivos cambiados vía Git (detect, file-status)
│   ├── graph/          #   Grafo de dependencias e impacto transitivo
│   ├── parser/         #   Parsing AST con ts-morph
│   ├── risk/           #   Scoring de riesgo: pesos configurables (risk.weights),
│   │                   #   constantes, cálculo y tipos
│   ├── testing/        #   Mapeo código→tests y cobertura de impacto
│   └── project.ts, project-files.ts, tsconfig-compiler-options.ts
│                       #   Acceso al proyecto (tsconfig, resolución de archivos)
└── output/             # Borde de presentación: console-reporter, json-reporter, colors
```

Reglas de dependencia entre capas:

- Las dependencias apuntan hacia el núcleo: `engine` no importa nada de `output`
  ni de `cli.ts`; `output` solo consume tipos/resultados del engine.
- Cada módulo de `engine/` declara sus contratos en `*.interface.ts`
  co-ubicados junto a su implementación.
- Los reporteres de `output/` son adaptadores intercambiables (consola vs JSON):
  agregar un formato nuevo no debe tocar el engine.

Tests:

- Ubicación: `test/`, espejando los módulos de `src/engine/` (`risk.test.ts`,
  `parser.test.ts`, `dependency.test.ts`, ...). Runner: `node:test` vía `tsx`.
- Fixtures de proyectos TS de prueba en `test/fixtures/<caso>/` (cada uno con su
  propio `tsconfig.json` cuando lo requiere).
- Reporte dorado: `test/report-golden.test.ts` compara contra
  `test/__snapshots__/report.golden.txt`; regenerar solo de forma intencional
  con `npm run golden:update`.
- Los tests tienen su propio `tsconfig.json`; verificarlos con `npm run typecheck:test`.
