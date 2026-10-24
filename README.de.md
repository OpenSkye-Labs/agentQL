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
  <a href="README.md">English</a> · <a href="README.zh-CN.md">简体中文</a> · <a href="README.ja.md">日本語</a> · <a href="README.ko.md">한국어</a> · <a href="README.es.md">Español</a> · <a href="README.pt-BR.md">Português</a> · Deutsch · <a href="README.fr.md">Français</a>
</p>

<p align="center"><sub>Diese Übersetzung kann hinter der englischen README zurückliegen; maßgeblich ist die englische Version.</sub></p>

<p align="center">
  <img src="assets/demo/showcase.gif" alt="AgentQL im Überblick: Tabelle durchsuchen, ER-Diagramm, Query ausführen, den Agenten nach einem Diagramm fragen, einen Schreibzugriff genehmigen oder ablehnen, Dashboard" width="960">
  <br>
  <sub>Rundgang durch den mitgelieferten Demo-Datensatz: Tabelle durchsuchen, ER-Diagramm, Query, den Agenten nach einem Diagramm fragen, ein Schreibzugriff, der deine Freigabe braucht, Dashboard.</sub>
</p>

Ein nativer, plattformübergreifender Datenbank-Client mit eingebautem Agenten. Stell dir TablePlus / DBeaver vor,
plus einen Assistenten, der dein Schema liest, Queries ausführt, SQL optimiert und Dashboards baut – mit **deinem**
Claude- oder OpenAI-API-Key oder deinem bestehenden **Claude Code**- / **Codex (ChatGPT)**-Abo.

Gebaut mit Tauri 2 + Rust (sqlx, redis, mongodb, russh, axum) und React 19 + TypeScript.

## Datenbanken

PostgreSQL · MySQL · MariaDB · SQLite · Redis · MongoDB

Verbinde dich per Host/Zugangsdaten oder URL, mit SSL (require / verify-ca / verify-full, Client-Zertifikate) und
über einen SSH-Tunnel (Agent, Key-Datei oder Passwort). Passwörter liegen im Schlüsselbund des Betriebssystems.

## Highlights

- **Query-Editor** – CodeMirror mit dialektabhängigem Highlighting und Schema-Vervollständigung. `Ctrl/⌘+Enter`
  führt das Statement unter dem Cursor aus; Skripte mit mehreren Statements liefern ein Ergebnis pro Statement;
  EXPLAIN / EXPLAIN ANALYZE.
- **Grid** – virtualisiert, per Tastatur navigierbar, Zellen-Inspektor, Kopieren als TSV/JSON, Export als CSV/JSON/SQL.
- **Tabellen-Browser** – Filter (WHERE), Sortierung, Paging, Inline-Bearbeitung, die zu prüfbarem SQL wird und in
  einer Transaktion angewendet wird; Strukturansicht mit Indizes, Fremdschlüsseln und DDL.
- **Redis** – SCAN-basierter Key-Browser mit typisierten Viewern, TTL und einer Konsole. **MongoDB** – find/aggregate,
  JSON- oder Tabellenansicht, Dokumente bearbeiten/einfügen/löschen, Collection-Infos.
- **Assistent** – streamt Antworten, ruft Tools auf (Schema, run_sql, explain, Diagramme), fragt vor jedem
  Schreibzugriff um Freigabe, rendert Diagramme inline und schlägt ganze Dashboards vor, die du speichern und
  automatisch aktualisieren lassen kannst.
- **Sicherheit** – schreibgeschützte Verbindungen und Lesezugriffe des Agenten werden _von der Datenbank_ erzwungen
  (READ ONLY-Transaktionen / `PRAGMA query_only`), nicht nur durch Parsen.

## So sieht es aus

