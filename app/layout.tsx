import type { Metadata } from "next";
import type { ReactNode } from "react";
import { LocaleProvider } from "@/lib/i18n";
import { htmlLang } from "@/lib/i18n/locale";
import { siteLocale } from "@/lib/i18n/server";
import { translate } from "@/lib/i18n/translate";
import SiteFooter from "./components/site-footer";
import SiteHeader from "./components/site-header";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await siteLocale();
  return {
    title: {
      default: translate(locale, "知命 · 东方术数知识系统"),
      template: translate(locale, "%s · 知命"),
    },
    description: translate(locale, "可追溯、可解释的传统术数知识服务平台。"),
  };
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  const locale = await siteLocale();
  return (
    <html lang={htmlLang(locale)}>
      <body>
        <LocaleProvider initialLocale={locale}>
          <SiteHeader />
          {children}
          <SiteFooter />
        </LocaleProvider>
      </body>
    </html>
  );
}
