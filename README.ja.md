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
  <a href="README.md">English</a> · <a href="README.zh-CN.md">简体中文</a> · 日本語 · <a href="README.ko.md">한국어</a> · <a href="README.es.md">Español</a> · <a href="README.pt-BR.md">Português</a> · <a href="README.de.md">Deutsch</a> · <a href="README.fr.md">Français</a>
</p>

<p align="center"><sub>この翻訳は英語版 README より古い場合があります。正式な内容は英語版を参照してください。</sub></p>

<p align="center">
  <img src="assets/demo/showcase.gif" alt="AgentQL の操作デモ: テーブルの閲覧、ER 図、クエリの実行、エージェントにチャートを依頼、書き込みの承認または拒否、ダッシュボード" width="960">
  <br>
  <sub>内蔵デモデータセットでの操作例: テーブル閲覧、ER 図、クエリ、エージェントにチャートを依頼、承認が必要な書き込み、ダッシュボード。</sub>
</p>

エージェントを内蔵した、ネイティブなクロスプラットフォームのデータベースクライアント。TablePlus / DBeaver に、スキーマを読み、クエリを実行し、SQL を最適化し、ダッシュボードを組み立てるアシスタントを加えたもの。**自分の** Claude または OpenAI の API キー、あるいは既存の **Claude Code** / **Codex (ChatGPT)** サブスクリプションで動作する。

Tauri 2 + Rust (sqlx, redis, mongodb, russh, axum) と React 19 + TypeScript で構築。

## 対応データベース

PostgreSQL · MySQL · MariaDB · SQLite · Redis · MongoDB

ホスト/認証情報または URL で接続。SSL (require / verify-ca / verify-full、クライアント証明書) と SSH トンネル (agent、鍵ファイル、パスワード) に対応。パスワードは OS のキーチェーンに保存される。

## 主な機能

- **クエリエディタ** — CodeMirror ベース。方言ごとのハイライトとスキーマ補完。`Ctrl/⌘+Enter` でカーソル位置のステートメントを実行。複数ステートメントのスクリプトはステートメントごとに結果を返す。EXPLAIN / EXPLAIN ANALYZE に対応。
- **グリッド** — 仮想スクロール、キーボード操作、セルインスペクタ、TSV/JSON としてコピー、CSV/JSON/SQL へのエクスポート。
- **テーブルブラウザ** — フィルタ (WHERE)、ソート、ページング。インライン編集は確認可能な SQL になり、1 トランザクションで適用される。インデックス・外部キー・DDL を含む構造ビュー。
- **Redis** — SCAN ベースのキーブラウザ、型別ビューア、TTL、コンソール。**MongoDB** — find/aggregate、JSON またはテーブル表示、ドキュメントの編集/挿入/削除、コレクション情報。
- **アシスタント** — 回答をストリーミングし、ツール (schema、run_sql、explain、charts) を呼び出し、書き込みの前には必ず承認を求める。チャートをインラインで描画し、保存して自動更新できるダッシュボード全体を提案する。
- **安全性** — 読み取り専用接続とエージェントの読み取りは、パースによるチェックだけでなく _データベース側で_ 強制される (READ ONLY トランザクション / `PRAGMA query_only`)。

## 画面イメージ

<table>
  <tr>
    <td width="50%"><img src="assets/demo/grid.webp" alt="18.2 万行の orders テーブルを閲覧する仮想スクロールのグリッド"><br><sub><b>グリッド</b> · 仮想スクロール、キーボード優先、インライン編集は確認可能な SQL になる。FK クリックで参照先へ移動、環境バッジ付き。</sub></td>
    <td width="50%"><img src="assets/demo/erd.webp" alt="public スキーマの ER 図"><br><sub><b>ER 図</b> · ライブのカタログから自動レイアウト。テーブルをクリックして開き、SVG/PNG にエクスポート。隣にはマイグレーションとしてコピーできるスキーマ差分。</sub></td>
  </tr>
  <tr>
    <td><img src="assets/demo/query.webp" alt="エイリアスを認識する補完と結果を表示する SQL エディタ"><br><sub><b>エディタ</b> · エイリアスを認識する補完、外部キーからの JOIN 提案、カーソル位置のステートメントを実行、EXPLAIN、vim キーマップ、スニペット、保存クエリのバージョン管理。</sub></td>
    <td><img src="assets/demo/agent-chart.webp" alt="スキーマを調べ、SQL を実行し、チャートを返すアシスタント"><br><sub><b>エージェント</b> · スキーマを調べ、SQL を書いて実行し、結果を説明し、ダッシュボードにピン留めできるチャートを返す。すべてのステップが見える。</sub></td>
  </tr>
  <tr>
    <td><img src="assets/demo/agent-approval.webp" alt="UPDATE の実行前に承認を求めるエージェント"><br><sub><b>書き込みには承認が必要</b> · 読み取りはデータベース側で強制される読み取り専用コンテキストで実行される (Postgres と MySQL では READ ONLY トランザクション、SQLite では <code>PRAGMA query_only</code>)。書き込みは、実行されるステートメントをそのまま表示する承認カードで停止する。</sub></td>
    <td><img src="assets/demo/dashboard.webp" alt="エージェントが追加した 1 枚を含む 4 枚のチャートのダッシュボード"><br><sub><b>ダッシュボード</b> · 自分のクエリやエージェントのクエリからチャートを作成、自動更新。エージェントがダッシュボード全体を提案することもできる。</sub></td>
  </tr>
  <tr>
    <td colspan="2"><img src="assets/demo/theme-dracula.webp" alt="Dracula テーマの Redis キーブラウザ"><br><sub><b>Redis と MongoDB も</b> · コンソール付きの SCAN ベースのキーブラウザ、Mongo の find/aggregate とドキュメント編集。テーマは 10 種類 (画像は Dracula)。システム追従は Linux、macOS、Windows で動作する。</sub></td>
  </tr>
