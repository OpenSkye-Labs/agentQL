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
  <a href="README.md">English</a> · <a href="README.zh-CN.md">简体中文</a> · <a href="README.ja.md">日本語</a> · 한국어 · <a href="README.es.md">Español</a> · <a href="README.pt-BR.md">Português</a> · <a href="README.de.md">Deutsch</a> · <a href="README.fr.md">Français</a>
</p>

<p align="center"><sub>이 번역은 영어 README보다 늦게 갱신될 수 있습니다. 내용이 다를 경우 영어 버전을 기준으로 합니다.</sub></p>

<p align="center">
  <img src="assets/demo/showcase.gif" alt="AgentQL 둘러보기: 테이블 탐색, ER 다이어그램, 쿼리 실행, 에이전트에게 차트 요청, 쓰기 승인 또는 거부, 대시보드" width="960">
  <br>
  <sub>내장 데모 데이터셋으로 둘러보기: 테이블 탐색, ER 다이어그램, 쿼리, 에이전트에게 차트 요청, 승인이 필요한 쓰기 작업, 대시보드.</sub>
</p>

에이전트가 내장된 네이티브 크로스 플랫폼 데이터베이스 클라이언트입니다. TablePlus / DBeaver에 스키마를 읽고, 쿼리를 실행하고,
SQL을 최적화하고, 대시보드를 만들어 주는 어시스턴트를 더했다고 생각하면 됩니다. **여러분의** Claude 또는 OpenAI API
키, 혹은 이미 사용 중인 **Claude Code** / **Codex (ChatGPT)** 구독으로 동작합니다.

Tauri 2 + Rust (sqlx, redis, mongodb, russh, axum)와 React 19 + TypeScript로 만들었습니다.

## 지원 데이터베이스

PostgreSQL · MySQL · MariaDB · SQLite · Redis · MongoDB

호스트/자격 증명 또는 URL로 연결하며, SSL (require / verify-ca / verify-full, 클라이언트 인증서)과
SSH 터널 (agent, 키 파일, 비밀번호)을 지원합니다. 비밀번호는 OS 키체인에 저장됩니다.

## 주요 기능

- **쿼리 편집기** — 방언별 구문 강조와 스키마 자동 완성을 갖춘 CodeMirror. `Ctrl/⌘+Enter`로 커서 위치의
  문장을 실행하고, 다중 문장 스크립트는 문장마다 결과를 하나씩 반환하며, EXPLAIN / EXPLAIN ANALYZE를 지원합니다.
- **그리드** — 가상화, 키보드 탐색, 셀 인스펙터, TSV/JSON 복사, CSV/JSON/SQL 내보내기.
- **테이블 브라우저** — 필터 (WHERE), 정렬, 페이징, 인라인 편집은 검토 가능한 SQL로 변환되어 하나의
  트랜잭션으로 적용됩니다. 인덱스, 외래 키, DDL을 보여주는 구조 뷰.
- **Redis** — SCAN 기반 키 브라우저, 타입별 뷰어, TTL, 콘솔. **MongoDB** — find/aggregate, JSON 또는
  테이블 뷰, 문서 편집/삽입/삭제, 컬렉션 정보.
- **어시스턴트** — 답변 스트리밍, 도구 호출 (schema, run_sql, explain, charts), 모든 쓰기 작업 전 승인 요청,
  인라인 차트 렌더링, 저장하고 자동 갱신할 수 있는 대시보드 전체 제안.
- **안전성** — 읽기 전용 연결과 에이전트의 읽기는 파싱만으로가 아니라 _데이터베이스 차원에서_ 강제됩니다
  (READ ONLY 트랜잭션 / `PRAGMA query_only`).

## 화면 미리보기

