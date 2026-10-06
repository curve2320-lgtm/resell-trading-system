"use client";

import { useRef } from "react";
import { officialInstagramAccounts } from "./instagram-accounts";

export function OfficialInstagramDialog({status,publicStatus,publicCount}:{status?:string;publicStatus?:string;publicCount?:number}) {
  const dialog=useRef<HTMLDialogElement>(null);
  const statusLabel=status === "connected" ? "공식 공지 자동 확인" : publicStatus === "connected" ? "일부 공개 공지만 자동 확인" : status === "error" ? "연결 확인 필요" : "공식 계정 원문 확인";
  return <>
    <button className="instagram-directory-button" type="button" onClick={()=>dialog.current?.showModal()}>
      공식 인스타그램 <span>{officialInstagramAccounts.length}개 ↗</span>
    </button>
    <dialog className="instagram-dialog" ref={dialog} aria-labelledby="instagram-directory-title">
      <header><div><h2 id="instagram-directory-title">브랜드 공식 인스타그램</h2><p>{statusLabel}</p></div><form method="dialog"><button aria-label="인스타그램 목록 닫기">×</button></form></header>
      <p className="instagram-directory-guide">브랜드 홈페이지에서 확인한 공식 계정입니다.{publicStatus === "connected" ? ` LINE FRIENDS US·New Era Hong Kong 홈페이지의 공개 공지를 자동 확인합니다${publicCount ? ` · ${publicCount}건` : ""}.` : ""}{status !== "connected" ? " 나머지 계정의 게시물 자동 수집은 연결되지 않았습니다. 계정 링크에서 원문을 확인할 수 있습니다." : ""}</p>
      <ul>{officialInstagramAccounts.map(account=><li key={account.handle}>
        <a href={account.profileUrl} target="_blank" rel="noopener noreferrer"><strong>{account.label}</strong><span>@{account.handle} ↗</span></a>
        <small>{account.region} · <a href={account.verifiedByUrl} target="_blank" rel="noopener noreferrer">공식 홈페이지</a></small>
      </li>)}</ul>
    </dialog>
  </>;
}
