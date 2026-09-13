# Ficha técnica del motor

Estado factual del motor de impactwave, verificado contra el código. Cada
afirmación indica el archivo y la función donde se implementa. Este documento
no argumenta ni compara: describe lo que el código hace hoy.

---

## 1. Extensiones que entran al análisis

| Entra | No entra |
|---|---|
| `.ts`, `.tsx`, `.mts`, `.cts` | `.js`, `.jsx`, `.mjs`, `.cjs`, y cualquier otra |

- Regla única: `TYPESCRIPT_FILE = /\.(?:tsx?|mts|cts)$/i` y el predicado
  `isAnalyzableSourceFile` — `src/engine/project-files.ts`.
- El descubrimiento recorre el árbol desde la raíz del proyecto
  (`collectTypeScriptFiles`, mismo archivo) y **omite**: `node_modules`, `dist`,
  `build`, directorios cuyo nombre empieza por `.`, enlaces simbólicos
  (`entry.isSymbolicLink()`) y directorios cuya lectura falla.
- Un archivo cambiado fuera de alcance no se parsea: se cuenta como omitido
  (`skippedFiles`) en `collectChangedFileAnalyses` — `src/engine/analyze.ts`.
- Si el cambio toca `.js/.jsx/.mjs/.cjs`, se emite la advertencia
  `unsupported-source-files` (`warnUnsupportedSourceFiles`, mismo archivo).

## 2. Etapas del pipeline de `analyzeProject`

Orden real de ejecución en `src/engine/analyze.ts`:

| # | Etapa | Implementación |
|---|---|---|
| 0 | Detección del repositorio | `detectRepo` — `src/engine/git/detect.ts` |
| 1 | Resolución de la rama base | `resolveBaseBranch` → `detectBaseBranch` — `analyze.ts`, `git/detect.ts` |
| 2 | Validaciones de entrada (base existente, pesos) | `branchExists`, `parseRiskWeights` — `git/detect.ts`, `risk/risk.weights.ts` |
| 3 | Carga del proyecto AST | `getProject` → `readTsConfigCompilerOptions` + `addProjectSourceFiles` — `project.ts`, `tsconfig-compiler-options.ts`, `project-files.ts` |
| 4 | Archivos cambiados y aviso de lenguaje fuera de alcance | `getChangedFiles`, `warnUnsupportedSourceFiles` |
| 5 | Análisis por archivo: líneas, símbolos, consumidores | `collectChangedFileAnalyses` → `getModifiedLines`, `analyzeFile`, `SymbolAnalyzer` |
| 6 | Grafo de dependencias y aviso de dinámicos no resueltos | `buildDependencyGraph`, `warnUnresolvedDynamicImports` — `graph/dependency.ts` |
| 7 | Mapeo de pruebas (reutiliza el grafo) | `buildTestMapping` — `testing/test-mapping.ts` |
| 8 | Construcción de ítems del reporte | `generateReport` + `wireReportData` — `assessment.ts`, `analyze.ts` |
| 9 | Evaluación (cobertura, riesgo, conteos) | `computeAssessment` → `computeImpactCoverage`, `evaluateRisk` |
| 10 | Salida | `printConsoleReport` / `printJsonReport` — `src/output/` |

## 3. Símbolos exportados que se detectan como modificados

Extracción (`analyzeFile` — `src/engine/parser/parser.ts`):

funciones, clases (con su lista de métodos), interfaces, alias de tipo,
enumeraciones y variables exportadas. Las funciones flecha y expresiones de
función asignadas a un `export const` se clasifican como **funciones**, no como
variables (`Node.isArrowFunction` / `Node.isFunctionExpression`).

Criterio de "modificado" (`SymbolAnalyzer` — `src/engine/analyzer/symbol-analyzer.ts`):

- `getModifiedSymbolNames`: intersección entre las líneas del diff y el rango
  `getStartLineNumber()`–`getEndLineNumber()` de la declaración.
- `getModifiedSymbolLineCounts`: cuántas líneas del diff caen dentro del rango.
- `getModifiedClassMethods`: métodos de clase alcanzados por el diff. Excluye
  los privados y protegidos (`method.getScope() !== Scope.Public`) y los
  privados de ECMAScript (`#`).

Las líneas del diff provienen de `getModifiedLines` (`git/detect.ts`), que
registra las líneas añadidas y, para las eliminadas, la posición que ocupaba el
código borrado.

