# Guía de ImpactWave

> **🌐 [English](GUIDE.en.md) | Español**

Guía para desarrolladores: qué hace la herramienta, cómo usarla y cómo interpretar sus reportes.

---

## 1. ¿Qué es?

**ImpactWave** es una CLI que analiza los cambios de código de un repositorio Git y responde la pregunta:

> **"¿Qué puedo romper con este cambio y qué debería probar?"**

Para ello combina:

- **Git**: identifica qué archivos cambiaron y en qué líneas.
- **AST** (ts-morph): entiende la estructura del código, no texto plano.
- **Análisis de símbolos**: determina qué funciones/clases/interfaces/tipos/constantes exportados se modificaron **físicamente** (intersección de rangos de líneas del AST con el diff). Las funciones flecha asignadas a `export const` cuentan como funciones.
- **Consumidores reales**: encuentra los usos activos de cada símbolo modificado (los `import` puros NO cuentan como impacto).
- **Grafo de dependencias**: qué archivos importan a qué archivos, directa y transitivamente.
- **Test mapping**: detecta archivos de test (`*.test.ts`, `*.spec.ts`) y qué código cubren.
- **Risk engine**: un score determinístico 0-100 con razones explicables.

## 2. Cómo se usa

### Requisitos

- Un repositorio Git local (la herramienta se ejecuta dentro de él).
- Proyecto TypeScript/JavaScript. El `tsconfig.json` en la raíz es opcional: si existe, aporta solo sus `compilerOptions` (aliases de rutas, decorators, target...). El descubrimiento de archivos siempre usa un recorrido propio que omite en silencio directorios sin permiso de lectura (ej. el `pg_data` de Docker); los campos `include`/`exclude` del tsconfig no se usan para el escaneo.

### Ejecución

```bash
# En la raíz del proyecto a analizar:
impactwave

# `analyze` es el comando por defecto: ambas formas son equivalentes.
# En desarrollo (desde el repo de la herramienta):
npm run dev
```

### Opciones

