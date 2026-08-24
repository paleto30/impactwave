ROL Y MODO DE TRABAJO

Actúa como un ingeniero senior de compiladores/análisis estático, especializado en grafos de dependencias, resolución de módulos JS/TS y sistemas de scoring. No optimices por velocidad de respuesta: optimiza por corrección demostrable. Usa todo el presupuesto de razonamiento que necesites antes de tocar código — modela el problema, enumera casos borde, y solo entonces implementa.

Reglas de trabajo obligatorias para TODO este trabajo:

TDD estricto: por cada uno de los 4 puntos, primero escribe el test de regresión que reproduce el bug actual (debe fallar en HEAD), luego implementa el fix, luego confirma que el test pasa y que la suite completa sigue verde.
No asumas la implementación actual sin leerla. Antes de proponer un fix, abre y cita las funciones exactas involucradas (dependency.ts, test-mapping.ts, usage-filter.ts, assessment.ts). Si algo del comportamiento actual no es evidente por el código, instrumenta o añade un test exploratorio para confirmarlo antes de asumir.
Criterio de foco (no te desvíes de esto): una mejora solo es válida si hace que el núcleo (símbolos modificados, consumidores, grafo, cobertura de impacto, score) sea más correcto o más preciso en proyectos TypeScript reales. Rechaza explícitamente cualquier refactor cosmético, mejora de performance sin impacto en precisión, o cambio de estilo que no toque estos 4 puntos + la corrección de docs.
Complejidad algorítmica es parte del entregable: para cada fix que toque el grafo, indica la complejidad temporal/espacial antes y después, y justifica si el trade-off es aceptable para proyectos reales (miles de archivos, imports circulares posibles).
Ciclos: el grafo de dependencias en TS/JS reales tiene ciclos (import/require circulares, barrels re-exportando entre sí). Cualquier traversal nuevo (BFS/DFS) debe tener detección de visitados y ser demostrablemente terminante. Prueba esto con un test específico de ciclo.
LOS 4 PUNTOS (en orden de implementación)
1. Imports dinámicos invisibles al grafo

Archivo: src/engine/graph/dependency.ts