<table>
  <tr>
    <td width="50%"><img src="assets/demo/grid.webp" alt="Virtualisiertes Grid beim Durchsuchen einer Orders-Tabelle mit 182k Zeilen"><br><sub><b>Grid</b> · virtualisiert, tastaturzentriert, Inline-Bearbeitungen werden zu prüfbarem SQL, Klick auf Fremdschlüssel springt zur Zieltabelle, Umgebungs-Badges.</sub></td>
    <td width="50%"><img src="assets/demo/erd.webp" alt="ER-Diagramm des public-Schemas"><br><sub><b>ER-Diagramm</b> · automatisch aus dem Live-Katalog gelayoutet; Klick auf eine Tabelle öffnet sie, Export als SVG/PNG. Gleich nebenan: Schema-Diff mit „Als Migration kopieren“.</sub></td>
  </tr>
  <tr>
    <td><img src="assets/demo/query.webp" alt="SQL-Editor mit alias-bewusster Vervollständigung und Ergebnissen"><br><sub><b>Editor</b> · alias-bewusste Vervollständigung, JOIN-Vorschläge aus Fremdschlüsseln, Statement unter dem Cursor ausführen, EXPLAIN, Vim-Keymap, Snippets, Versionen gespeicherter Queries.</sub></td>
    <td><img src="assets/demo/agent-chart.webp" alt="Assistent inspiziert das Schema, führt SQL aus und liefert ein Diagramm"><br><sub><b>Agent</b> · inspiziert das Schema, schreibt SQL und führt es aus, erklärt das Ergebnis und liefert ein Diagramm, das du an ein Dashboard anheften kannst. Jeder Schritt ist sichtbar.</sub></td>
  </tr>
  <tr>
    <td><img src="assets/demo/agent-approval.webp" alt="Der Agent bittet vor einem UPDATE um Freigabe"><br><sub><b>Schreibzugriffe brauchen deine Freigabe</b> · Lesezugriffe laufen in einem von der Datenbank erzwungenen Nur-Lese-Kontext (READ ONLY-Transaktionen auf Postgres und MySQL, <code>PRAGMA query_only</code> auf SQLite); ein Schreibzugriff hält an einer Freigabekarte mit dem exakten Statement.</sub></td>
    <td><img src="assets/demo/dashboard.webp" alt="Dashboard mit vier Diagrammen, eines davon vom Agenten hinzugefügt"><br><sub><b>Dashboards</b> · Diagramme aus deinen Queries oder denen des Agenten, automatische Aktualisierung, und der Agent kann ein ganzes Dashboard vorschlagen.</sub></td>
  </tr>
  <tr>
    <td colspan="2"><img src="assets/demo/theme-dracula.webp" alt="Redis-Key-Browser im Dracula-Theme"><br><sub><b>Auch Redis und MongoDB</b> · SCAN-basierter Key-Browser mit Konsole, Mongo find/aggregate und Dokumentbearbeitung. Zehn Themes, hier Dracula; „System folgen“ funktioniert auf Linux, macOS und Windows.</sub></td>
  </tr>
</table>

### Wie agentisch ist das Ganze?

Der Assistent ist ein Agent, der Tools benutzt, und keine Textbox, die SQL einfügt. In jedem Zug kann er Tabellen
auflisten, Spalten und Fremdschlüssel beschreiben, schreibgeschütztes SQL ausführen, einen Plan erklären, ein
Diagramm erstellen, ein Dashboard vorschlagen, Redis scannen oder MongoDB abfragen – und er zeigt jeden Schritt mit
der ausgeführten Query und den zurückgelieferten Zeilen. Die Leitplanken sitzen unterhalb des Modells, nicht im
Prompt: Lesezugriffe laufen in einem von der Datenbank erzwungenen Nur-Lese-Kontext (`READ ONLY`-Transaktionen auf
Postgres und MySQL, `PRAGMA query_only` auf SQLite), Schreibzugriffe halten an einer Freigabekarte mit dem exakten
Statement, jede Verbindung kann einschränken, welche Schemas und Tabellen der Agent sehen darf, und jedes
SQL-Statement, das er ausführt, landet mit dem Tag `agent` in der normalen Query-Historie. Es funktioniert mit
deinem Anthropic- oder OpenAI-Key, jedem OpenAI-kompatiblen Endpunkt wie Ollama oder deinem bestehenden Claude
Code- oder Codex-CLI-Abo über einen lokalen MCP-Endpunkt.

