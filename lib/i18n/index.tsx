"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import {
  DEFAULT_LOCALE,
  LOCALE_COOKIE,
  htmlLang,
  isLocale,
  type Locale,
} from "./locale";
import { translate, type Translate } from "./translate";

interface LocaleValue {
  locale: Locale;
  setLocale: (next: Locale) => void;
}

const LocaleContext = createContext<LocaleValue>({
  locale: DEFAULT_LOCALE,
  setLocale: () => {},
});

export function LocaleProvider({
  initialLocale,
  children,
}: {
  initialLocale: Locale;
  children: ReactNode;
}) {
  const [locale, setLocaleState] = useState<Locale>(initialLocale);

  const setLocale = useCallback((next: Locale) => {
    if (!isLocale(next)) return;
    setLocaleState(next);
    // Remember the choice for the next visit. A cookie carries it to the
    // server so the first paint is already in the chosen language, and the
    // local copy keeps other tabs in step without a round trip.
    document.cookie = `${LOCALE_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
    try {
      window.localStorage.setItem(LOCALE_COOKIE, next);
    } catch {
      // Private mode can refuse storage; the cookie above is enough.
    }
    document.documentElement.lang = htmlLang(next);
  }, []);

  const value = useMemo(() => ({ locale, setLocale }), [locale, setLocale]);
  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale(): LocaleValue {
  return useContext(LocaleContext);
}

export function useI18n(): LocaleValue & { t: Translate } {
  const { locale, setLocale } = useLocale();
  const t = useCallback<Translate>(
    (zh, params, en) => translate(locale, zh, params, en),
    [locale],
  );
  return { locale, setLocale, t };
}

export { LOCALE_COOKIE, DEFAULT_LOCALE, htmlLang, isLocale, translate };
export type { Locale, Translate };
