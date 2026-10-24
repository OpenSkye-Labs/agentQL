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
  <a href="README.md">English</a> · <a href="README.zh-CN.md">简体中文</a> · <a href="README.ja.md">日本語</a> · <a href="README.ko.md">한국어</a> · <a href="README.es.md">Español</a> · Português · <a href="README.de.md">Deutsch</a> · <a href="README.fr.md">Français</a>
</p>

<p align="center"><sub>Esta tradução pode estar desatualizada em relação ao README em inglês; a versão em inglês é a referência oficial.</sub></p>

<p align="center">
  <img src="assets/demo/showcase.gif" alt="Tour pelo AgentQL: navegar por uma tabela, diagrama ER, executar uma consulta, pedir um gráfico ao agente, aprovar ou negar uma escrita, dashboard" width="960">
  <br>
  <sub>Tour pelo conjunto de dados de demonstração embutido: navegação, diagrama ER, consulta, um gráfico pedido ao agente, uma escrita que precisa da sua aprovação, dashboard.</sub>
</p>

Um cliente de banco de dados nativo e multiplataforma com um agente embutido. Pense em TablePlus / DBeaver, mais um
assistente que lê o seu schema, executa consultas, otimiza SQL e monta dashboards — usando a **sua** chave de API da
Claude ou da OpenAI, ou a assinatura do **Claude Code** / **Codex (ChatGPT)** que você já tem.

Feito com Tauri 2 + Rust (sqlx, redis, mongodb, russh, axum) e React 19 + TypeScript.

## Bancos de dados

PostgreSQL · MySQL · MariaDB · SQLite · Redis · MongoDB

Conecte com host/credenciais ou por URL, com SSL (require / verify-ca / verify-full, certificados de cliente) e por
túnel SSH (agent, arquivo de chave ou senha). As senhas ficam no chaveiro do sistema operacional.

## Destaques

- **Editor de consultas** — CodeMirror com realce por dialeto e autocompletar a partir do schema. `Ctrl/⌘+Enter` executa a
  instrução sob o cursor; scripts com várias instruções retornam um resultado por instrução; EXPLAIN / EXPLAIN ANALYZE.
- **Grid** — virtualizado, navegável pelo teclado, inspetor de célula, copiar como TSV/JSON, exportar CSV/JSON/SQL.
- **Navegador de tabelas** — filtro (WHERE), ordenação, paginação, edições inline que viram SQL revisável aplicado em uma
  única transação; visão de estrutura com índices, chaves estrangeiras e DDL.
- **Redis** — navegador de chaves baseado em SCAN com visualizadores por tipo, TTL e um console. **MongoDB** — find/aggregate,
  visão em JSON ou tabela, editar/inserir/excluir documentos, informações da coleção.
- **Assistente** — responde em streaming, chama ferramentas (schema, run_sql, explain, gráficos), pede aprovação antes de
  qualquer escrita, renderiza gráficos inline e propõe dashboards inteiros que você pode salvar e atualizar automaticamente.
- **Segurança** — conexões somente leitura e leituras do agente são impostas _pelo banco de dados_ (transações READ ONLY /
  `PRAGMA query_only`), não apenas por análise do texto.

## Como é na prática

<table>
  <tr>
    <td width="50%"><img src="assets/demo/grid.webp" alt="Grid virtualizado navegando por uma tabela de pedidos com 182 mil linhas"><br><sub><b>Grid</b> · virtualizado, pensado para o teclado, edições inline viram SQL revisável, navegação por FK com um clique, badges de ambiente.</sub></td>
    <td width="50%"><img src="assets/demo/erd.webp" alt="Diagrama ER do schema public"><br><sub><b>Diagrama ER</b> · layout automático a partir do catálogo real; clique em uma tabela para abri-la, exporte SVG/PNG. Diff de schema com copiar-como-migration logo ao lado.</sub></td>
  </tr>
  <tr>
    <td><img src="assets/demo/query.webp" alt="Editor SQL com autocompletar que entende aliases e resultados"><br><sub><b>Editor</b> · autocompletar que entende aliases, sugestões de JOIN a partir das chaves estrangeiras, execução da instrução sob o cursor, EXPLAIN, keymap do vim, snippets, versões de consultas salvas.</sub></td>
    <td><img src="assets/demo/agent-chart.webp" alt="Assistente inspecionando o schema, executando SQL e retornando um gráfico"><br><sub><b>Agente</b> · inspeciona o schema, escreve e executa SQL, explica o resultado e retorna um gráfico que você pode fixar em um dashboard. Cada passo fica visível.</sub></td>
  </tr>
  <tr>
    <td><img src="assets/demo/agent-approval.webp" alt="O agente pedindo aprovação antes de executar um UPDATE"><br><sub><b>Escritas precisam da sua aprovação</b> · leituras rodam em um contexto somente leitura imposto pelo banco (transações READ ONLY no Postgres e no MySQL, <code>PRAGMA query_only</code> no SQLite); uma escrita para em um cartão de aprovação que mostra a instrução exata.</sub></td>
    <td><img src="assets/demo/dashboard.webp" alt="Dashboard com quatro gráficos, incluindo um adicionado pelo agente"><br><sub><b>Dashboards</b> · gráficos das suas consultas ou das do agente, atualização automática, e o agente pode propor um dashboard inteiro.</sub></td>
  </tr>
  <tr>
    <td colspan="2"><img src="assets/demo/theme-dracula.webp" alt="Navegador de chaves do Redis no tema Dracula"><br><sub><b>Redis e MongoDB também</b> · navegador de chaves baseado em SCAN com console, find/aggregate e edição de documentos no Mongo. Dez temas, Dracula na imagem; o modo "seguir o sistema" funciona no Linux, macOS e Windows.</sub></td>
  </tr>
