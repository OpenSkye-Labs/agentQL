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
  <a href="README.md">English</a> · 简体中文 · <a href="README.ja.md">日本語</a> · <a href="README.ko.md">한국어</a> · <a href="README.es.md">Español</a> · <a href="README.pt-BR.md">Português</a> · <a href="README.de.md">Deutsch</a> · <a href="README.fr.md">Français</a>
</p>

<p align="center"><sub>本翻译可能落后于英文 README，以英文版为准。</sub></p>

<p align="center">
  <img src="assets/demo/showcase.gif" alt="AgentQL 演示：浏览表、ER 图、运行查询、让 agent 生成图表、批准或拒绝写操作、仪表盘" width="960">
  <br>
  <sub>基于内置演示数据集的完整演示：浏览表、ER 图、查询、让 agent 生成图表、一次需要你批准的写操作、仪表盘。</sub>
</p>

一款原生跨平台数据库客户端，内置 agent。可以把它看作 TablePlus / DBeaver，再加上一个能读取你的 schema、运行查询、优化 SQL
并搭建仪表盘的助手——使用**你自己的** Claude 或 OpenAI API key，或者你已有的 **Claude Code** / **Codex (ChatGPT)** 订阅。

基于 Tauri 2 + Rust（sqlx、redis、mongodb、russh、axum）和 React 19 + TypeScript 构建。

## 支持的数据库

PostgreSQL · MySQL · MariaDB · SQLite · Redis · MongoDB

支持通过主机/凭据或 URL 连接，支持 SSL（require / verify-ca / verify-full、客户端证书）以及 SSH 隧道（agent、密钥文件或密码）。
密码保存在操作系统钥匙串中。

## 亮点

- **查询编辑器**——基于 CodeMirror，按方言高亮并提供 schema 补全。`Ctrl/⌘+Enter` 运行光标所在的语句；
  多语句脚本每条语句返回一个结果；支持 EXPLAIN / EXPLAIN ANALYZE。
- **数据网格**——虚拟化渲染、键盘导航、单元格检查器、复制为 TSV/JSON、导出 CSV/JSON/SQL。
- **表浏览器**——筛选（WHERE）、排序、分页，行内编辑会生成可审阅的 SQL 并在一个事务中应用；
  结构视图包含索引、外键和 DDL。
- **Redis**——基于 SCAN 的键浏览器，带类型化查看器、TTL 和控制台。**MongoDB**——find/aggregate、JSON 或表格视图、
  文档的编辑/插入/删除、集合信息。
- **助手**——流式输出回答，调用工具（schema、run_sql、explain、图表），任何写操作前都会请求批准，
  在对话中内联渲染图表，还能提出可保存、可自动刷新的完整仪表盘。
- **安全**——只读连接和 agent 的读操作由_数据库本身_强制执行（READ ONLY 事务 / `PRAGMA query_only`），
  而不只是靠解析 SQL。

## 界面一览

<table>
  <tr>
    <td width="50%"><img src="assets/demo/grid.webp" alt="虚拟化网格浏览 18.2 万行的订单表"><br><sub><b>数据网格</b> · 虚拟化渲染、键盘优先，行内编辑生成可审阅的 SQL，外键点击跳转，环境标识。</sub></td>
    <td width="50%"><img src="assets/demo/erd.webp" alt="public schema 的 ER 图"><br><sub><b>ER 图</b> · 根据实时目录自动布局；点击表即可打开，可导出 SVG/PNG。旁边还有 schema 对比，可一键复制为迁移脚本。</sub></td>
  </tr>
  <tr>
    <td><img src="assets/demo/query.webp" alt="带别名感知补全和结果的 SQL 编辑器"><br><sub><b>编辑器</b> · 别名感知补全、基于外键的 JOIN 建议、运行光标所在语句、EXPLAIN、vim 键位、代码片段、已保存查询的版本记录。</sub></td>
    <td><img src="assets/demo/agent-chart.webp" alt="助手检查 schema、运行 SQL 并返回图表"><br><sub><b>Agent</b> · 检查 schema，编写并运行 SQL，解释结果，返回可固定到仪表盘的图表。每一步都清晰可见。</sub></td>
  </tr>
  <tr>
    <td><img src="assets/demo/agent-approval.webp" alt="agent 在运行 UPDATE 前请求批准"><br><sub><b>写操作需要你批准</b> · 读操作在数据库强制的只读上下文中运行（Postgres 和 MySQL 上为 READ ONLY 事务，SQLite 上为 <code>PRAGMA query_only</code>）；写操作会停在一张审批卡片上，展示将要执行的确切语句。</sub></td>
    <td><img src="assets/demo/dashboard.webp" alt="包含四个图表的仪表盘，其中一个由 agent 添加"><br><sub><b>仪表盘</b> · 图表来自你的查询或 agent 的查询，支持自动刷新，agent 还能直接提出一整个仪表盘。</sub></td>
  </tr>
  <tr>
    <td colspan="2"><img src="assets/demo/theme-dracula.webp" alt="Dracula 主题下的 Redis 键浏览器"><br><sub><b>也支持 Redis 和 MongoDB</b> · 基于 SCAN 的键浏览器和控制台，Mongo find/aggregate 与文档编辑。十套主题，图中为 Dracula；跟随系统在 Linux、macOS 和 Windows 上均可用。</sub></td>
  </tr>