<table>
  <tr>
    <td width="50%"><img src="assets/demo/grid.webp" alt="18만 2천 행의 orders 테이블을 탐색하는 가상화 그리드"><br><sub><b>그리드</b> · 가상화, 키보드 우선, 인라인 편집은 검토 가능한 SQL로 변환, FK 클릭 이동, 환경 배지.</sub></td>
    <td width="50%"><img src="assets/demo/erd.webp" alt="public 스키마의 ER 다이어그램"><br><sub><b>ER 다이어그램</b> · 실제 카탈로그에서 자동 배치. 테이블을 클릭하면 열리고 SVG/PNG로 내보낼 수 있습니다. 마이그레이션으로 복사할 수 있는 스키마 비교 기능도 바로 옆에 있습니다.</sub></td>
  </tr>
  <tr>
    <td><img src="assets/demo/query.webp" alt="별칭을 인식하는 자동 완성과 결과를 보여주는 SQL 편집기"><br><sub><b>편집기</b> · 별칭 인식 자동 완성, 외래 키 기반 JOIN 제안, 커서 위치의 문장 실행, EXPLAIN, vim 키맵, 스니펫, 저장된 쿼리의 버전 관리.</sub></td>
    <td><img src="assets/demo/agent-chart.webp" alt="스키마를 살펴보고 SQL을 실행한 뒤 차트를 반환하는 어시스턴트"><br><sub><b>에이전트</b> · 스키마를 살펴보고, SQL을 작성해 실행하고, 결과를 설명하고, 대시보드에 고정할 수 있는 차트를 반환합니다. 모든 단계가 보입니다.</sub></td>
  </tr>
  <tr>
    <td><img src="assets/demo/agent-approval.webp" alt="UPDATE 실행 전 승인을 요청하는 에이전트"><br><sub><b>쓰기 작업은 승인이 필요합니다</b> · 읽기는 데이터베이스가 강제하는 읽기 전용 컨텍스트에서 실행되고 (Postgres와 MySQL은 READ ONLY 트랜잭션, SQLite는 <code>PRAGMA query_only</code>), 쓰기는 실행할 문장을 그대로 보여주는 승인 카드에서 멈춥니다.</sub></td>
    <td><img src="assets/demo/dashboard.webp" alt="에이전트가 추가한 차트를 포함해 네 개의 차트가 있는 대시보드"><br><sub><b>대시보드</b> · 직접 작성한 쿼리나 에이전트의 쿼리로 만든 차트, 자동 갱신, 그리고 에이전트가 대시보드 전체를 제안할 수도 있습니다.</sub></td>
  </tr>
  <tr>
    <td colspan="2"><img src="assets/demo/theme-dracula.webp" alt="Dracula 테마의 Redis 키 브라우저"><br><sub><b>Redis와 MongoDB도 지원</b> · 콘솔을 갖춘 SCAN 기반 키 브라우저, Mongo find/aggregate와 문서 편집. 열 가지 테마 중 Dracula를 표시했으며, 시스템 설정 따르기는 Linux, macOS, Windows에서 동작합니다.</sub></td>
  </tr>
</table>

### 얼마나 에이전트다운가?

어시스턴트는 SQL을 붙여 넣어 주는 텍스트 상자가 아니라 도구를 사용하는 에이전트입니다. 매 턴마다 테이블 목록 조회,
컬럼과 외래 키 설명, 읽기 전용 SQL 실행, 실행 계획 설명, 차트 생성, 대시보드 제안, Redis 스캔, MongoDB 쿼리를
수행할 수 있으며, 실행한 쿼리와 돌려받은 행을 포함해 모든 단계를 보여줍니다. 가드레일은 프롬프트가 아니라 모델 아래
계층에서 강제됩니다. 읽기는 데이터베이스가 강제하는 읽기 전용 컨텍스트에서 실행되고 (Postgres와 MySQL은
`READ ONLY` 트랜잭션, SQLite는 `PRAGMA query_only`), 쓰기는 실행할 문장을 그대로 보여주는 승인 카드에서 멈추며,
연결마다 에이전트가 볼 수 있는 스키마와 테이블의 범위를 지정할 수 있고, 에이전트가 실행한 모든 SQL 문장은
`agent` 태그가 붙어 일반 쿼리 기록에 남습니다. Anthropic 또는 OpenAI 키, Ollama 같은 OpenAI 호환 엔드포인트,
혹은 로컬 MCP 엔드포인트를 통한 기존 Claude Code 또는 Codex CLI 구독으로 동작합니다.

