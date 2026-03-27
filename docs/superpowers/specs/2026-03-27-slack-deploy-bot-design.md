# Slack HTML Deploy Bot — Design Spec

## Context

Slack 특정 채널에 업로드된 HTML 파일을 자동으로 Cloudflare Pages에 배포하는 봇.
수동으로 HTML을 배포하는 반복 작업을 자동화하여, 파일 업로드만으로 즉시 프로덕션 배포가 이루어지도록 한다.

## Decisions

| 항목 | 결정 | 이유 |
|------|------|------|
| 언어/프레임워크 | TypeScript + Bolt.js | Slack 공식 SDK, Socket Mode 내장 지원 |
| 패키지 매니저 | pnpm | 빠르고 디스크 효율적 |
| Job Queue | In-memory (Map + async) | 프로토타입용, 외부 의존성 없음 |
| 배포 모델 | 고정 CF Pages 프로젝트 1개 | 항상 index.html로 배포. 가장 단순 |
| 아키텍처 | Monolith (단일 프로세스) | 로컬 Socket Mode ↔ Cloud Run HTTP mode 전환 용이 |
| 테스트 | vitest + v8 coverage | 빠르고 TypeScript 네이티브 |

## Architecture

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

## Project Structure

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
│   ├── unit/
│   │   ├── html-validator.test.ts
│   │   ├── deploy-queue.test.ts
│   │   └── config.test.ts
│   ├── service/
│   │   ├── slack-file.test.ts
│   │   ├── deployer.test.ts
│   │   └── notifier.test.ts
│   └── integration/
│       └── pipeline.test.ts
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── .env.example
├── .gitignore
├── Dockerfile
└── README.md
```

## Component Details

### config.ts — 환경변수 관리

```typescript
interface Config {
  // Slack
  SLACK_BOT_TOKEN: string;        // xoxb-... Bot User OAuth Token
  SLACK_SIGNING_SECRET?: string;  // Slack App Signing Secret (HTTP mode에서만 필수)
  SLACK_APP_TOKEN: string;        // xapp-... Socket Mode용
  SLACK_SOCKET_MODE: boolean;     // true=로컬, false=Cloud Run
  TARGET_CHANNEL_ID: string;      // 감시할 채널 ID
  NOTIFY_CHANNEL_ID: string;      // 결과 알림 채널 (같을 수 있음)

  // Cloudflare
  CLOUDFLARE_API_TOKEN: string;   // Pages Edit 권한
  CLOUDFLARE_ACCOUNT_ID: string;
  CLOUDFLARE_PROJECT_NAME: string;

