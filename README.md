# Slack HTML Deploy Bot

Slack 채널에 업로드된 HTML 파일을 자동으로 Cloudflare Pages에 배포하는 봇

## 목차

1. [프로젝트 개요](#1-프로젝트-개요)
2. [사전 요구사항](#2-사전-요구사항)
3. [Slack App 설정 가이드](#3-slack-app-설정-가이드)
4. [Cloudflare Pages 설정 가이드](#4-cloudflare-pages-설정-가이드)
5. [환경변수 설명](#5-환경변수-설명)
6. [로컬 개발 (Socket Mode)](#6-로컬-개발-socket-mode)
7. [Cloud Run 배포](#7-cloud-run-배포)
8. [처리 흐름 설명](#8-처리-흐름-설명)
9. [테스트](#9-테스트)
10. [트러블슈팅](#10-트러블슈팅)
11. [향후 개선 방향](#11-향후-개선-방향)

---

## 1. 프로젝트 개요

수동으로 HTML을 배포하는 반복 작업을 자동화하여, Slack 채널에 파일을 업로드하는 것만으로 즉시 Cloudflare Pages에 프로덕션 배포가 이루어지도록 한다.

### 주요 기능

- Slack 특정 채널에 업로드된 HTML 파일 자동 감지
- HTML 파일 검증 (크기, 인코딩, 구조)
- Cloudflare Pages에 자동 배포 (Wrangler CLI 사용)
- 배포 결과를 Slack 메시지로 알림 (성공/실패)
- 중복 이벤트 방지 (idempotency)
- 직렬 실행 큐로 배포 충돌 방지

### 아키텍처

```
┌──────────────────────────────────────────────────────┐
│                    Bolt.js App                        │
│                                                      │
│  ┌─────────────┐   ┌──────────────┐                  │
│  │ file_shared  │──▶│ deploy-queue │                  │
│  │  handler     │   │ (in-memory)  │                  │
│  └─────────────┘   └──────┬───────┘                  │
│                           │                          │
│                    ┌──────▼───────┐                   │
│                    │   Worker     │                   │
│                    │              │                   │
│                    │ 1. files.info│                   │
│                    │ 2. download  │                   │
│                    │ 3. validate  │                   │
│                    │ 4. wrangler  │                   │
│                    │ 5. notify    │                   │
│                    └──────────────┘                   │
└──────────────────────────────────────────────────────┘

로컬: Socket Mode (SLACK_APP_TOKEN)
Cloud Run: HTTP Mode (/slack/events endpoint)
```

### 프로젝트 구조

```
lens-prototype-deploy-bot/
├── src/
│   ├── app.ts                 # Bolt App 초기화, 이벤트 리스너 등록, 서버 시작
│   ├── handlers/
│   │   └── file-shared.ts     # file_shared 이벤트 핸들러
│   ├── services/
│   │   ├── slack-file.ts      # files.info 조회 + 파일 다운로드
│   │   ├── html-validator.ts  # HTML 검증 로직
│   │   ├── deployer.ts        # Wrangler 실행으로 CF Pages 배포
│   │   └── notifier.ts        # Slack 결과 메시지 전송
│   ├── queue/
│   │   └── deploy-queue.ts    # In-memory queue (idempotency, 직렬화)
│   └── config.ts              # 환경변수 로딩 + validation
├── tests/
│   ├── unit/                  # 순수 로직 테스트
│   ├── service/               # 외부 API 모킹 테스트
│   └── integration/           # 전체 파이프라인 테스트
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── .env.example
├── .gitignore
└── Dockerfile
```

---

## 2. 사전 요구사항

| 항목 | 버전/조건 | 비고 |
|------|-----------|------|
| **Node.js** | 20 이상 | LTS 권장 |
| **pnpm** | 최신 | `corepack enable`으로 활성화 가능 |
| **Wrangler CLI** | 프로젝트 devDependency로 설치됨 | 별도 글로벌 설치 불필요. `pnpm exec wrangler`로 사용 |
| **Slack Workspace** | 관리자 권한 | 앱 설치 및 채널 관리를 위해 필요 |
| **Cloudflare 계정** | Pages 사용 가능 | 무료 플랜으로 충분 |

---

## 3. Slack App 설정 가이드

### 3-1. 앱 생성

1. [api.slack.com/apps](https://api.slack.com/apps) 접속
2. **Create New App** 클릭
3. **From Scratch** 선택
4. App 이름과 워크스페이스를 지정하여 생성

### 3-2. Bot Token Scopes 설정

**OAuth & Permissions** 메뉴에서 아래 Bot Token Scopes를 추가한다:

| Scope | 용도 |
|-------|------|
| `files:read` | 앱이 추가된 채널의 파일 조회 |
| `chat:write` | 배포 결과 메시지 전송 |
| `channels:history` | 공개 채널 메시지/컨텍스트 확인 |
| `groups:history` | 비공개 채널인 경우 |

### 3-3. Event Subscriptions 설정

**Event Subscriptions** 메뉴에서:

1. **Enable Events**를 ON으로 전환
2. **Subscribe to bot events** 섹션에서 `file_shared` 이벤트 추가
3. Cloud Run 배포 시에는 Request URL을 `https://<Cloud Run URL>/slack/events`로 설정 (Socket Mode 사용 시 이 단계 불필요)

### 3-4. Socket Mode 활성화 (로컬 개발용)

로컬 개발 시에는 Socket Mode를 사용하면 public URL 없이도 이벤트를 수신할 수 있다.

1. **Settings > Socket Mode** 메뉴로 이동
2. **Enable Socket Mode** 활성화
3. App-Level Token 생성:
   - **Settings > Basic Information > App-Level Tokens** 섹션
   - **Generate Token and Scopes** 클릭
   - Token 이름 지정 (예: `socket-token`)
   - `connections:write` scope 추가
   - **Generate** 클릭
4. 생성된 `xapp-...` 토큰을 `SLACK_APP_TOKEN` 환경변수로 사용

### 3-5. Install to Workspace

1. **OAuth & Permissions** 메뉴에서 **Install to Workspace** 클릭
2. 권한을 확인하고 **Allow** 클릭
3. 생성된 **Bot User OAuth Token** (`xoxb-...`)을 `SLACK_BOT_TOKEN` 환경변수로 사용

### 3-6. 대상 채널에 봇 초대

봇이 파일 이벤트를 수신하려면 해당 채널에 초대되어 있어야 한다:

```
/invite @봇이름
```

감시 대상 채널(`TARGET_CHANNEL_ID`)과 알림 채널(`NOTIFY_CHANNEL_ID`)이 다른 경우, 두 채널 모두에 봇을 초대해야 한다.

---

## 4. Cloudflare Pages 설정 가이드

### 4-1. Pages 프로젝트 생성

1. [Cloudflare Dashboard](https://dash.cloudflare.com/) 접속
2. **Workers & Pages** > **Pages** 메뉴로 이동
3. **Create a project** 클릭
4. **Direct Upload** 선택 (Git 연동이 아닌 직접 업로드 방식)
5. 프로젝트 이름을 지정 (이 이름이 `CLOUDFLARE_PROJECT_NAME` 환경변수가 됨)
6. 빈 디렉터리라도 초기 배포를 한 번 수행하여 프로젝트를 생성

### 4-2. API Token 생성

1. [Cloudflare Dashboard](https://dash.cloudflare.com/) > **My Profile** > **API Tokens**
2. **Create Token** 클릭
3. **Custom Token** 생성:
   - **Permissions**: Account > Cloudflare Pages > **Edit**
   - **Account Resources**: 해당 계정 선택
4. 생성된 토큰을 `CLOUDFLARE_API_TOKEN` 환경변수로 사용

### 4-3. Account ID 확인

1. Cloudflare Dashboard 우측 사이드바에서 **Account ID** 확인
2. 또는 Dashboard URL에서 확인: `https://dash.cloudflare.com/<ACCOUNT_ID>/...`
3. 이 값을 `CLOUDFLARE_ACCOUNT_ID` 환경변수로 사용

---

## 5. 환경변수 설명

| 변수명 | 필수 | 기본값 | 설명 |
|--------|------|--------|------|
| `SLACK_BOT_TOKEN` | O | - | Bot User OAuth Token (`xoxb-...`). OAuth & Permissions에서 발급 |
| `SLACK_SIGNING_SECRET` | 조건부 | - | App Signing Secret. HTTP mode(`SLACK_SOCKET_MODE=false`)에서만 필수. Basic Information에서 확인 |
| `SLACK_APP_TOKEN` | O | - | App-Level Token (`xapp-...`). Socket Mode용. Basic Information > App-Level Tokens에서 생성 |
| `SLACK_SOCKET_MODE` | O | - | `true`=로컬 Socket Mode, `false`=HTTP Mode (Cloud Run) |
| `TARGET_CHANNEL_ID` | O | - | 파일 업로드를 감시할 Slack 채널 ID (`C0123456789` 형식) |
| `NOTIFY_CHANNEL_ID` | O | - | 배포 결과 알림을 보낼 Slack 채널 ID. TARGET_CHANNEL_ID와 동일 가능 |
| `CLOUDFLARE_API_TOKEN` | O | - | Cloudflare API Token (Pages Edit 권한) |
| `CLOUDFLARE_ACCOUNT_ID` | O | - | Cloudflare Account ID |
| `CLOUDFLARE_PROJECT_NAME` | O | - | Cloudflare Pages 프로젝트명 |
| `MAX_FILE_SIZE_BYTES` | X | `5242880` | 최대 허용 파일 크기 (바이트). 기본 5MB |
| `PORT` | X | `3000` | HTTP mode에서 사용할 포트 |

> 채널 ID는 Slack에서 채널명을 우클릭 > **Copy link**로 확인하거나, 채널 상세 정보 하단에서 확인할 수 있다.

---

## 6. 로컬 개발 (Socket Mode)

Socket Mode를 사용하면 ngrok 등의 터널링 도구 없이 로컬에서 바로 Slack 이벤트를 수신할 수 있다.

### 설치 및 실행

```bash
# 저장소 클론
git clone <repository-url>
cd lens-prototype-deploy-bot

# 의존성 설치
pnpm install

# 환경변수 파일 생성
cp .env.example .env
```

`.env` 파일을 편집하여 모든 필수 환경변수를 설정한다:

```bash
# .env
SLACK_BOT_TOKEN=xoxb-...
SLACK_SIGNING_SECRET=...
SLACK_APP_TOKEN=xapp-...
SLACK_SOCKET_MODE=true

TARGET_CHANNEL_ID=C0123456789
NOTIFY_CHANNEL_ID=C0123456789

CLOUDFLARE_API_TOKEN=...
CLOUDFLARE_ACCOUNT_ID=...
CLOUDFLARE_PROJECT_NAME=my-site
```

봇을 시작한다:

```bash
pnpm dev
```

Socket Mode이므로 public URL이 필요 없고, ngrok 없이 바로 테스트가 가능하다.

### 동작 확인

1. 대상 Slack 채널에 간단한 HTML 파일 업로드
2. 봇이 파일을 감지하고 배포 후 결과 메시지를 전송하는지 확인
3. Cloudflare Pages 배포 URL에서 HTML이 정상적으로 표시되는지 확인

---

## 7. Cloud Run 배포

### 7-1. 사전 준비

#### gcloud CLI 설치

```bash
# macOS
brew install google-cloud-sdk

# 로그인 및 프로젝트 설정
gcloud auth login
gcloud config set project <PROJECT_ID>
```

#### 필요 API 활성화

```bash
gcloud services enable \
  run.googleapis.com \
  secretmanager.googleapis.com \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com
```

### 7-2. Secret Manager에 시크릿 등록

민감한 환경변수를 Secret Manager에 등록한다. 각 값은 `.env` 파일 또는 Slack/Cloudflare 대시보드에서 확인.

```bash
echo -n "xoxb-..." | gcloud secrets create slack-bot-token --data-file=-
echo -n "..." | gcloud secrets create slack-signing-secret --data-file=-
echo -n "xapp-..." | gcloud secrets create slack-app-token --data-file=-
echo -n "..." | gcloud secrets create cloudflare-api-token --data-file=-
echo -n "..." | gcloud secrets create cloudflare-account-id --data-file=-
```

### 7-3. Cloud Run 배포

프로젝트 루트에서 실행. `--source .`로 Dockerfile 기반 Cloud Build 자동 빌드.

```bash
gcloud run deploy lens-deploy-bot \
  --source . \
  --region asia-northeast3 \
  --port 3000 \
  --timeout 60 \
  --max-instances 1 \
  --min-instances 0 \
  --allow-unauthenticated \
  --set-env-vars "SLACK_SOCKET_MODE=false,TARGET_CHANNEL_ID=<CHANNEL_ID>,NOTIFY_CHANNEL_ID=<CHANNEL_ID>,CLOUDFLARE_PROJECT_NAME=<PROJECT_NAME>,ALLOWED_USER_IDS=<USER_IDS>" \
  --set-secrets "SLACK_BOT_TOKEN=slack-bot-token:latest,SLACK_SIGNING_SECRET=slack-signing-secret:latest,SLACK_APP_TOKEN=slack-app-token:latest,CLOUDFLARE_API_TOKEN=cloudflare-api-token:latest,CLOUDFLARE_ACCOUNT_ID=cloudflare-account-id:latest"
```

| 옵션 | 설명 |
|------|------|
| `--timeout 60` | wrangler 배포가 10초 넘을 수 있으므로 60초로 설정 |
| `--max-instances 1` | in-memory queue 사용으로 단일 인스턴스 필수 |
| `--min-instances 0` | 비용 절약 (cold start 발생 가능). 안정성 우선이면 `1`로 변경 |
| `--allow-unauthenticated` | Slack webhook 수신을 위해 필수 (보안은 Signing Secret으로 처리) |

배포 완료 시 서비스 URL이 출력된다 (예: `https://lens-deploy-bot-xxxxx-an.a.run.app`).

### 7-4. Slack App Event URL 설정

1. [api.slack.com/apps](https://api.slack.com/apps) → 앱 선택
2. **Settings > Socket Mode** → **OFF** (HTTP mode로 전환)
3. **Event Subscriptions** → Enable Events ON
4. **Request URL**: `https://<CLOUD_RUN_URL>/slack/events` 입력
5. "Verified" 표시 확인
6. **Save Changes**

> **주의**: Socket Mode를 끄면 로컬 `pnpm dev`가 동작하지 않는다. 로컬 개발이 필요하면 Socket Mode를 다시 켜거나 별도 Slack App을 사용.

### 7-5. 배포 후 업데이트

#### 코드 수정 후 재배포

```bash
gcloud run deploy lens-deploy-bot --source . --region asia-northeast3
```

기존 환경변수/시크릿 설정이 유지된다. 소스만 다시 빌드하여 새 리비전 배포.

#### 환경변수만 변경 (재빌드 불필요)

```bash
gcloud run services update lens-deploy-bot \
  --region asia-northeast3 \
  --set-env-vars "TARGET_CHANNEL_ID=<NEW_CHANNEL_ID>"
```

#### 시크릿 값 변경

```bash
# 시크릿 새 버전 추가
echo -n "new-token-value" | gcloud secrets versions add slack-bot-token --data-file=-

# Cloud Run이 latest를 참조하므로, 새 리비전 배포하면 반영
gcloud run deploy lens-deploy-bot --source . --region asia-northeast3
```

#### 롤백

```bash
# 이전 리비전 목록 확인
gcloud run revisions list --service lens-deploy-bot --region asia-northeast3

# 특정 리비전으로 트래픽 전환
gcloud run services update-traffic lens-deploy-bot \
  --region asia-northeast3 \
  --to-revisions <REVISION_NAME>=100
```

### 7-6. 로그 확인

```bash
gcloud run services logs read lens-deploy-bot --region asia-northeast3 --limit 50
```

또는 GCP 콘솔 > Cloud Run > lens-deploy-bot > **로그** 탭에서 확인.

### 7-7. Graceful Shutdown

wrangler 배포에 시간이 걸릴 수 있으므로 `--timeout 60`을 설정한다. SIGTERM 수신 시 새 job 수락을 중단하고, 진행 중인 job이 완료될 때까지 대기한 후 프로세스를 종료한다.

---

## 8. 처리 흐름 설명

HTML 파일이 업로드되면 다음 단계로 처리된다:

```
1. 사용자가 TARGET_CHANNEL에 HTML 파일 업로드
2. Slack → file_shared 이벤트 전송
3. Bolt.js 수신 → file-shared handler
4. 채널 필터링 (TARGET_CHANNEL_ID 확인)
5. 중복 체크 (event_id)
6. Queue에 job 추가 → 즉시 ACK (200 OK)
7. Queue worker가 job 처리 시작:
   a. files.info(file_id) → 메타데이터 조회
   b. HTML 파일 여부 확인 (mimetype/확장자)
   c. url_private_download로 파일 다운로드
   d. HTML 검증 (크기, UTF-8, doctype)
   e. dist/index.html로 저장
   f. wrangler pages deploy 실행
   g. 배포 URL 파싱
8. 성공 → chat.postMessage로 성공 알림
   실패 → 재시도 (최대 2회) 또는 실패 알림
```

### 상세 설명

- **채널 필터링 (4단계)**: `TARGET_CHANNEL_ID`와 일치하는 채널에서만 동작하므로, 봇이 다른 채널에 초대되어 있어도 해당 채널의 파일은 무시된다.
- **중복 체크 (5단계)**: Slack은 이벤트 전송 실패 시 재시도할 수 있다. `event_id` 기반 idempotency로 같은 이벤트를 두 번 처리하지 않는다.
- **즉시 ACK (6단계)**: Slack은 3초 내 응답을 기대한다. 배포 작업은 큐에 넣고 즉시 200 OK를 반환한다.
- **직렬 실행 (7단계)**: 큐는 동시에 1개의 job만 처리한다. wrangler 배포가 동시에 실행되면 충돌할 수 있기 때문이다.
- **재시도 정책 (8단계)**:
  - **재시도 가능**: wrangler 배포 실패, Slack API rate limit, 네트워크 에러 -> 최대 2회 재시도
  - **재시도 불가** (즉시 실패): HTML 검증 실패, 비HTML 파일, url_private_download 누락 -> 재시도 없이 실패 알림

### 알림 메시지 포맷

**성공:**
```
✅ 배포 완료
• 파일: {filename}
• 업로더: <@{userId}>
• 프로젝트: {projectName}
• URL: {deployUrl}
• 처리 시간: {duration}s
```

**실패:**
```
❌ 배포 실패
• 파일: {filename}
• 실패 단계: {stage}
• 원인: {errorMessage}
• 재시도: {retryCount}/{maxRetries}
```

---

## 9. 테스트

### 테스트 실행

```bash
# 전체 테스트
pnpm test

# Watch mode (파일 변경 시 자동 재실행)
pnpm test:watch

# 커버리지 포함
pnpm test:coverage
```

### 테스트 구조

| 레이어 | 디렉터리 | 대상 | 목적 | 커버리지 목표 |
|--------|----------|------|------|--------------|
| **Unit** | `tests/unit/` | html-validator, config, deploy-queue | 순수 로직의 정확성. 엣지 케이스 철저히 검증 | 90%+ |
| **Service** | `tests/service/` | slack-file, deployer, notifier | 외부 API 호출 로직을 mock 기반으로 검증 | 80%+ |
| **Integration** | `tests/integration/` | file-shared handler (전체 파이프라인) | 이벤트 -> 검증 -> 배포 -> 알림 전체 흐름 | 주요 경로 커버 |

### Unit 테스트

- **html-validator**: 정상 HTML 통과, DOCTYPE 누락 거부, 크기 초과 거부, UTF-8 아닌 인코딩 거부, 빈 파일 거부
- **deploy-queue**: 중복 event_id 무시, 동시 실행 제한 (직렬 처리), 재시도 로직 (최대 2회), 상태 전이 정확성
- **config**: 필수 환경변수 누락 시 에러, boolean 변환, 기본값 적용

### Service 테스트

- **slack-file**: files.info 응답 파싱, 비HTML 파일 스킵, 다운로드 실패 에러 전파, API 에러 처리
- **deployer**: wrangler stdout에서 URL 파싱, wrangler 실패 시 에러 처리, 임시 디렉터리 정리 확인
- **notifier**: 성공/실패 메시지 포맷 검증, chat.postMessage 에러 시 throw하지 않고 로깅만 수행

### Integration 테스트

Slack API와 wrangler를 모두 mock한 상태에서 전체 파이프라인을 검증한다:

- 정상 HTML 업로드 -> 배포 성공 -> 성공 메시지 전송
- 비HTML 파일 업로드 -> 무시
- 잘못된 채널에서 업로드 -> 무시
- 중복 이벤트 (같은 event_id 2회) -> 한 번만 처리
- 배포 실패 -> 재시도 후 실패 메시지 전송
- HTML 검증 실패 -> 배포 없이 실패 메시지

### 커버리지 목표

- **전체 프로젝트 최소**: 80% (statements, branches, functions, lines)
- **핵심 로직** (validator, queue): **90%+** 목표
- CI에서 threshold 미달 시 빌드 실패

---

## 10. 트러블슈팅

### 봇이 이벤트에 반응하지 않음

- **채널 초대 확인**: 대상 채널에서 `/invite @봇이름`으로 봇이 초대되어 있는지 확인
- **Bot Token Scope 확인**: `files:read`, `chat:write`, `channels:history`, `groups:history`가 모두 추가되어 있는지 확인
- **Socket Mode Token 확인**: `SLACK_APP_TOKEN`(`xapp-...`)이 올바르게 설정되어 있는지 확인
- **채널 ID 확인**: `TARGET_CHANNEL_ID`가 정확한지 확인. 채널명이 아닌 채널 ID(`C0123456789` 형식)여야 함
- **Event Subscriptions**: `file_shared` 이벤트가 등록되어 있는지 확인

### Wrangler 인증 에러

- **API Token 권한 확인**: Cloudflare API Token의 권한이 **Account > Cloudflare Pages > Edit**으로 설정되어 있는지 확인
- **Account ID 확인**: `CLOUDFLARE_ACCOUNT_ID`가 올바른지 확인
- **프로젝트 존재 여부**: `CLOUDFLARE_PROJECT_NAME`에 해당하는 Pages 프로젝트가 Cloudflare에 실제로 존재하는지 확인

### 중복 알림이 발생함

- 정상 동작이다. Slack은 이벤트 전송 실패 시 재시도하는데, 봇의 idempotency 로직이 동일한 `event_id`의 중복 처리를 방지한다. 간헐적으로 중복 알림이 보인다면 Slack 재시도 중에 정상적으로 동작하고 있는 것이다.

### 배포 URL이 파싱되지 않음

- **wrangler 버전 확인**: `pnpm exec wrangler --version`으로 버전을 확인. 버전 업데이트 시 stdout 출력 형식이 변경될 수 있다
- **출력 형식 변경 여부**: wrangler의 출력을 직접 확인하여 URL 패턴이 기대와 일치하는지 점검

### Socket Mode 연결 실패

- **SLACK_APP_TOKEN 확인**: `xapp-`으로 시작하는 App-Level Token이 올바르게 설정되어 있는지 확인
- **connections:write scope 확인**: App-Level Token 생성 시 `connections:write` scope가 포함되어 있는지 확인
- **Socket Mode 활성화 확인**: Slack App 설정 > Socket Mode가 활성화되어 있는지 확인

---

## 11. 향후 개선 방향

| 개선 사항 | 설명 |
|-----------|------|
| **폴더별 프로젝트 매핑** | `site-a/` -> `project-a`, `site-b/` -> `project-b`처럼 업로드 경로에 따라 다른 CF Pages 프로젝트에 배포 |
| **BullMQ + Redis로 job queue 전환** | 현재 in-memory 큐를 BullMQ + Redis로 전환하여 프로세스 재시작 시에도 job 유지, 분산 처리 가능 |
| **멀티 프로젝트 지원** | 단일 프로젝트가 아닌 여러 CF Pages 프로젝트에 동시 배포 지원 |
| **CSS/JS 등 관련 에셋 함께 배포** | HTML 단독이 아닌 CSS, JS, 이미지 등 관련 파일을 함께 묶어 배포 |
| **배포 히스토리 관리** | 이전 배포 기록을 저장하고 조회할 수 있는 기능 |
| **Slack Interactive Messages** | 배포 확인 버튼, 롤백 버튼 등 Slack 인터랙티브 메시지를 통한 배포 관리 |
