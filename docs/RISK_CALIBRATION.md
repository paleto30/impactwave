# Risk Calibration

Referencia empírica para ajustar `DEFAULT_RISK_WEIGHTS` en
`src/engine/risk/risk.constants.ts`.

## Mapeo objetivo

| Tipo de commit | Score esperado |
|---|---|
| Cambio aislado (1 archivo, sin dependientes) | `0-25 LOW` |
| 2-4 dependientes directos sin tests | `26-50 MEDIUM` |
| Blast radius transitivo amplio (>10 archivos) y/o símbolos core sin tests | `51-75 HIGH` |
| Cambios masivos (scaffolding, arquitectura) | `76-100 CRITICAL` |

## Medición — commits reales del propio proyecto (dogfooding)

10 commits del historial del repositorio, con los pesos por defecto. Método
reproducible: cada commit se materializa en un `git worktree` propio y se
analiza con el motor actual mediante `analyze -b <commit>~1`, de modo que
las mediciones son comparables entre sí y con el código de hoy.

| Commit | Tipo | Archivos | Score | Nivel |
|---|---|---|---|---|
| `77ef87e` | feature (formato de reporte) | 1 | 10 | LOW |
| `dc26015` | test (borra un comentario dentro de un enum muy consumido) | 1 | 40 | MEDIUM |
| `8d1f131` | test | 2 | 13 | LOW |
| `b91a5bd` | feature (presentación visual) | 1 | 23 | LOW |
| `f7762c0` | refactor (símbolos usados) | 4 | 43 | MEDIUM |
| `bb28a6c` | test (toca símbolo con 4 consumidores sin tests) | 1 | 40 | MEDIUM |
| `69bf6ae` | scaffolding masivo (MVP completo) | 32 | 85 | CRITICAL |
| `36f637e`, `8d53665`, `c05caa8` | docs / config | 3-5 | 0 | LOW |

## Conclusiones

- Los pesos actuales producen el mapeo objetivo: commits típicos → LOW,
  cambios con consumidores reales sin tests → MEDIUM, scaffolding masivo →
  CRITICAL. **No se requieren cambios de pesos.**
- Caso de referencia útil: un cambio de 1 línea en un símbolo consumido por
  4 archivos sin tests da 40 pts (MEDIUM) — 12 pts de consumidores + 20 pts
  de test gaps. Si un commit típico del proyecto supera esto de forma
  recurrente, revisar primero la cobertura de tests (no los pesos).
- Los commits de solo docs/config dan 0: ningún archivo TypeScript cambia,
  así que no hay símbolos ni grafo que evaluar.
- **`dc26015` es el caso límite del modelo, y conviene citarlo como tal.**
  El commit solo borra un comentario dentro de `enum FileStatus`, un símbolo
  con 4 consumidores y 2 áreas afectadas sin tests: el score sube a 40
  (MEDIUM) por un cambio sin efecto en tiempo de ejecución. Es la limitación
  de granularidad documentada en `docs/GUIA.md` §5.3 — la intersección de
  líneas no distingue código de comentarios — y aplica por igual a comentarios
  añadidos y borrados. Sobreestimar el riesgo de un cambio inocuo es el error
  aceptable; el inverso (callar un cambio real) no lo es.

## Vigencia de la medición

- **Motor con el que se midió**: estado de `master` en el commit `8ddac8b`,
  es decir la versión 1.2.0 del paquete más las correcciones de precisión
  publicadas en la 1.3.0 (detección de cambios que
  solo borran líneas, clasificación del cableado por AST, renombrados
  comparados contra su contenido anterior y redondeo por factor).
- **Fecha**: septiembre de 2026.
- **Reproducción**: cada commit se materializa en un `git worktree` propio y
  se analiza con `analyze -b <commit>~1` usando ese motor, de modo que la
  medición no depende del estado del working tree ni del orden de ejecución.
- **Cuándo deja de ser válida**: cualquier cambio en los pesos, los umbrales,
  los niveles o el mecanismo de detección de símbolos invalida esta tabla. En
  ese caso hay que volver a medir con el mismo procedimiento, nunca ajustar
  los valores a mano.

Frente a la medición anterior a esas correcciones solo cambiaron dos filas:
`dc26015` (8 → 40, por el borrado que antes era invisible) y `69bf6ae`
(84 → 85, por el redondeo por factor). El resto de los puntajes es idéntico,
lo que indica que las correcciones no desplazaron la calibración general del
modelo.