| Opción | Descripción |
|---|---|
| `-b, --base <branch>` | Rama base contra la que comparar. Si se omite, se autodetecta: `origin/HEAD` → `main`/`master` → `HEAD~1`. |
| `--risk-weights <json>` | Ajustar los pesos de los factores de riesgo (ver [2.1. Pesos configurables del riesgo](#21-pesos-configurables-del-riesgo)). |

### 2.1 Pesos configurables del riesgo

`--risk-weights` acepta un JSON con **cinco propiedades** (todas opcionales — las que no se incluyan valen `0`). Cada una pondera un factor del score:

| Propiedad JSON | Peso por defecto | Señal que pondera | Umbral de saturación |
|---|---|---|---|
| `callerImpact` | `30` | Consumidores directos de símbolos modificados | 10 consumidores |
| `affectedFiles` | `20` | Archivos alcanzados transitivamente (blast radius total) | 15 archivos |
| `dependencyDepth` | `15` | Profundidad máxima de la cascada de dependencias | 4 niveles |
| `testGaps` | `20` | Proporción de áreas afectadas sin tests | 100% sin cubrir |
| `changeSize` | `15` | Tamaño del cambio en líneas modificadas | 200 líneas |

**Cómo se calcula cada factor:** puntos = peso × saturación, donde la saturación va de 0 a 1 según el umbral. Ejemplos con los pesos por defecto:

- 5 consumidores → `callerImpact` = 30 × (5/10) = **15 pts**
- 40 archivos alcanzados → `affectedFiles` = 20 × 1 = **20 pts** (saturado)
- 2 de 4 áreas afectadas sin tests → `testGaps` = 20 × (2/4) = **10 pts**

**Reglas:**

- Los pesos no tienen que sumar 100: el score final se limita a 100.
- Si el peso de un factor es `0`, ese factor no aporta puntos (y su razón no aparece con puntos).
- Si el JSON incluye claves desconocidas o valores no numéricos, el comando falla con un error claro listando las claves válidas.
- El resto de la fórmula (umbrales y niveles `LOW/MEDIUM/HIGH/CRITICAL`) no es configurable en el MVP.

**Ejemplos:**

```bash
# Mismo riesgo para el proyecto, pero enfatizando la cobertura de tests:
impactwave --risk-weights '{"callerImpact":30,"affectedFiles":10,"dependencyDepth":10,"testGaps":35,"changeSize":15}'

# Solo interesan los consumidores (el resto de factores queda en 0):
impactwave --risk-weights '{"callerImpact":100}'
```

### Qué compara

La herramienta compara **commits** (`git diff base..HEAD`). El flujo completo:

1. Detecta el repositorio y la rama base.
2. Obtiene los archivos añadidos/modificados/eliminados.
3. Para cada archivo no borrado: extrae sus exports, intersecta las líneas modificadas con los rangos de los símbolos y localiza los consumidores de los símbolos tocados.
4. Construye el grafo de dependencias y el test mapping del proyecto.
5. Calcula el riesgo y genera el reporte.

## 3. Cómo leer el reporte

Ejemplo real: se modificó `PaymentService.calculate()` (cambio de tasa 0.19 → 0.21). El reporte se divide en bloques:

```
╭──────────────────────────────────────────────────────────╮
│ 🌊 IMPACTWAVE — BLAST RADIUS REPORT                     │
╰──────────────────────────────────────────────────────────╯
```
**Cabecera** — solo identifica el reporte.

```
 📂 Git Context
    ├─ Branch     : main
    └─ Comparing  : HEAD vs HEAD~1
```
**Contexto Git** — la rama actual y contra qué se comparó (la base).

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
**Evaluación de riesgo** — el bloque más importante:

- **Nivel**: `🟢 LOW` (0-25) · `🟡 MEDIUM` (26-50) · `🟠 HIGH` (51-75) · `🔴 CRITICAL` (76-100).
- **Score**: número determinístico; la misma entrada siempre produce el mismo score.
- **Reasons**: por qué el cambio es riesgoso, cada una con sus puntos. Si una razón no aporta puntos, contribuye 0. Si no hay consumidores: "No impacted consumers detected".

```
╭─ Impact Coverage ─────────────────────────────────────────╮
│ Affected components : 2                                   │
│ Covered             : 1                                   │
│ Uncovered           : 1                                   │
│ Impact coverage     : 50%                                 │
│ Uncovered:                                                │
│   ✗ payment/InvoiceService.ts                             │
╰──────────────────────────────────────────────────────────╯
```
**Cobertura de impacto** — métrica clave (diferente a la cobertura global de tests del proyecto):

- **Affected components**: archivos de producción afectados (los archivos de test no cuentan como áreas).
- **Impact coverage**: % de esas áreas que tienen al menos un test que las importa. Los archivos que solo exportan contratos o constantes (interfaces/tipos/enums, sin funciones, clases ni constantes con comportamiento) no son testeables por diseño y quedan fuera de la métrica.
- **Uncovered**: los archivos afectados **sin tests** — son exactamente lo que deberías probar.

```
╭──────────────────────────────────────────────────────────╮
│ 📄 [MODIFIED] payment/PaymentService.ts                  │
╰──────────────────────────────────────────────────────────╯
```
**Archivo** — un bloque por cada archivo cambiado. El estado puede ser `[MODIFIED]`, `[ADDED]` o `[DELETED]`.

```
    ├─ Exported symbols
    │    └─ ✏️  PaymentService (class, 1 method) (2 lines modified)
    │          └─ ✏️  calculate method modified
    │    └─ Invoice (interface)
```
**Símbolos exportados** — lo que el archivo expone al resto del proyecto. Para cada símbolo tocado por el diff:

- **✏️** — el símbolo fue tocado por el diff (no todo el archivo: solo las declaraciones cuyas líneas cambiaron).
- **`(N lines modified)`** — cuántas líneas del diff caen dentro de la declaración de ese símbolo.
- **Métodos como subárbol** — en clases, cada método **público** modificado se lista como nodo hijo del símbolo (`✏️  metodo method modified`). Los métodos privados/protegidos no se listan: no forman parte de la superficie que pueden consumir otros archivos.

Los símbolos sin ✏️ existen en el archivo pero no fueron tocados por este cambio.

```
    ├─ Detailed Downstream Usages
    │    ├─ 📂 Affected File: payment/CheckoutService.ts
    │         ├─ 🔸 Target Symbol: PaymentService (Line 4)
    │         │        💻 Code snippet : "constructor(...paymentService: PaymentService) {}"
    │         └─ 🔸 Target Symbol: PaymentService.calculate (Line 7)
    │                💻 Code snippet : "return this.paymentService.calculate(amount);"
```
**Usos downstream** — los consumidores **activos** del símbolo modificado, con el archivo, la línea y el snippet del uso. Útil para auditar cada punto de contacto del cambio. Las líneas de `import` puro se omiten (un import no ejecuta nada).

Hay dos niveles de granularidad: `PaymentService` lista las referencias a la **clase** (inyección por constructor, anotaciones de tipo) y `PaymentService.calculate` lista los **call sites del método modificado concreto** (`service.calculate(...)`). Los re-exports de barrel files (`export { X } from`) también cuentan como aristas: el consumidor real aparece aunque importe solo por el `index.ts`.

```
    ├─ Files in blast radius (imported by ↓) (1 direct, 3 total, depth 3)
    │    ├─ Level 1
    │    │     └─ payment/index.ts
    │    ├─ Level 2
    │    │     └─ checkout/CheckoutService.ts
    │    └─ Level 3
    │          └─ app.controller.ts
```
**Blast radius** — todos los archivos que **importan al archivo cambiado** (`imported by ↓` marca la dirección: estos archivos consumen lo que este archivo exporta, no al revés). Es dependencia **estática/posible**: si hay alcance transitivo aparece como `(X direct, Y total, depth Z)` y los archivos se agrupan por **nivel de cascada**: `Level 1` importa directamente al archivo cambiado, `Level 2` importa a alguien de `Level 1`, y así sucesivamente.

Este bloque es informativo: el riesgo real NO se calcula sobre él, sino sobre los usos reales de símbolos (bloque anterior).

> **Nota sobre ciclos**: si dos archivos se importan mutuamente (ej. un controller que importa el service para inyectarlo, y el service que importa DTOs/interfaces declarados dentro del controller), cada tarjeta listará a la otra en su blast radius — ambas entradas son correctas. Para eliminar ese ruido, extrae los tipos compartidos a un archivo propio (ej. `withdraws.dto.ts`).

```
    └─ Related Tests
         ├─ ✓ payment/CheckoutService.test.ts
         └─ ✓ payment/PaymentService.test.ts
```
**Tests relacionados** — los archivos de test que cubren este archivo (✓) o la advertencia (✗) si ninguno lo cubre.

```
╭─ Analysis Summary ───────────────────────────────────────╮
│ Files analyzed       : 1                                  │
│ Test files detected  : 2                                  │
│ Tests on affected    : 1                                  │
│ Dependent files      : 4                                  │
│ Risk level           : 🟡 MEDIUM RISK                     │
│ Impact coverage      : 50%                                │
╰──────────────────────────────────────────────────────────╯
```
**Resumen** — totales del análisis.

```
 💡 Recommended Action
    Run tests covering the dependent files listed above...
    ⚠️  These affected areas have no detected tests:
    ├─ payment/InvoiceService.ts
    └─ Consider adding tests before merging.
```
**Acción recomendada** — qué hacer con la información: ejecutar tests de las áreas afectadas y, si hay zonas sin tests, escribirlos antes del merge.

## 4. Interpretación rápida

| Señal | Qué significa |
|---|---|
| ✏️ `(modified)` en un símbolo | El símbolo fue tocado por el diff |
| `(N lines modified)` en un símbolo | Cuántas líneas del diff caen dentro de su declaración |
| `✏️  metodo method modified` (bajo la clase) | Método concreto de la clase tocado por el diff (solo métodos públicos) |
| `score` alto + `CRITICAL` | Cambio en código muy consumido, con poca cobertura o gran profundidad |
| `Impact coverage` bajo | Las áreas afectadas no están cubiertas por tests — el riesgo real puede ser mayor que el score global |
| Archivo en "Uncovered" | Área afectada sin tests → candidato a escribir tests |
| `Blast radius (imported by ↓)` | Los archivos listados importan al cambiado; si tu archivo también los importa, es un ciclo |
| `Blast radius (X direct, Y total, depth Z)` | La dependencia se propaga en cascada (Z niveles) |
| "No impacted consumers detected" | Cambio sin consumidores → riesgo bajo por defecto |

## 5. Limitaciones conocidas

- Compara commits; los cambios **sin commitear** en el working tree no se analizan.
- La cobertura de tests se basa en imports **directos** de los archivos de test (no transitiva).
- El grafo solo considera imports relativos (no `node_modules` ni path aliases no relativos).
- La granularidad de "símbolo modificado" es la declaración top-level; dentro de clases, el reporte indica además los métodos públicos concretos modificados (los privados/protegidos no se reportan).
- **En monorepos**: el análisis cubre siempre `<raíz>/src/**/*.ts`. Si el proyecto tiene código fuera de `src/` (ej. `packages/`, `app/`, tsconfigs por workspace), esos archivos no se cargan y sus símbolos no aparecen en el reporte. El soporte completo de monorepos (múltiples tsconfigs y directorios arbitrarios) está planificado en `ROADMAP.md` como mejora futura, fuera del alcance del MVP.
- **Directorios ilegibles**: carpetas sin permiso de lectura (ej. `pg_data` de Docker) se omiten del análisis en silencio; nunca abortan la ejecución.

## 6. Más información

- [README.md](../README.md) — descripción general del proyecto (también en [English](../README.en.md)).
- [GUIDE.en.md](GUIDE.en.md) — versión en inglés de esta guía.
- `test/fixtures/` — proyectos de ejemplo usados por la suite de tests (`npm test`).