  // App
  MAX_FILE_SIZE_BYTES: number;    // 기본 5MB (5242880)
  PORT: number;                   // HTTP mode 포트, 기본 3000
}
```

- 시작 시 필수 환경변수 누락이면 명확한 에러 메시지와 함께 프로세스 종료
- `SLACK_SIGNING_SECRET`은 HTTP mode(`SLACK_SOCKET_MODE=false`)일 때만 필수. Socket Mode에서는 App Token으로 인증
- `SLACK_SOCKET_MODE`는 문자열 "true"/"false"를 boolean으로 변환
- `MAX_FILE_SIZE_BYTES`와 `PORT`는 기본값 제공

### deploy-queue.ts — In-memory Job Queue

**목적**: Slack에 즉시 ACK 후 비동기 처리, 중복 방지, 직렬 실행

- `Map<string, Job>` — key는 `body.event_id` (Bolt.js handler의 `{ body }` 인자에서 추출)
- **Idempotency**: 같은 event_id 재요청 시 무시 (Slack 재시도 대응). 참고: `event_id`는 이벤트 payload가 아닌 outer envelope에 존재
- **직렬 실행**: 동시에 1개 job만 처리 (wrangler 충돌 방지)
- **재시도 정책**:
  - **재시도 가능**: wrangler 배포 실패, Slack API rate limit, 네트워크 에러 → 최대 2회 재시도
  - **재시도 불가** (즉시 실패): HTML 검증 실패, 비HTML 파일, url_private_download 누락 → 재시도 없이 실패 알림
- **상태 전이**: `pending → processing → done | failed`
- **메모리 관리**: 완료/실패된 job은 1시간 후 Map에서 자동 삭제 (메모리 누수 방지)

### file-shared.ts — 이벤트 핸들러

Bolt.js의 `app.event('file_shared')` 사용. 이벤트 payload에 `channel_id`, `file_id` 포함.
중복 방지 key는 outer envelope의 `body.event_id` 사용 (Bolt handler의 `{ body }` 인자).

1. `event.channel_id !== TARGET_CHANNEL_ID` → 무시 (다른 채널)
2. `queue.has(body.event_id)` → 무시 (중복 이벤트)
3. `queue.enqueue({ eventId: body.event_id, fileId: event.file_id, channelId: event.channel_id, userId: event.user_id })` → 비동기 처리 시작

### slack-file.ts — 파일 조회 & 다운로드

1. `app.client.files.info({ file: fileId })` 호출
2. `mimetype === 'text/html'` 또는 `name.endsWith('.html')` 확인
3. 조건 불일치 → 스킵 + 로그
4. `url_private_download` 존재 확인 — 없으면 에러 (외부 호스팅 파일 등의 경우 누락될 수 있음)
5. `fetch(url_private_download, { headers: { Authorization: 'Bearer ' + token } })`
6. `Buffer`로 반환

### html-validator.ts — HTML 검증

검사 항목:
- 파일 크기 ≤ `MAX_FILE_SIZE_BYTES`
- UTF-8 인코딩 확인
- `<!doctype html>` 또는 `<html` 태그 존재
- 빈 파일 거부

반환: `{ valid: boolean, errors: string[] }`

### deployer.ts — Wrangler 배포

1. `os.tmpdir()` 하위에 임시 `dist/` 디렉터리 생성
2. 다운로드한 HTML → `dist/index.html` 저장
3. `execa('pnpm', ['exec', 'wrangler', 'pages', 'deploy', 'dist/', '--project-name', PROJECT_NAME, '--branch', 'production'])` 실행
   - wrangler는 프로젝트의 devDependency로 설치하여 `pnpm exec`로 통일 (로컬/Docker 모두 동일 경로)
   - 환경변수로 `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` 전달
4. stdout에서 배포 URL 파싱
5. 임시 디렉터리 정리 (성공/실패 모두 finally에서)

### notifier.ts — Slack 알림

**성공 메시지 포맷:**
```
✅ 배포 완료
• 파일: {filename}
• 업로더: <@{userId}>
• 프로젝트: {projectName}
• URL: {deployUrl}
• 처리 시간: {duration}s
```

**실패 메시지 포맷:**
```
❌ 배포 실패
• 파일: {filename}
• 실패 단계: {stage}
• 원인: {errorMessage}
• 재시도: {retryCount}/{maxRetries}
```

`chat.postMessage`로 `NOTIFY_CHANNEL_ID`에 전송. 알림 전송 자체가 실패하면 로깅만 (2차 실패로 크래시하지 않음).

## Event Processing Flow

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

## Slack App Configuration

### Required Scopes (Bot Token Scopes)

| Scope | 용도 |
|-------|------|
| `files:read` | 앱이 추가된 채널의 파일 조회 |
| `chat:write` | 결과 메시지 전송 |
| `channels:history` | 공개 채널 메시지/컨텍스트 확인 |
| `groups:history` | 비공개 채널인 경우 |

### Event Subscriptions

- `file_shared` — 파일 공유 이벤트 수신

### Socket Mode

- 로컬 개발 시 활성화
- App-Level Token (`xapp-...`) 필요 — `connections:write` scope

## Environment Variables

```bash
# Slack
SLACK_BOT_TOKEN=xoxb-...          # Bot User OAuth Token
SLACK_SIGNING_SECRET=...           # App > Basic Information > Signing Secret (HTTP mode에서만 필수)
SLACK_APP_TOKEN=xapp-...           # App > Basic Information > App-Level Tokens
SLACK_SOCKET_MODE=true             # true=로컬 Socket Mode, false=HTTP Mode

# Channels
TARGET_CHANNEL_ID=C0123456789     # 감시할 채널 ID
NOTIFY_CHANNEL_ID=C0123456789     # 결과 알림 채널 (동일 가능)

# Cloudflare
CLOUDFLARE_API_TOKEN=...          # Pages Edit 권한
CLOUDFLARE_ACCOUNT_ID=...         # Account ID
CLOUDFLARE_PROJECT_NAME=my-site   # Pages 프로젝트명

