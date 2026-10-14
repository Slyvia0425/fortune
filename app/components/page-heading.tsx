"use client";

import Link from "next/link";
import { useI18n } from "@/lib/i18n";

export default function PageHeading({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string;
  title: string;
  description: string;
}) {
  const { t } = useI18n();
  return (
    <section className="page-hero">
      <div className="page-shell">
        <p className="crumb">
          <Link href="/">{t("首页")}</Link>　/　{t(eyebrow)}
        </p>
        <p className="kicker">{t(eyebrow)}</p>
        <h1 className="page-title">{t(title)}</h1>
        <p>{t(description)}</p>
      </div>
    </section>
  );
}
