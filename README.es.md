<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/brand/logo.svg">
    <img src="assets/brand/logo-dark.svg" alt="AgentQL" width="420">
  </picture>
</p>

# AgentQL

[![CI](https://github.com/OpenSkye-Labs/agentQL/actions/workflows/ci.yml/badge.svg?branch=dev)](https://github.com/OpenSkye-Labs/agentQL/actions/workflows/ci.yml)
[![Release](https://github.com/OpenSkye-Labs/agentQL/actions/workflows/release.yml/badge.svg)](https://github.com/OpenSkye-Labs/agentQL/actions/workflows/release.yml)
[![Version](https://img.shields.io/github/v/release/OpenSkye-Labs/agentQL?label=version&color=blue)](https://github.com/OpenSkye-Labs/agentQL/releases/latest)

<p align="center">
  <a href="README.md">English</a> · <a href="README.zh-CN.md">简体中文</a> · <a href="README.ja.md">日本語</a> · <a href="README.ko.md">한국어</a> · Español · <a href="README.pt-BR.md">Português</a> · <a href="README.de.md">Deutsch</a> · <a href="README.fr.md">Français</a>
</p>

<p align="center"><sub>Esta traducción puede ir por detrás del README en inglés; la versión en inglés es la que prevalece.</sub></p>

<p align="center">
  <img src="assets/demo/showcase.gif" alt="Recorrido por AgentQL: explorar una tabla, diagrama ER, ejecutar una consulta, pedir un gráfico al agente, aprobar o rechazar una escritura, dashboard" width="960">
  <br>
  <sub>Recorrido sobre el conjunto de datos de demostración incluido: explorar, diagrama ER, consulta, pedir un gráfico al agente, una escritura que requiere tu aprobación, dashboard.</sub>
</p>

Un cliente de bases de datos nativo y multiplataforma con un agente integrado. Piensa en TablePlus / DBeaver, más un
asistente capaz de leer tu esquema, ejecutar consultas, optimizar SQL y construir dashboards, usando **tu** clave de API
de Claude u OpenAI, o la suscripción a **Claude Code** / **Codex (ChatGPT)** que ya tienes.

Construido con Tauri 2 + Rust (sqlx, redis, mongodb, russh, axum) y React 19 + TypeScript.

## Bases de datos

PostgreSQL · MySQL · MariaDB · SQLite · Redis · MongoDB

Conéctate con host/credenciales o con una URL, con SSL (require / verify-ca / verify-full, certificados de cliente) y a
través de un túnel SSH (agente, archivo de clave o contraseña). Las contraseñas se guardan en el llavero del sistema operativo.

## Lo más destacado

- **Editor de consultas**: CodeMirror con resaltado según el dialecto y autocompletado del esquema. `Ctrl/⌘+Enter` ejecuta la
  sentencia bajo el cursor; los scripts con varias sentencias devuelven un resultado por sentencia; EXPLAIN / EXPLAIN ANALYZE.
- **Grid**: virtualizado, navegable con el teclado, inspector de celdas, copiar como TSV/JSON, exportar a CSV/JSON/SQL.
- **Explorador de tablas**: filtro (WHERE), ordenación, paginación, ediciones en línea que se convierten en SQL revisable y se
  aplican en una sola transacción; vista de estructura con índices, claves foráneas y DDL.
- **Redis**: explorador de claves basado en SCAN con visores por tipo, TTL y una consola. **MongoDB**: find/aggregate, vista JSON o
  de tabla, editar/insertar/eliminar documentos, información de la colección.
- **Asistente**: transmite las respuestas en streaming, invoca herramientas (schema, run_sql, explain, charts), pide aprobación antes de
  cualquier escritura, muestra gráficos en línea y propone dashboards completos que puedes guardar y refrescar automáticamente.
- **Seguridad**: las conexiones de solo lectura y las lecturas del agente las impone _la propia base de datos_ (transacciones READ ONLY /
  `PRAGMA query_only`), no solo el análisis del texto.

## Así se ve

<table>
  <tr>
    <td width="50%"><img src="assets/demo/grid.webp" alt="Grid virtualizado explorando una tabla de pedidos con 182k filas"><br><sub><b>Grid</b> · virtualizado, pensado para el teclado, las ediciones en línea se convierten en SQL revisable, salto por claves foráneas, insignias de entorno.</sub></td>
    <td width="50%"><img src="assets/demo/erd.webp" alt="Diagrama ER del esquema public"><br><sub><b>Diagrama ER</b> · distribuido automáticamente a partir del catálogo en vivo; haz clic en una tabla para abrirla, exporta a SVG/PNG. Al lado, diff de esquemas con copiar como migración.</sub></td>
  </tr>
  <tr>
    <td><img src="assets/demo/query.webp" alt="Editor SQL con autocompletado que entiende alias y resultados"><br><sub><b>Editor</b> · autocompletado que entiende alias, sugerencias de JOIN a partir de claves foráneas, ejecuta la sentencia bajo el cursor, EXPLAIN, atajos de vim, snippets, versiones de consultas guardadas.</sub></td>
    <td><img src="assets/demo/agent-chart.webp" alt="El asistente inspeccionando el esquema, ejecutando SQL y devolviendo un gráfico"><br><sub><b>Agente</b> · inspecciona el esquema, escribe y ejecuta SQL, explica el resultado y devuelve un gráfico que puedes fijar en un dashboard. Cada paso es visible.</sub></td>
  </tr>
  <tr>
    <td><img src="assets/demo/agent-approval.webp" alt="El agente pidiendo aprobación antes de ejecutar un UPDATE"><br><sub><b>Las escrituras requieren tu aprobación</b> · las lecturas se ejecutan en un contexto de solo lectura impuesto por la base de datos (transacciones READ ONLY en Postgres y MySQL, <code>PRAGMA query_only</code> en SQLite); una escritura se detiene en una tarjeta de aprobación que muestra la sentencia exacta.</sub></td>
    <td><img src="assets/demo/dashboard.webp" alt="Dashboard con cuatro gráficos, uno de ellos añadido por el agente"><br><sub><b>Dashboards</b> · gráficos a partir de tus consultas o de las del agente, refresco automático, y el agente puede proponer un dashboard completo.</sub></td>
  </tr>
  <tr>
    <td colspan="2"><img src="assets/demo/theme-dracula.webp" alt="Explorador de claves de Redis con el tema Dracula"><br><sub><b>También Redis y MongoDB</b> · explorador de claves basado en SCAN con consola, find/aggregate de Mongo y edición de documentos. Diez temas, aquí Dracula; seguir el tema del sistema funciona en Linux, macOS y Windows.</sub></td>
  </tr>
</table>

### ¿Qué tan agéntico es?

El asistente es un agente que usa herramientas, no un cuadro de texto que pega SQL. En cada turno puede listar tablas, describir
columnas y claves foráneas, ejecutar SQL de solo lectura, explicar un plan, crear un gráfico, proponer un dashboard, recorrer Redis o consultar
MongoDB, y muestra cada paso con la consulta que ejecutó y las filas que obtuvo. Las barreras de seguridad se imponen por debajo
del modelo, no en el prompt: las lecturas se ejecutan en un contexto de solo lectura impuesto por la base de datos (transacciones `READ ONLY` en
Postgres y MySQL, `PRAGMA query_only` en SQLite), las escrituras se detienen en una tarjeta de aprobación con la sentencia exacta, cada
conexión puede acotar qué esquemas y tablas puede ver el agente, y cada sentencia SQL que ejecuta queda en el
historial de consultas habitual con la etiqueta `agent`. Funciona con tu clave de Anthropic u OpenAI, con cualquier endpoint compatible
con OpenAI como Ollama, o con tu suscripción existente a Claude Code o Codex CLI a través de un endpoint MCP local.

## Instalación

Descarga el instalador para tu plataforma desde la [última versión](https://github.com/OpenSkye-Labs/agentQL/releases/latest):
macOS (Apple Silicon e Intel), Windows y Linux (`.deb`, `.rpm`, `.AppImage`). La app busca actualizaciones al
arrancar y las instala sobre la marcha.

## Compilar desde el código fuente

```bash
pnpm install
pnpm tauri dev        # desktop app
pnpm tauri build      # installers for your OS
```

Linux necesita los requisitos habituales de Tauri (webkit2gtk 4.1, gtk3, libssl). Consulta `docs/TESTING.md` para los contenedores
de bases de datos desechables y las pruebas de drivers en vivo.

## Proveedores de IA

Ajustes → Proveedores de IA. Añade uno o varios de:

- API de Anthropic (clave), API de OpenAI (clave), cualquier endpoint compatible con OpenAI (Ollama, OpenRouter, Groq, …)
- Claude Code CLI o Codex CLI: usa la sesión que ya tienes iniciada; la app expone sus herramientas de base de datos a la CLI
  mediante un endpoint MCP local protegido con token, así que las aprobaciones y las tarjetas de herramientas funcionan igual.

Las escrituras del agente están desactivadas por defecto; al activarlas, cada sentencia sigue requiriendo aprobación en el chat.

## Contribuir

Los pull requests son bienvenidos. [CONTRIBUTING.md](CONTRIBUTING.md) explica las ramas, las comprobaciones y cómo se publican las versiones.

## Política de firma de código

Las compilaciones de release se generan únicamente con el [flujo de release](.github/workflows/release.yml) público de este repositorio.
Los instaladores de Windows se firmarán a través de [SignPath.io](https://signpath.io) con un certificado de la
[SignPath Foundation](https://signpath.org) (solicitud en trámite). Los artefactos del actualizador se firman además con
la clave minisign del proyecto, y la app verifica esa firma antes de instalar una actualización.

- Committers y revisores: [@aindong](https://github.com/aindong)
- Aprobadores: [@aindong](https://github.com/aindong)

## Política de privacidad

AgentQL no transfiere información a otros sistemas en red salvo que lo solicite expresamente el usuario o
la persona que lo instala u opera. En la práctica se conecta a:

- las bases de datos y hosts SSH que añades como conexiones, cuando los usas;
- el proveedor de IA que configures (Anthropic, OpenAI, un endpoint compatible con OpenAI, o tu Claude Code /
  Codex CLI local), solo cuando envías un mensaje al asistente;
- `github.com`, una vez al arrancar, para comprobar si existe una versión más reciente.

No se envía telemetría, analítica ni informes de fallos. Las credenciales se guardan en el llavero del sistema operativo o, si no hay
ninguno disponible, en un archivo local dentro del directorio de datos de la app.

## Licencia

[MIT](LICENSE).

## Documentación

`CLAUDE.md` (guía del repositorio) · `docs/PLAN.md` · `docs/ARCHITECTURE.md` · `docs/TASKS.md` · `docs/FEATURES.md` ·
`docs/REVIEWS.md` · `docs/TESTING.md`