## 4. Criterio de "consumidor real"

- Recolección: `collectConsumers` (`symbol-analyzer.ts`) usa `findReferences()`
  sobre el nodo del símbolo; descarta la definición (`refNode.isDefinition()`) y
  deduplica por `archivo:línea`. Cada consumidor guarda archivo, línea y el
  texto de la línea.
- Clasificación: `isImportOnlyReference` (`src/engine/analyzer/usage-filter.ts`)
  marca `importOnly: true` cuando la referencia tiene un ancestro
  `ImportDeclaration` o `ExportDeclaration` (`getFirstAncestor`).

| Descarta (`importOnly: true`) | Conserva como uso activo |
|---|---|
| `import` en todas sus formas, incluida la multilínea | Llamadas y construcciones (`servicio.metodo()`, `new Clase()`) |
| `import type` | Anotaciones de tipo y inyección por constructor |
| Re-exportaciones `export { X } from`, `export *`, `export * as NS` | `import("./x")` dinámico (es una `CallExpression`) |
| Listas `export { X }` sin módulo | `export default build(X)` (es una `ExportAssignment`) |

Los consumidores marcados `importOnly` **no se filtran del JSON**: viajan con la
bandera. El filtrado ocurre en el conteo de riesgo (`computeAssessment`) y en el
listado de consola.

## 5. Relaciones que construyen el grafo

`buildDependencyGraph` — `src/engine/graph/dependency.ts`.

Crean arista (ambas direcciones: `dependents` e `imports`):

- `import ... from "./x"` (`getImportDeclarations`).
- `export ... from "./x"` (`getExportDeclarations`) — es lo que hace visibles
  los barrel files.
- Cargas dinámicas con argumento estático: `import("./x")`, `require("./x")`,
  `require.resolve("./x")` (`getDynamicCallKind` + `getStaticSpecifierText`).
  Estático significa literal de cadena o plantilla sin sustituciones.

No crean arista:

- Especificadores que no empiezan por `.` (paquetes de `node_modules`, alias no
  relativos): se ignoran por política.
- Argumentos dinámicos no estáticos (plantillas con variables, concatenación) y
  relativos que no resuelven a un archivo cargado: se **cuentan** por archivo en
  `unresolvedDynamicImports` y se reportan con la advertencia
  `unresolved-dynamic-imports`.

Heurística documentada en el código: todo identificador llamado `require` se
trata como CommonJS `require`.

## 6. Pruebas y áreas afectadas

- Archivo de prueba: `isTestFile` (`src/engine/testing/test-mapping.ts`) exige
  `/\.(test|spec)\.[^.]+$/i` **y** que la extensión esté dentro del alcance
  (`isAnalyzableSourceFile`).
- Cobertura: `buildTestMapping` recorre hacia adelante desde cada archivo de
  prueba (`findTransitiveFiles(..., "imports")`) con tope
  `DEFAULT_TEST_COVERAGE_DEPTH = 4` saltos, configurable por llamada.
- No cuentan como área afectada (`computeImpactCoverage` —
  `testing/impact-coverage.ts`): los archivos de prueba, y los archivos cuyo
  análisis no expone **ninguna** función ni clase (`functions.length === 0 &&
  classes.length === 0`), es decir, los que solo exportan contratos o
  constantes.

## 7. Factores de riesgo

`evaluateRisk` — `src/engine/risk/risk.ts`; constantes en `risk.constants.ts`.

| Factor | Peso | Umbral | Dato de entrada | Etapa de origen |
|---|---|---|---|---|
| `callerImpact` | 30 | 10 consumidores | Archivos únicos con uso activo de símbolos modificados | Etapa 5 (referencias AST) |
| `testCallerImpact` | *(ausente por defecto)* | 10 consumidores | Los consumidores que son archivos de prueba | Etapa 5 |
| `affectedFiles` | 20 | 15 archivos | Alcance transitivo del archivo cambiado | **Grafo estático** (etapa 6) |
| `dependencyDepth` | 15 | 4 niveles | Profundidad máxima de la cascada | **Grafo estático** (etapa 6) |
| `testGaps` | 20 | proporción | Áreas afectadas sin pruebas | Etapa 7 y 9 |
| `changeSize` | 15 | 200 líneas | Total de líneas modificadas | Etapa 5 |

**Derivados del grafo estático: `affectedFiles` + `dependencyDepth` = 35 de 100
puntos por defecto, es decir el 35 % del puntaje máximo.**

