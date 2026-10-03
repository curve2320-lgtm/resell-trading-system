/**
 * 출처(소스)별 수집 on/off 설정.
 *
 * 공개 발매·응모 정보 출처는 기본 켜짐입니다.
 * 등록만 된 출처와 실제 연결·날짜 확인에 성공한 출처는 수집 현황에서 구분합니다.
 *
 * 운영 중 특정 출처를 잠시 꺼야 할 때(장애·정책 변경 등) 환경변수로 조절합니다 (쉼표 구분):
 *   RELEASE_SOURCES_OFF="kream,soldout"   // 해당 출처 수집 끄기 (가장 우선 적용)
 *   RELEASE_SOURCES_ON="..."              // 코드 기본값(DEFAULT_OFF)으로 꺼 둔 출처를 켤 때만 사용
 */

export type ReleaseSourceKey =
  | "nike"
  | "adidas"
  | "shoeprize"
  | "grandstage"
  | "newBalance"
  | "musinsa"
  | "soldout"
  | "worksout"
  | "kasina"
  | "kream"
  | "converse"
  | "fila"
  | "northFace"
  | "palace"
  | "salomon"
  | "asics"
  | "tune"
  | "sns"
  | "instagramPublic";

const DEFAULT_OFF: string[] = [];

const DISABLED_MESSAGES: Partial<Record<ReleaseSourceKey, string>> = {};

function envList(name: string): string[] {
  return (process.env[name] ?? "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
}

export function sourceEnabled(key: string): boolean {
  const normalized = key.toLowerCase();
  if (envList("RELEASE_SOURCES_OFF").includes(normalized)) return false;
  if (envList("RELEASE_SOURCES_ON").includes(normalized)) return true;
  return !DEFAULT_OFF.includes(key);
}

export function disabledMessage(key: ReleaseSourceKey): string {
  return (
    DISABLED_MESSAGES[key] ??
    "설정(RELEASE_SOURCES_OFF)으로 수집을 꺼 둔 출처입니다."
  );
}