## 설치

[최신 릴리스](https://github.com/OpenSkye-Labs/agentQL/releases/latest)에서 플랫폼에 맞는 설치 파일을 내려받으세요.
macOS (Apple Silicon 및 Intel), Windows, Linux (`.deb`, `.rpm`, `.AppImage`)를 지원합니다. 앱은 시작 시 업데이트를
확인하고 제자리에서 설치합니다.

## 소스에서 빌드

```bash
pnpm install
pnpm tauri dev        # desktop app
pnpm tauri build      # installers for your OS
```

Linux에서는 일반적인 Tauri 사전 요구 사항 (webkit2gtk 4.1, gtk3, libssl)이 필요합니다. 일회용 데이터베이스
컨테이너와 실제 드라이버 테스트는 `docs/TESTING.md`를 참고하세요.

## AI 제공자

설정 → AI 제공자. 다음 중 하나 이상을 추가합니다.

- Anthropic API (키), OpenAI API (키), 모든 OpenAI 호환 엔드포인트 (Ollama, OpenRouter, Groq 등)
- Claude Code CLI 또는 Codex CLI — 이미 로그인된 계정을 사용합니다. 앱은 토큰으로 보호되는 로컬 MCP 엔드포인트로
  데이터베이스 도구를 CLI에 노출하므로 승인과 도구 카드가 동일하게 동작합니다.

에이전트 쓰기 작업은 기본적으로 꺼져 있으며, 켜더라도 채팅에서 문장마다 승인이 필요합니다.

## 기여하기

Pull request를 환영합니다. 브랜치, 검사, 릴리스 절차는 [CONTRIBUTING.md](CONTRIBUTING.md)를 참고하세요.

## 코드 서명 정책

릴리스 빌드는 이 저장소의 공개 [release workflow](.github/workflows/release.yml)에서만 생성됩니다.
Windows 설치 파일은 [SignPath Foundation](https://signpath.org)의 인증서로 [SignPath.io](https://signpath.io)를
통해 서명할 예정입니다 (신청 진행 중). 업데이터 아티팩트는 프로젝트의 minisign 키로 추가 서명되며, 앱은 업데이트를
설치하기 전에 해당 서명을 검증합니다.

- 커미터 및 리뷰어: [@aindong](https://github.com/aindong)
- 승인자: [@aindong](https://github.com/aindong)

## 개인정보 처리방침

AgentQL은 사용자 또는 설치·운영하는 사람이 명시적으로 요청하지 않는 한 어떤 정보도 다른 네트워크 시스템으로
전송하지 않습니다. 실제로 연결하는 대상은 다음과 같습니다.

- 연결로 추가한 데이터베이스와 SSH 호스트 (사용할 때)
- 설정한 AI 제공자 (Anthropic, OpenAI, OpenAI 호환 엔드포인트, 또는 로컬 Claude Code / Codex CLI)
  (어시스턴트에게 메시지를 보낼 때만)
- `github.com` (시작 시 한 번, 새 릴리스가 있는지 확인하기 위해)

텔레메트리, 분석, 크래시 리포트는 전송하지 않습니다. 자격 증명은 OS 키체인에 저장되며, 키체인을 사용할 수 없는
경우 앱 데이터 디렉터리의 로컬 파일에 저장됩니다.

## 라이선스

[MIT](LICENSE).

## 문서

`CLAUDE.md` (저장소 가이드) · `docs/PLAN.md` · `docs/ARCHITECTURE.md` · `docs/TASKS.md` · `docs/FEATURES.md` ·
`docs/REVIEWS.md` · `docs/TESTING.md`
