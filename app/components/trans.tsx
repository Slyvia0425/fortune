"use client";

import { useI18n } from "@/lib/i18n";

/**
 * Translate a string that a server component already knows.
 *
 * Pages keep their metadata and data loading on the server, and hand the copy
 * they render to this small client boundary.
 */
export default function Trans({ zh, en }: { zh: string; en?: string }) {
  const { t } = useI18n();
  return <>{t(zh, undefined, en)}</>;
}
