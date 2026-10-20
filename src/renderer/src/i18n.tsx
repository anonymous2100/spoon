import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { translatorFor } from '../../shared/locales'
import { DEFAULT_LOCALE } from '../../shared/i18n'
import type { LocaleId, TranslateFn } from '../../shared/i18n'

/**
 * Renderer-side i18n.
 *
 * The provider owns the active locale. `useT()` returns a translator bound to it, and reading it
 * from context makes every consumer re-render when the language changes.
 *
 * The active translator is also kept in a module-level variable so plain helper functions (which
 * cannot use hooks) can translate without threading a translator through every call site.
 */

let activeTranslator: TranslateFn = translatorFor(DEFAULT_LOCALE)

/** The translator currently in use. Safe to call from non-React code. */
export function currentTranslator(): TranslateFn {
  return activeTranslator
}

/** Translate using the active locale. */
export function t(key: string, options?: Parameters<TranslateFn>[1]): string {
  return activeTranslator(key, options)
}

interface I18nValue {
  locale: LocaleId
  t: TranslateFn
}

const I18nContext = createContext<I18nValue>({
  locale: DEFAULT_LOCALE,
  t: (key, options) => activeTranslator(key, options)
})

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocale] = useState<LocaleId>(DEFAULT_LOCALE)

  useEffect(() => {
    // The main process owns the saved language and pushes a change whenever it moves.
    let alive = true
    void window.spoon.app.locale().then((value) => {
      if (alive) setLocale(value as LocaleId)
    })
    const off = window.spoon.app.on('locale', (value) => setLocale(value as LocaleId))
    return () => {
      alive = false
      off()
    }
  }, [])

  const value = useMemo<I18nValue>(() => {
    const translator = translatorFor(locale)
    // Keep the module-level translator in step for helpers that cannot use hooks.
    activeTranslator = translator
    return { locale, t: translator }
  }, [locale])

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

/** Translator for the active locale. Re-renders the caller when the language changes. */
export function useT(): TranslateFn {
  return useContext(I18nContext).t
}

/** Active locale. Re-renders the caller when the language changes. */
export function useLocale(): LocaleId {
  return useContext(I18nContext).locale
}
