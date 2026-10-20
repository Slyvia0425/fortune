"use client";

import { useRouter } from "next/navigation";

export default function BackNavigation({ current }: { current: string }) {
  const router = useRouter();

  const goBack = () => {
    if (window.history.length > 1) {
      router.back();
      return;
    }
    router.push("/");
  };

  return <nav className="page-back-nav" aria-label="页面返回">
    <button type="button" onClick={goBack} aria-label={`返回上一页，当前页面：${current}`} title="返回上一页">
      <span className="back-arrow" aria-hidden="true">←</span>
    </button>
  </nav>;
}