</table>

### どこまでエージェント的か

このアシスタントはツールを使うエージェントであり、SQL を貼り付けるだけのテキストボックスではない。各ターンで、テーブルの一覧、カラムと外部キーの確認、読み取り専用 SQL の実行、実行計画の説明、チャートの作成、ダッシュボードの提案、Redis のスキャン、MongoDB へのクエリを行い、実行したクエリと返ってきた行を含めてすべてのステップを表示する。ガードレールはプロンプトではなくモデルより下の層で強制される。読み取りはデータベース側で強制される読み取り専用コンテキストで実行され (Postgres と MySQL では `READ ONLY` トランザクション、SQLite では `PRAGMA query_only`)、書き込みは実行されるステートメントをそのまま示す承認カードで停止する。接続ごとにエージェントが参照できるスキーマとテーブルを制限でき、エージェントが実行した SQL はすべて `agent` タグ付きで通常のクエリ履歴に記録される。Anthropic または OpenAI のキー、Ollama などの OpenAI 互換エンドポイント、あるいはローカルの MCP エンドポイント経由で既存の Claude Code や Codex CLI のサブスクリプションで動作する。

## インストール

[最新リリース](https://github.com/OpenSkye-Labs/agentQL/releases/latest)から、お使いのプラットフォーム向けのインストーラをダウンロードする。macOS (Apple Silicon と Intel)、Windows、Linux (`.deb`、`.rpm`、`.AppImage`) に対応。アプリは起動時に更新を確認し、その場でインストールする。

## ソースからビルド

```bash
pnpm install
pnpm tauri dev        # desktop app
pnpm tauri build      # installers for your OS
```

Linux では Tauri の通常の前提パッケージ (webkit2gtk 4.1、gtk3、libssl) が必要。使い捨てのデータベースコンテナとライブドライバテストについては `docs/TESTING.md` を参照。

## AI プロバイダ

設定 → AI プロバイダ から、以下を 1 つ以上追加する。

- Anthropic API (キー)、OpenAI API (キー)、任意の OpenAI 互換エンドポイント (Ollama、OpenRouter、Groq など)
- Claude Code CLI または Codex CLI — 既存のログインをそのまま使う。アプリはローカルのトークン保護された MCP エンドポイント経由でデータベースツールを CLI に公開するため、承認とツールカードは同じように動作する。

エージェントによる書き込みはデフォルトで無効。有効にしてもチャット内でステートメントごとの承認が必要になる。

## コントリビュート

プルリクエストを歓迎する。ブランチ、チェック、リリースの手順は [CONTRIBUTING.md](CONTRIBUTING.md) を参照。

## コード署名ポリシー

リリースビルドは、このリポジトリの公開された[リリースワークフロー](.github/workflows/release.yml)でのみ生成される。Windows インストーラは [SignPath Foundation](https://signpath.org) の証明書を用いて [SignPath.io](https://signpath.io) で署名する予定 (申請中)。アップデータの成果物はさらにプロジェクトの minisign 鍵で署名され、アプリは更新をインストールする前にその署名を検証する。

- コミッターおよびレビュアー: [@aindong](https://github.com/aindong)
- 承認者: [@aindong](https://github.com/aindong)

## プライバシーポリシー

AgentQL は、ユーザーまたはインストール・運用する本人が明示的に要求しない限り、他のネットワーク上のシステムへ情報を送信しない。実際に接続するのは次のとおり。

- 接続として追加したデータベースと SSH ホスト (使用時のみ)
- 設定した AI プロバイダ (Anthropic、OpenAI、OpenAI 互換エンドポイント、またはローカルの Claude Code / Codex CLI) (アシスタントにメッセージを送信したときのみ)
- `github.com` (起動時に 1 回、新しいリリースの有無を確認するため)

テレメトリ、アナリティクス、クラッシュレポートは一切送信しない。認証情報は OS のキーチェーンに保存され、キーチェーンが利用できない場合はアプリのデータディレクトリ内のローカルファイルに保存される。

## ライセンス

[MIT](LICENSE)。

## ドキュメント

`CLAUDE.md` (リポジトリガイド) · `docs/PLAN.md` · `docs/ARCHITECTURE.md` · `docs/TASKS.md` · `docs/FEATURES.md` ·
`docs/REVIEWS.md` · `docs/TESTING.md`