Hecho verificado con consecuencias: esos dos factores se calculan en
`generateReport` (`assessment.ts`) sobre **todos** los archivos cambiados,
mediante `findTransitiveDependents`, sin condicionarse a que algún símbolo
exportado haya resultado modificado. Un cambio que no marca ningún símbolo
—por ejemplo, editar solo una línea de `import`— sigue acumulando puntos por
estos dos factores.

Cálculo del puntaje: cada factor se redondea una sola vez y el puntaje es la
suma de esos puntos, limitada por `MAX_SCORE` (`evaluateRisk`). Las razones que
imprime el reporte suman exactamente el puntaje salvo cuando satura en 100.

Validación de pesos: `parseRiskWeights` (`risk.weights.ts`) comprueba
únicamente que las claves pertenezcan a `RISK_WEIGHT_KEYS` y que los valores
sean números finitos. **No valida que la suma sea 100.**

## 8. Umbrales de los niveles de riesgo

`classifyRisk` — `src/engine/risk/risk.ts`, con constantes de `risk.constants.ts`:

| Nivel | Rango |
|---|---|
| LOW | 0 – 25 (`LOW_MAX`) |
| MEDIUM | 26 – 50 (`MEDIUM_MAX`) |
| HIGH | 51 – 75 (`HIGH_MAX`) |
| CRITICAL | 76 – 100 (`MAX_SCORE`) |

## 9. Mecanismos de verificación existentes

- **Suite de pruebas**: 14 archivos en `test/`, ejecutados con `node:test` vía
  `tsx` (`npm test`).
- **Snapshot dorado**: `test/report-golden.test.ts` compara la salida de consola
  byte a byte contra `test/__snapshots__/report.golden.txt`; se regenera
  deliberadamente con `UPDATE_GOLDEN=1` (`npm run golden:update`).
- **Validación de esquema**: `test/analyze.test.ts` valida la salida `--json`
  real contra `docs/schema-v1.json` usando Ajv (`Ajv2020`).
- **Verificación de tipos de las pruebas**: `npm run typecheck:test`
  (`test/tsconfig.json`).
- **Fixtures** en `test/fixtures/`: cadena simple, dependencias circulares,
  barrel files, cobertura de pruebas directa y transitiva, imports dinámicos
  resolubles y no resolubles, y formas de import multilínea.

## 10. Limitaciones conocidas y su causa técnica

| Limitación | Causa técnica |
|---|---|
| Un cambio no funcional (comentario, formato) dentro del rango de un símbolo lo marca como modificado | El criterio es intersección de rangos de línea (`getModifiedSymbolNames`), no comparación semántica del símbolo entre revisiones |
| Los archivos eliminados no aportan símbolos ni consumidores | `collectChangedFileAnalyses` salta `FileStatus.Deleted`, y el grafo se construye sobre el estado de `HEAD`, donde el archivo ya no existe |
| Los factores del grafo puntúan aunque no cambie ningún símbolo exportado | `generateReport` calcula el alcance transitivo por archivo cambiado, sin depender del marcado de símbolos |
| Los imports dinámicos con argumento no estático no se resuelven | Determinar el destino exigiría ejecutar el programa; se registran en `unresolvedDynamicImports` y se advierten |
| No se siguen alias de rutas ni dependencias de `node_modules` | El grafo solo acepta especificadores que empiezan por `.` |
| En monorepos solo se usa el `tsconfig.json` de la raíz | `getProject` lee un único tsconfig desde `projectRoot` |
| Un test que importa la raíz no cubre todo el proyecto, pero tampoco cubre más allá de 4 saltos | Tope `DEFAULT_TEST_COVERAGE_DEPTH`, elegido por simetría con `DEPENDENCY_DEPTH_THRESHOLD` |
| Un cambio cuyo impacto real está en JavaScript puede reportarse como aislado | El lenguaje está fuera del alcance de descubrimiento; se mitiga con la advertencia `unsupported-source-files`, no se elimina |
| Un identificador local llamado `require` se interpreta como CommonJS | Heurística declarada en `getDynamicCallKind` |
| Los cambios sin confirmar no se analizan | El análisis compara `base..HEAD` con `git diff` |

---

## Afirmaciones NO VERIFICADAS

Ninguna. Todo lo anterior se contrastó contra el código de la versión 1.3.0.
