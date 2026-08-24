# Reglas de flujo de Git para OpenCode

Estas reglas son de cumplimiento **obligatorio** en cada tarea que implique cambios
en el repositorio. No son sugerencias: si una orden del usuario entra en conflicto
con estas reglas (ej. "sube todo directo a main"), OpenCode debe advertir el
conflicto antes de proceder.

## 1. Protección de la rama base (`master`)

- **Nunca** hacer commit directamente sobre `master`.
- `master` solo se actualiza mediante merge de una rama, y solo después de pasar la
  verificación de impacto (ver sección 4).
- Antes de empezar cualquier trabajo, verificar en qué rama se está parado. Si es
  `master`, crear una rama nueva antes de tocar código.

## 2. Convención de nombres de rama

Formato: `<tipo>/<descripcion-corta-en-kebab-case>`

Tipos permitidos:
- `feature/` → nueva funcionalidad
- `fix/` → corrección de bug
- `hotfix/` → corrección urgente sobre producción
- `refactor/` → cambios internos sin alterar comportamiento
- `chore/` → tareas de mantenimiento (dependencias, configs, limpieza)
- `docs/` → cambios solo de documentación
- `test/` → cambios o adición de tests
- `style/` → formato, lint, sin cambios de lógica
- `perf/` → mejoras de rendimiento

La descripción debe ser corta, sin espacios ni mayúsculas.

## 3. Commits: pequeños, atómicos y auditables

- **Nunca** agrupar cambios grandes o de propósitos distintos en un solo commit.
- Cada commit debe representar **un solo cambio lógico**, revisable de forma independiente.
- Si una tarea implica varios cambios no relacionados, dividir en múltiples commits
  (y si aplica, sugerir dividir en múltiples ramas/PRs).

### Formato de mensaje (Conventional Commits)

    <tipo>(<scope opcional>): <descripción corta en imperativo>

    <cuerpo explicando el "por qué", no solo el "qué" — recomendado si no es trivial>

Tipos: `feat`, `fix`, `chore`, `refactor`, `docs`, `test`, `style`, `perf`, `hotfix`.

Reglas del título:
- Máximo ~72 caracteres.
- Modo imperativo ("agrega", "corrige"), no participio.
- Sin punto final.
- Debe entenderse el cambio leyendo solo el título.

## 4. Verificación de impacto antes de subir o hacer merge — OBLIGATORIO

Cada vez que el usuario pide **subir cambios, hacer push o hacer merge**, OpenCode debe, en este orden:

1. Ejecutar: `npx impactwave analyze -b master` (siempre con base explícita;
   en este repo la rama base principal es `master`; no confiar en la autodetección).
2. Mostrar el **resumen completo del reporte** impreso por consola (no resumirlo ni omitir partes).
3. Continuar solo si el nivel de riesgo es LOW (0-25) o MEDIUM (26-50);
   con HIGH (51-75) o CRITICAL (76-100), detenerse y pedir autorización explícita
   explicando las razones del reporte.
4. Si `impactwave` falla o no está disponible, detenerse y reportarlo. No hacer
   push/merge sin autorización explícita del usuario entendiendo el riesgo.

Esta verificación aplica siempre, sin excepción, incluso para cambios triviales.

Nota: impactwave solo analiza cambios YA COMMITEADOS (`git diff <base>..HEAD`).
Orden correcto: hacer cambios → commitear en la rama → impactwave → push/merge.

## 5. Flujo estándar por tarea

1. Confirmar rama actual; si es `master`, crear rama nueva según sección 2.
2. Hacer los cambios necesarios.
3. Dividir el trabajo en commits atómicos (sección 3).
4. Cuando el usuario pida subir/mergear: ejecutar impactwave, mostrar reporte,
   continuar solo si el resultado es aceptable o el usuario lo confirma.
5. Nunca mergear a `master` sin haber pasado por el paso 4.