# App (선택, 기본값 있음)
MAX_FILE_SIZE_BYTES=5242880       # 기본 5MB
PORT=3000                         # HTTP mode 포트
```

## Deployment

### Local Development (Socket Mode)

```bash
pnpm install
cp .env.example .env  # 환경변수 채우기
pnpm dev              # ts-node 또는 tsx로 실행
```

Socket Mode이므로 public URL 불필요, ngrok 없이 테스트 가능.

### Cloud Run (HTTP Mode)

**Dockerfile:**
```dockerfile
FROM node:20-alpine
RUN corepack enable && corepack prepare pnpm@latest --activate
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY dist/ ./dist/
EXPOSE 3000
ENV SLACK_SOCKET_MODE=false
CMD ["node", "dist/app.js"]
```

- 빌드: `pnpm build` (tsc)를 docker build 전에 실행하여 dist/ 생성 필요
- wrangler는 devDependency로 포함되므로 `--frozen-lockfile`로 설치 (--prod 아님)
- 환경변수는 Cloud Run 서비스 설정 또는 Secret Manager로 주입
- Slack App의 Event Subscriptions URL을 Cloud Run 서비스 URL + `/slack/events`로 설정

## Testing Strategy

### 이 프로젝트에서 테스트가 특히 중요한 이유

이 봇은 **외부 서비스 2개(Slack API, Cloudflare)**를 연결하는 자동화 파이프라인이다.

1. **사일런트 실패 위험**: 배포 실패가 조용히 넘어가면, 사용자는 배포된 줄 알지만 실제로는 안 된 상황이 발생한다
2. **Slack 이벤트 특성**: 재시도, 중복, 순서 역전이 가능하므로 idempotency와 queue 로직의 정확성이 핵심
3. **외부 API 불안정성**: Slack API, Cloudflare API 모두 장애/변경이 가능. 에러 핸들링이 제대로 작동하는지 검증 필수
4. **프로덕션 배포 자동화**: 봇이 실제 프로덕션 배포를 수행하므로, 잘못된 파일이 배포되면 사용자에게 직접 영향

### 테스트 프레임워크 & 도구

- **vitest** — 테스트 러너 + assertion (TypeScript 네이티브, 빠른 실행)
- **vitest coverage (v8 provider)** — 커버리지 측정
- **vitest mock** — Slack/Cloudflare API 모킹

### 테스트 레이어

| 레이어 | 대상 | 목적 | 커버리지 목표 |
|--------|------|------|--------------|
| **Unit** | html-validator, config, deploy-queue | 순수 로직의 정확성. 엣지 케이스 철저히 검증 | 90%+ |
| **Service** | slack-file, deployer, notifier | 외부 API 호출 로직을 mock 기반으로 검증 | 80%+ |
| **Integration** | file-shared handler (전체 파이프라인) | 이벤트→검증→배포→알림 전체 흐름 | 주요 경로 커버 |

### Unit 테스트 상세

**html-validator.test.ts:**
- 정상 HTML (`<!doctype html><html>...</html>`) → 통과
- DOCTYPE 없는 파일 → 거부 + 적절한 에러 메시지
- 파일 크기 초과 → 거부
- UTF-8 아닌 인코딩 → 거부
- 빈 파일 (0 bytes) → 거부
- `<html` 태그만 있고 doctype 없는 경우 → 통과 (둘 중 하나면 OK)

**deploy-queue.test.ts:**
- 중복 event_id 재요청 시 무시 확인
- 동시 실행 제한 (2개 job 동시 enqueue → 직렬 처리)
- 재시도 로직 (처리 함수 실패 시 최대 2회 재시도)
- 3회 실패 후 failed 상태 전이
- job 상태 전이 정확성 (pending → processing → done/failed)

**config.test.ts:**
- 필수 환경변수 누락 시 명확한 에러 메시지
- `SLACK_SOCKET_MODE` string → boolean 변환
- `MAX_FILE_SIZE_BYTES`, `PORT` 기본값 적용
- 모든 필수값 존재 시 정상 Config 객체 반환

### Service 테스트 상세

**slack-file.test.ts:**
- files.info 정상 응답 → 메타데이터 파싱 검증
- HTML이 아닌 파일 (mimetype !== text/html, 확장자 !== .html) → 스킵 반환
- 파일 다운로드 실패 (네트워크 에러) → 에러 전파
- files.info API 에러 (rate limit, 404) → 적절한 에러 처리

**deployer.test.ts:**
- wrangler 정상 실행 → stdout에서 URL 파싱 검증
- wrangler 실패 (exit code !== 0) → 에러 + stderr 포함
- 임시 디렉터리 정리 확인 (성공 시, 실패 시 모두 finally에서 정리)
- dist/index.html 파일 내용이 입력과 일치하는지

**notifier.test.ts:**
- 성공 메시지 포맷 검증 (파일명, 업로더, URL, 시간 포함)
- 실패 메시지 포맷 검증 (단계, 원인, 재시도 횟수 포함)
- chat.postMessage API 에러 시 로깅만 하고 throw하지 않음

### Integration 테스트 상세

**pipeline.test.ts:**
Slack API와 wrangler를 모두 mock한 상태에서 전체 파이프라인 검증:

- 정상 HTML 업로드 → 배포 성공 → 성공 메시지 전송 확인
- 비HTML 파일 업로드 → 무시 (배포/알림 없음)
- 잘못된 채널에서 업로드 → 무시
- 중복 이벤트 (같은 event_id 2회) → 한 번만 처리
- 배포 실패 → 재시도 후 실패 메시지 전송 확인
- HTML 검증 실패 → 배포 없이 실패 메시지

### 커버리지 설정

```typescript
// vitest.config.ts
export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['tests/**/*.test.ts', 'src/**/*.d.ts'],
      thresholds: {
        statements: 80,
        branches: 80,
        functions: 80,
        lines: 80,
      },
      reporter: ['text', 'html', 'lcov'],
    },
  },
});
```

- **전체 프로젝트 최소**: 80% (statements, branches, functions, lines)
- **핵심 로직 (validator, queue)**: 90%+ 목표
- CI에서 threshold 미달 시 빌드 실패

## Documentation (README.md)

README.md에 포함할 내용:

1. **프로젝트 개요** — 목적, 아키텍처 다이어그램 (ASCII)
2. **사전 요구사항** — Node.js 20+, pnpm, Wrangler CLI
3. **Slack App 설정 가이드** — 단계별 (앱 생성, 권한 설정, Socket Mode 활성화, Event Subscriptions, 채널 초대)
4. **Cloudflare Pages 설정 가이드** — API Token 생성 (Account > CF Pages > Edit), 프로젝트 생성
5. **환경변수 설명** — 각 변수의 용도, 필수/선택, 기본값 테이블
6. **로컬 개발 (Socket Mode)** — 설치, .env 설정, 실행, 테스트 방법
7. **Cloud Run 배포** — Docker 빌드, 배포 명령, Secret 설정, Slack Event URL 설정
8. **처리 흐름 설명** — 이벤트 수신부터 배포까지 단계별 설명
9. **테스트** — 테스트 실행, 커버리지 확인 방법
10. **트러블슈팅** — 흔한 에러와 해결법
11. **향후 개선 방향** — 폴더 매핑 확장, BullMQ 전환, 멀티 프로젝트 지원

## Graceful Shutdown

Cloud Run은 인스턴스를 SIGTERM으로 종료할 수 있다. 배포 중 프로세스가 죽으면 중간 상태가 남을 수 있으므로:

1. SIGTERM 수신 시 새 job 수락 중단
2. 현재 진행 중인 job이 있으면 완료까지 대기
3. 진행 중인 job 완료 후 프로세스 종료

**주의**: Cloud Run 기본 grace period는 10초이지만, wrangler 배포는 그보다 오래 걸릴 수 있다. Cloud Run 서비스 설정에서 `--timeout` 또는 `terminationGracePeriodSeconds`를 60초로 늘릴 것을 권장.

## Verification

### 로컬 E2E 테스트 (Socket Mode)

1. Slack App 생성 및 설정 완료
2. `.env` 파일에 모든 환경변수 설정
3. `pnpm dev`로 봇 시작
4. 대상 Slack 채널에 간단한 HTML 파일 업로드
5. 봇이 파일을 감지하고 배포 후 결과 메시지 전송 확인
6. Cloudflare Pages 배포 URL에서 HTML 확인

### 자동화 테스트

```bash
pnpm test          # 전체 테스트
pnpm test:coverage # 커버리지 포함
```