Problema: import("./x") (import dinámico) y require("./x") no generan aristas en el grafo, por lo que un consumidor real queda fuera del blast radius.
Antes de codificar: enumera TODAS las formas sintácticas que hay que cubrir y decide explícitamente cuáles quedan dentro/fuera del alcance, documentándolo:
import("./x") estático con string literal
import(\./x/${variable}`)` con template literal (¿resolvible parcialmente? decide y documenta la heurística)
require("./x") y require.resolve("./x")
import("./x").then(...)
dynamic import dentro de funciones condicionales/async
Usa el AST ya disponible (no regex) para localizar CallExpression con callee import o identifier "require", y extrae el argumento string cuando sea estático. Para argumentos no estáticos (template literals con variables, concatenación), documenta que no son resolubles y decide si se marca el nodo como "dependencia dinámica no resuelta" en vez de omitirlo silenciosamente — esto también es información valiosa para el usuario del blast radius.
Test de regresión mínimo: un archivo A que hace require("./b") condicional y otro que hace import("./c"); el blast radius de B y C debe incluir A.
Añade también un caso con import dinámico dentro de un ciclo (A→dynamic→B→estático→A) para validar que no rompe el traversal.
2. Cobertura de tests solo directa (no transitiva)

Archivo: src/engine/testing/test-mapping.ts

Problema: getRelatedTests solo mira imports directos del archivo de test. Si test.ts importa A, y A importa B (el símbolo modificado), el test no se cuenta como cobertura aunque sí lo cubra en la práctica.
Fix: resolver transitivamente reutilizando el mismo grafo de dependencias (no dupliques lógica de traversal — si no existe ya una función de cierre transitivo genérica en el grafo, créala una vez y reutilízala aquí y en cualquier otro lugar que la necesite).
Rigor algorítmico:
Implementa el cierre transitivo como BFS/DFS con memoización de visitados (evita explosión combinatoria y ciclos infinitos).
Decide y documenta explícitamente si hay un límite de profundidad de transitividad (proyectos reales pueden tener cadenas de 10+ niveles; sin límite, un test que importa el index.ts raíz del proyecto "cubriría" todo el codebase, lo cual es un falso positivo de precisión). Propón una heurística razonada (p. ej. profundidad configurable, o peso decreciente por distancia en el grafo en vez de corte binario) y justifícala matemáticamente antes de implementarla — este es el punto de mayor riesgo de introducir un nuevo problema de precisión mientras arreglas otro.
Test de regresión: cadena test→A→B→C (3 niveles) donde se modifica C; test debe aparecer como cobertura. Test adicional que confirme que el límite/peso de profundidad evita el falso positivo del "importa todo desde index.ts".
3. Filtro frágil de usos pasivos

Archivo: src/engine/analyzer/usage-filter.ts

Problema: isImportOnlyUsage no reconoce export { X } from "./y" (re-export) como cableado de contrato, y puede clasificarlo como uso activo cuando en realidad es pass-through.
Antes de fixear, enumera TODAS las variantes de re-export en TS/JS que deben tratarse igual:
export { X } from "./y"
export { X as Y } from "./y" (renombrado)
export * from "./y" (barrel completo)
export * as NS from "./y" (namespace re-export)
export default re-exportado vía export { default } from "./y"
Para cada variante, decide explícitamente si cuenta como "uso pasivo" (cableado) o si hay algún caso donde deba tratarse como uso activo (p. ej. si el símbolo se transforma o se combina con otros antes de re-exportarse — en ese caso ya no es puro passthrough).
Test de regresión con al menos 3 de las variantes anteriores, más un caso de uso genuinamente activo (uso del símbolo dentro de una función) para confirmar que el filtro no se vuelve demasiado permisivo y empieza a ocultar usos reales.
4. Los tests inflan el score

Archivo: src/engine/assessment.ts

Problema: un test que consume el símbolo modificado suma en callerImpact igual que un consumidor de producción, lo que puede penalizar dos veces (el test ya se cuenta en cobertura Y en impacto) o distorsionar el score.
Decisión de diseño requerida: introducir un factor separado testCallerImpact en vez de mezclar con callerImpact.
Formula explícitamente cómo entra este factor en el score final (¿suma con peso propio? ¿es informativo pero no penalizante? ¿reduce el score de riesgo si hay buena cobertura de test caller impact?). Escribe la fórmula matemática completa antes/después, no solo código.
Debe ser backward compatible por defecto: si testCallerImpact no se configura, el comportamiento de scoring debe ser equivalente al actual (o migrar con una tabla de mapeo de pesos documentada explícitamente, mostrando cómo el peso viejo se reparte entre callerImpact y testCallerImpact).
Documenta en el changelog la migración de pesos con un ejemplo numérico antes/después sobre un caso real del repo.
Test de regresión: un símbolo modificado consumido por 1 archivo de producción y 2 archivos de test; verificar que el score con la config por defecto es idéntico al comportamiento pre-fix, y que con testCallerImpact habilitado el desglose refleja la separación.
DOCUMENTACIÓN

Corrige toda referencia a que el análisis cubre <raíz>/src/**/*.ts. El descubrimiento real recorre todo el árbol del proyecto, con estas exclusiones/comportamientos que hay que documentar con precisión:

Omite node_modules, dist, build
Omite directorios ocultos (.git, etc.)
Maneja symlinks (documenta si los sigue o no, y por qué — si los sigue sin protección de ciclos, es un bug quinto a reportar, no solo documentar)
Maneja rutas ilegibles (permisos) sin crashear el análisis completo

Verifica el comportamiento real leyendo el código de descubrimiento antes de escribir la doc — no documentes lo que "debería" ser, documenta lo que el código realmente hace hoy (y si hay una discrepancia entre lo deseable y lo real, repórtalo como issue separado en vez de documentar el bug como feature).

ENTREGABLES ESPERADOS POR CADA PUNTO
Test de regresión que falla en HEAD (mostrar output del fallo).
Diff del fix con explicación de por qué es correcto, no solo qué cambia.
Complejidad algorítmica antes/después cuando aplique.
Casos borde considerados y cuáles quedaron explícitamente fuera de alcance (con justificación).
Confirmación de suite completa en verde.
Entrada de changelog.

Al final, un resumen consolidado: qué tan más preciso es el análisis ahora en términos concretos (ej. "antes X% de consumidores vía import dinámico no se detectaban; ahora se detectan Y%, medido sobre el propio repo como caso de prueba dogfooding").

No implementes nada del punto 2, 3 o 4 hasta terminar y validar completamente el punto anterior — son secuenciales, no paralelos, porque el punto 2 reutiliza infraestructura que puede necesitar ajustes tras el punto 1.