## Installation

Lade den Installer für deine Plattform aus dem [neuesten Release](https://github.com/OpenSkye-Labs/agentQL/releases/latest)
herunter: macOS (Apple Silicon und Intel), Windows und Linux (`.deb`, `.rpm`, `.AppImage`). Die App prüft beim
Start auf Updates und installiert sie direkt.

## Aus dem Quellcode bauen

```bash
pnpm install
pnpm tauri dev        # desktop app
pnpm tauri build      # installers for your OS
```

Linux braucht die üblichen Tauri-Voraussetzungen (webkit2gtk 4.1, gtk3, libssl). In `docs/TESTING.md` findest du
Wegwerf-Datenbankcontainer und die Live-Treibertests.

## KI-Anbieter

Einstellungen → KI-Anbieter. Füge einen oder mehrere hinzu:

- Anthropic API (Key), OpenAI API (Key), jeder OpenAI-kompatible Endpunkt (Ollama, OpenRouter, Groq, …)
- Claude Code CLI oder Codex CLI – nutzt deinen bestehenden Login; die App stellt der CLI ihre Datenbank-Tools über
  einen lokalen, Token-geschützten MCP-Endpunkt bereit, sodass Freigaben und Tool-Karten genauso funktionieren.

Schreibzugriffe des Agenten sind standardmäßig aus; auch wenn du sie aktivierst, braucht jedes Statement eine
Freigabe im Chat.

## Mitwirken

Pull Requests sind willkommen. [CONTRIBUTING.md](CONTRIBUTING.md) beschreibt Branches, Checks und wie Releases
entstehen.

## Code-Signing-Richtlinie

Release-Builds entstehen ausschließlich über den öffentlichen [Release-Workflow](.github/workflows/release.yml) in
diesem Repository. Windows-Installer sollen über [SignPath.io](https://signpath.io) mit einem Zertifikat der
[SignPath Foundation](https://signpath.org) signiert werden (Antrag läuft). Updater-Artefakte werden zusätzlich mit
dem minisign-Key des Projekts signiert, und die App prüft diese Signatur, bevor sie ein Update installiert.

- Committer und Reviewer: [@aindong](https://github.com/aindong)
- Approver: [@aindong](https://github.com/aindong)

## Datenschutzerklärung

AgentQL überträgt keine Informationen an andere vernetzte Systeme, es sei denn, der Nutzer oder die Person, die es
installiert oder betreibt, fordert das ausdrücklich an. Konkret verbindet es sich mit:

- den Datenbanken und SSH-Hosts, die du als Verbindungen anlegst, wenn du sie benutzt;
- dem KI-Anbieter, den du konfigurierst (Anthropic, OpenAI, ein OpenAI-kompatibler Endpunkt oder deine lokale
  Claude Code- / Codex-CLI), nur wenn du dem Assistenten eine Nachricht schickst;
- `github.com`, einmal beim Start, um zu prüfen, ob ein neueres Release existiert.

Es werden keine Telemetrie, Analytics oder Absturzberichte gesendet. Zugangsdaten werden im Schlüsselbund des
Betriebssystems gespeichert oder, falls keiner verfügbar ist, in einer lokalen Datei im App-Datenverzeichnis.

## Lizenz

[MIT](LICENSE).

## Doku

`CLAUDE.md` (Repo-Leitfaden) · `docs/PLAN.md` · `docs/ARCHITECTURE.md` · `docs/TASKS.md` · `docs/FEATURES.md` ·
`docs/REVIEWS.md` · `docs/TESTING.md`