</table>

### Quão agêntico ele é?

O assistente é um agente que usa ferramentas, não uma caixa de texto que cola SQL. A cada turno ele pode listar tabelas,
descrever colunas e chaves estrangeiras, executar SQL somente leitura, explicar um plano, criar um gráfico, propor um
dashboard, escanear o Redis ou consultar o MongoDB, e mostra cada passo com a consulta executada e as linhas retornadas.
As proteções são impostas abaixo do modelo, não no prompt: leituras rodam em um contexto somente leitura imposto pelo banco
(transações `READ ONLY` no Postgres e no MySQL, `PRAGMA query_only` no SQLite), escritas param em um cartão de aprovação
com a instrução exata, cada conexão pode restringir quais schemas e tabelas o agente pode ver, e toda instrução SQL que ele
executa entra no histórico normal de consultas marcada como `agent`. Funciona com a sua chave da Anthropic ou da OpenAI,
qualquer endpoint compatível com a OpenAI, como o Ollama, ou a sua assinatura do Claude Code ou da CLI do Codex por meio de
um endpoint MCP local.

## Instalação

Baixe o instalador da sua plataforma na [última release](https://github.com/OpenSkye-Labs/agentQL/releases/latest):
macOS (Apple Silicon e Intel), Windows e Linux (`.deb`, `.rpm`, `.AppImage`). O app verifica atualizações ao iniciar e as
instala no lugar.

## Compilar a partir do código-fonte

```bash
pnpm install
pnpm tauri dev        # desktop app
pnpm tauri build      # installers for your OS
```

No Linux são necessários os pré-requisitos habituais do Tauri (webkit2gtk 4.1, gtk3, libssl). Veja `docs/TESTING.md` para
contêineres de banco descartáveis e os testes de driver contra bancos reais.

## Provedores de IA

Configurações → Provedores de IA. Adicione um ou mais entre:

- API da Anthropic (chave), API da OpenAI (chave), qualquer endpoint compatível com a OpenAI (Ollama, OpenRouter, Groq, …)
- CLI do Claude Code ou CLI do Codex — usa o login que você já tem; o app expõe suas ferramentas de banco de dados à CLI
  por um endpoint MCP local protegido por token, então aprovações e cartões de ferramenta funcionam do mesmo jeito.

Escritas do agente vêm desativadas por padrão; mesmo ativadas, cada instrução ainda exige aprovação no chat.

## Contribuindo

Pull requests são bem-vindos. O [CONTRIBUTING.md](CONTRIBUTING.md) cobre branches, verificações e como as releases são geradas.

## Política de assinatura de código

Os builds de release são produzidos apenas pelo [workflow de release](.github/workflows/release.yml) público deste repositório.
Os instaladores para Windows serão assinados via [SignPath.io](https://signpath.io) com um certificado da
[SignPath Foundation](https://signpath.org) (solicitação em andamento). Os artefatos do atualizador são assinados adicionalmente
com a chave minisign do projeto, e o app verifica essa assinatura antes de instalar uma atualização.

- Committers e revisores: [@aindong](https://github.com/aindong)
- Aprovadores: [@aindong](https://github.com/aindong)

## Política de privacidade

O AgentQL não transfere nenhuma informação para outros sistemas em rede, a menos que isso seja solicitado especificamente
pelo usuário ou pela pessoa que o instala ou opera. Na prática, ele se conecta a:

- os bancos de dados e hosts SSH que você adiciona como conexões, quando você os usa;
- o provedor de IA que você configura (Anthropic, OpenAI, um endpoint compatível com a OpenAI ou a sua CLI local do
  Claude Code / Codex), somente quando você envia uma mensagem ao assistente;
- `github.com`, uma vez ao iniciar, para verificar se existe uma release mais nova.

Nenhuma telemetria, analytics ou relatório de falhas é enviado. As credenciais são armazenadas no chaveiro do sistema
operacional ou, quando não há um disponível, em um arquivo local no diretório de dados do app.

## Licença

[MIT](LICENSE).

## Documentação

`CLAUDE.md` (guia do repositório) · `docs/PLAN.md` · `docs/ARCHITECTURE.md` · `docs/TASKS.md` · `docs/FEATURES.md` ·
`docs/REVIEWS.md` · `docs/TESTING.md`