</table>

### 它到底有多"agentic"？

这个助手是一个会调用工具的 agent，而不是一个只会把 SQL 粘贴出来的文本框。每一轮它都可以列出表、描述列和外键、运行只读 SQL、
解释执行计划、创建图表、提出仪表盘、扫描 Redis 或查询 MongoDB，并且会展示每一步执行的查询和返回的行。
安全护栏在模型之下强制执行，而不是写在提示词里：读操作在数据库强制的只读上下文中运行（Postgres 和 MySQL 上为 `READ ONLY` 事务，
SQLite 上为 `PRAGMA query_only`），写操作会停在一张展示确切语句的审批卡片上，每个连接都可以限定 agent 能看到哪些 schema 和表，
它运行的每条 SQL 语句都会进入常规查询历史并标记为 `agent`。它可以使用你的 Anthropic 或 OpenAI key、任何 OpenAI 兼容端点（如 Ollama），
或通过本地 MCP 端点使用你已有的 Claude Code 或 Codex CLI 订阅。

## 安装

从[最新发布](https://github.com/OpenSkye-Labs/agentQL/releases/latest)下载对应平台的安装包：
macOS（Apple Silicon 和 Intel）、Windows 和 Linux（`.deb`、`.rpm`、`.AppImage`）。应用会在启动时检查更新并原地安装。

## 从源码构建

```bash
pnpm install
pnpm tauri dev        # desktop app
pnpm tauri build      # installers for your OS
```

Linux 需要 Tauri 的常规依赖（webkit2gtk 4.1、gtk3、libssl）。一次性数据库容器和真实驱动测试请参阅 `docs/TESTING.md`。

## AI 提供商

设置 → AI 提供商。可添加以下一种或多种：

- Anthropic API（key）、OpenAI API（key）、任何 OpenAI 兼容端点（Ollama、OpenRouter、Groq 等）
- Claude Code CLI 或 Codex CLI——复用你已有的登录；应用通过一个本地的、受 token 保护的 MCP 端点把数据库工具暴露给 CLI，
  因此审批和工具卡片的工作方式完全一致。

Agent 写操作默认关闭；即使开启，也仍需在对话中逐条语句批准。

## 参与贡献

欢迎提交 Pull Request。[CONTRIBUTING.md](CONTRIBUTING.md) 介绍了分支、检查项以及发布流程。

## 代码签名政策

发布版本只由本仓库公开的[发布工作流](.github/workflows/release.yml)构建。
Windows 安装包计划通过 [SignPath.io](https://signpath.io) 使用 [SignPath Foundation](https://signpath.org) 的证书进行签名（申请审核中）。
更新器产物还会额外使用项目的 minisign 密钥签名，应用在安装更新前会校验该签名。

- 提交者与审阅者：[@aindong](https://github.com/aindong)
- 批准者：[@aindong](https://github.com/aindong)

## 隐私政策

除非用户或安装、运行本软件的人明确要求，AgentQL 不会向其他联网系统传输任何信息。实际上它只会连接：

- 你添加为连接的数据库和 SSH 主机，且仅在你使用它们时；
- 你配置的 AI 提供商（Anthropic、OpenAI、OpenAI 兼容端点，或本地的 Claude Code / Codex CLI），且仅在你向助手发送消息时；
- `github.com`，仅在启动时访问一次，用于检查是否有新版本。

不发送任何遥测、分析或崩溃报告。凭据保存在操作系统钥匙串中；若不可用，则保存在应用数据目录下的本地文件中。

## 许可证

[MIT](LICENSE)。

## 文档

`CLAUDE.md`（仓库指南）· `docs/PLAN.md` · `docs/ARCHITECTURE.md` · `docs/TASKS.md` · `docs/FEATURES.md` ·
`docs/REVIEWS.md` · `docs/TESTING.md`
