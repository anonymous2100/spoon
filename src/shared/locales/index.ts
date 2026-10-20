import { createTranslator, DEFAULT_LOCALE } from '../i18n'
import type { Catalog, LocaleId, TranslateFn } from '../i18n'
import { en } from './en'
import { zhCN } from './zh-CN'

export { LOCALES, DEFAULT_LOCALE, createTranslator, interpolate, sanitizeLocale, isLocaleId } from '../i18n'
export type { Catalog, LocaleId, TranslateFn, TranslateValues, TranslateOptions } from '../i18n'

/**
 * Every locale Spoon ships with.
 *
 * A locale is a flat `{ englishText: translation }` map. Static UI text uses the English text
 * itself as the key, so a missing entry falls back to English instead of showing a raw key.
 */
export const CATALOGS: Record<LocaleId, Catalog> = {
  en,
  'zh-CN': zhCN
}

/** Translator for a locale, with English as the fallback for every missing key. */
export function translatorFor(locale: LocaleId): TranslateFn {
  return createTranslator(locale, CATALOGS)
}
