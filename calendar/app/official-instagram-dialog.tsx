"use client";

import { useRef } from "react";
import { officialInstagramAccounts } from "./instagram-accounts";

export function OfficialInstagramDialog({status,publicStatus,publicCount}:{status?:string;publicStatus?:string;publicCount?:number}) {
  const dialog=useRef<HTMLDialogElement>(null);
  const statusLabel=status === "connected" ? "공식 공지 자동 확인" : status === "manual" ? "자동 수집 연결 필요" : status === "error" ? "연결 확인 필요" : "연결 상태 확인 중";
  return <>
    <button className="instagram-directory-button" type="button" onClick={()=>dialog.current?.showModal()}>
      공식 인스타그램 <span>{officialInstagramAccounts.length}개 ↗</span>
    </button>
    <dialog className="instagram-dialog" ref={dialog} aria-labelledby="instagram-directory-title">
      <header><div><h2 id="instagram-directory-title">브랜드 공식 인스타그램</h2><p>{statusLabel}</p></div><form method="dialog"><button aria-label="인스타그램 목록 닫기">×</button></form></header>
      <p className="instagram-directory-guide">브랜드 홈페이지에서 확인한 공식 계정입니다. 공지 원문을 확인할 수 있습니다.{publicStatus === "connected" ? ` 홈페이지에 공개된 Instagram 상품 공지는 자동 확인 중입니다${publicCount ? ` · ${publicCount}건` : ""}.` : ""}{status === "manual" ? " 전체 계정의 API 자동 수집은 관리자 인증 연결 후 시작됩니다." : ""}</p>
      <ul>{officialInstagramAccounts.map(account=><li key={account.handle}>
        <a href={account.profileUrl} target="_blank" rel="noopener noreferrer"><strong>{account.label}</strong><span>@{account.handle} ↗</span></a>
        <small>{account.region} · <a href={account.verifiedByUrl} target="_blank" rel="noopener noreferrer">공식 홈페이지</a></small>
      </li>)}</ul>
    </dialog>
  </>;
}
