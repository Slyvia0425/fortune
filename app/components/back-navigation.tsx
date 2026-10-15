"use client";

import { useRouter } from "next/navigation";
import { useI18n } from "@/lib/i18n";

export default function BackNavigation({ current }: { current: string }) {
  const router = useRouter();
  const { t } = useI18n();

  const goBack = () => {
    if (window.history.length > 1) {
      router.back();
      return;
    }
    router.push("/");
  };

  return <nav className="page-back-nav" aria-label={t("页面返回")}>
    <button
      type="button"
      onClick={goBack}
      aria-label={t("返回上一页，当前页面：{current}", { current: t(current) })}
      title={t("返回上一页")}
    >
      <span className="back-arrow" aria-hidden="true">←</span>
    </button>
  </nav>;
}
