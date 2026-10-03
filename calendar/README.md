# 리셀하는 유과장 수강생 발매 달력

수강생이 국내·해외 발매와 응모 일정을 한곳에서 확인하는 달력입니다. 월별 달력, 오늘·내일 일정, 브랜드·카테고리·지역 필터, 관심 일정 저장, 판매처 링크, 관리자 검수, 캘린더 파일 내보내기를 제공합니다.

현재 미리보기: [DROPLOG CLASS](https://droplog-class-release.curve2320.chatgpt.site/calendar). 이 Sites 프로젝트의 접근 권한은 소유자 전용입니다. 기존 `calendar.curve-corp.com`의 배포 설정이나 DNS는 이 소스에 포함되어 있지 않습니다.

## 수집 범위와 표시 기준

기존 수집 출처 17개에 신규 출처 카탈로그 30개를 추가했습니다. 신규 범위에는 atmos 일본, END., Slam Jam, Bodega, Stüssy, Kith, New Balance 해외, UNDEFEATED, BAPE, Patta, LEGO, 스타벅스 한정 MD, 박물관·포켓몬·LINE FRIENDS 등이 포함됩니다. Instagram 공식 API 연결도 별도로 준비되어 있습니다.

**등록된 출처 수는 자동 연결에 성공한 출처 수와 다릅니다.** 실제 연결·오류·확인 필요 상태는 관리자 수집 현황과 수집 API에서 확인합니다. 수강생 화면에는 전체 출처·직접 확인 섹션을 표시하지 않으며, 개별 상품의 판매처 링크는 유지합니다. 공식 페이지에서 명시된 발매일을 추출할 수 있을 때 달력에 반영하며, 접속 실패나 지원하지 않는 형식은 연결된 것으로 표시하지 않습니다. 날짜가 불확실한 공지는 관리자 검수로 보냅니다. 게시물 작성일을 발매일로 사용하지 않습니다.

SIBNA는 발매 정보 범위를 참고한 출처로 등록했으며 기본 수집은 꺼져 있습니다. 제공 API와 이용 조건을 확인한 뒤 사용할 수 있습니다. 공식 출처의 발매·응모·한정 상품 정보를 우선하고 일반 뉴스나 음식 행사처럼 달력과 관계없는 내용은 걸러냅니다.

수집은 한국 시간 **07:30, 09:30, 13:00, 18:00, 22:30** 구간을 기준으로, 사이트/API 요청 시 아직 처리되지 않은 최신 구간을 실행합니다. 별도 상시 스케줄러는 연결되어 있지 않습니다. 관리자 수동 수집도 지원하며 수집 실패 시 기존 캐시를 보존합니다.

`GET /api/releases`는 D1에 저장된 캐시를 우선 반환합니다. 필요한 수집은 Cloudflare `waitUntil`로 요청 응답 뒤에 처리하며, 한 번에 출처 4개씩 진행합니다. 출처별 처리 중복을 막는 구간 점유 정보를 D1에 저장하고 90초 만료 시간을 적용합니다. 각 어댑터의 실행 제한은 20초이며, 실패한 출처는 기존 데이터를 유지합니다.

수집이 진행 중이면 클라이언트는 4초 간격으로 API를 다시 조회해 갱신된 일정을 표시합니다. 각 요청의 제한 시간은 15초입니다. 네트워크 오류나 요청 시간 초과는 화면에 표시하며, 기존에 표시된 일정은 유지합니다. 요청 후 시작된 `waitUntil` 작업은 서버에서 이어질 수 있지만, 별도 요청이 없는 동안 다음 수집 구간을 스스로 시작하는 cron 작업은 아닙니다.

출처별 설정:

```dotenv
RELEASE_SOURCES_OFF=kream,soldout
# 기본 비활성 출처를 운영 설정으로 켤 때 사용
# RELEASE_SOURCES_ON=sibna
```

## 실행과 검사

Node.js **22.13 이상**과 npm이 필요합니다. 실행 환경은 Cloudflare Workers이며 데이터는 D1에 저장합니다. Next.js App Router 코드를 vinext와 Vite로 빌드합니다.

```sh
npm ci
npm test
npx tsc --project tsconfig.app.json --noEmit
npm run build
npm run dev -- --host 127.0.0.1
```

앱 타입 검사는 `tsconfig.app.json`을 사용합니다. 테스트 실행과 앱 타입 검사는 별도 검사입니다. 개발 서버 주소는 실행 로그에서 확인합니다.

로컬 D1에는 마이그레이션 적용이 필요합니다. 프로젝트 루트에 아래 예시를 `wrangler.local.json`으로 저장합니다. 예시 ID는 로컬 미리보기 전용입니다.

```json
{
  "name": "curve-calendar-local",
  "main": "worker/index.ts",
  "compatibility_date": "2026-05-15",
  "compatibility_flags": ["nodejs_compat"],
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "site-creator-d1",
      "database_id": "00000000-0000-4000-8000-000000000000",
      "migrations_dir": "drizzle"
    }
  ]
}
```

```sh
npx wrangler d1 migrations apply DB --local --config wrangler.local.json --persist-to .wrangler/state
```

모든 `drizzle/*.sql`을 순서대로 적용합니다. `0004_channel_schedule_metadata.sql`은 판매처별 응모 시작·마감·결과 발표 등 추가 정보를 저장하는 열을 추가합니다. 이전 마이그레이션을 수정하거나 운영 테이블을 초기화하지 않습니다. 동일한 운영 D1과 사용자 식별자를 유지하면 기존 관심 일정과 관리자 검수 데이터를 이어서 사용할 수 있습니다. 다른 서버로 이전할 때는 원본 DB를 별도로 백업·이전해야 하며 소스 ZIP에는 사용자 데이터가 들어 있지 않습니다.

## 배포와 인증

`.openai/hosting.json`은 현재 Sites 프로젝트와 `DB` 바인딩을 지정하고, `vite.config.ts`는 로컬 Workers/D1 미리보기를 설정합니다. 빌드 시 `dist/.openai`로 호스팅 설정과 마이그레이션을 복사합니다. Sites 배포는 검증된 소스 커밋과 해당 빌드 산출물을 함께 등록합니다.

다른 Cloudflare 계정에 배포할 때는 실제 D1 데이터베이스 ID와 운영 Worker 바인딩을 설정하고 마이그레이션을 적용해야 합니다. 현재 로컬용 D1 ID를 운영에 사용하지 않습니다. Cloudflare Workers를 전제로 하므로 Vercel에 그대로 올리는 구성은 아닙니다.

현재 로그인은 Sites가 전달하는 신뢰된 사용자 정보와 ChatGPT 로그인 경로를 사용합니다. **Sites 외부로 이전하려면 실제 로그인 세션과 사용자 검증을 연결해야 합니다.** 공개 요청에서 인증 헤더를 임의로 받아 관리자 권한을 부여하면 안 됩니다. 관심 일정은 로그인한 사용자별로 저장되며, 관리자 API는 인증과 서버의 `ADMIN_EMAILS` 허용 목록을 함께 검사합니다. 관리자 이메일과 API 토큰은 서버 환경 변수·비밀 값으로 설정합니다.

```dotenv
ADMIN_EMAILS=관리자_이메일
```

## Instagram 연결

Instagram은 현재 실제 계정에 연결되어 있지 않습니다. 권한이 있는 Meta 공식 API의 Business Discovery를 이용하도록 준비했습니다. 다음 값은 서버에서만 설정하며 저장소·브라우저·공개 설정 파일에 넣지 않습니다.

```dotenv
INSTAGRAM_ACCESS_TOKEN=서버_비밀_값
INSTAGRAM_BUSINESS_ACCOUNT_ID=숫자_계정_ID
INSTAGRAM_GRAPH_VERSION=v버전
INSTAGRAM_SOURCE_HANDLES=브랜드계정1,브랜드계정2
```

지원 API 버전과 계정 권한을 확인한 뒤 값을 설정합니다. 최대 20개 계정의 최근 공지를 순차 조회합니다. Instagram 문구에는 여러 지역과 일정이 섞일 수 있어 자동 추측하지 않고 날짜 미확정 공지로 등록한 뒤 관리자가 검수합니다. 계정 연결 정보가 없거나 권한 검증에 실패하면 관리자 수집 현황에 확인 필요 상태가 표시됩니다.

## 캘린더 내보내기

화면의 `.ics` 내보내기는 선택한 월 또는 관심 일정의 **다운로드 시점 스냅샷**입니다. 휴대전화·Google·Apple 캘린더 등으로 가져올 수 있지만 이후 사이트에서 일정이 바뀌어도 자동 갱신되는 구독 링크는 아닙니다. 확인된 시각은 한국 시간 기준으로 변환하고, 시각이 미확정이면 임의 시간을 만들지 않습니다.

## 주요 파일

| 경로 | 역할 |
| --- | --- |
| `app/release-board.tsx` | 달력·오늘 보기·필터·관심 일정 UI |
| `app/expanded-sources.ts` | 추가 출처 카탈로그와 국가 정보 |
| `app/collection/expanded-adapters.ts` | 해외 달력·공식 공지 파싱 |
| `app/collection/lifestyle-adapters.ts` | LEGO·스타벅스 상품 공지 파싱 |
| `app/collection/instagram-adapter.ts` | 선택적 Meta API 연결 |
| `app/collection/repository.ts` | D1 저장·검수·캐시 관리 |
| `app/release-calendar-export.ts` | `.ics` 생성 |
| `app/chatgpt-auth.ts`, `app/admin-auth.ts` | 사용자·관리자 권한 확인 |
| `db/schema.ts`, `drizzle/` | 데이터 구조와 마이그레이션 |

소스 패키지에는 의존성 설치물, 운영 DB, `.env`, API 토큰이 포함되지 않습니다. GitHub 업로드 위치와 최종 배포 주소는 함께 제공하는 교체 안내에서 확인합니다.
