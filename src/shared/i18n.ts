/**
 * Minimal, dependency-free i18n for Spoon.
 *
 * Design
 * ------
 * * A catalog is plain data: `{ [key]: 'text' }`.
 * * Static UI text uses the **English text itself as the key**. A missing translation therefore
 *   degrades gracefully to English instead of showing a raw key, and the language pack reads as a
 *   clean `English → 中文` list that is easy to review and diff.
 * * Dynamic text (with `{count}` style placeholders or plural forms) uses an explicit
 *   `x.`-namespaced key plus a plural suffix (`.one` / `.other`).
 * * English is the reference locale and the fallback for every other locale, so a partially
 *   translated language pack still renders every screen.
 */

export type LocaleId = 'en' | 'zh-CN'

export interface LocaleDef {
  id: LocaleId
  /** Name written in the language itself — shown in the language picker. */
  label: string
  /** English name, used as a secondary hint next to the native label. */
  english: string
}

export const LOCALES: LocaleDef[] = [
  { id: 'en', label: 'English', english: 'English' },
  { id: 'zh-CN', label: '简体中文', english: 'Chinese (Simplified)' }
]

export const DEFAULT_LOCALE: LocaleId = 'en'

export type Catalog = Record<string, string>

export function isLocaleId(value: unknown): value is LocaleId {
  return value === 'en' || value === 'zh-CN'
}

export function sanitizeLocale(value: unknown): LocaleId {
  return isLocaleId(value) ? value : DEFAULT_LOCALE
}

/** Values accepted by `{name}` placeholders. */
export type TranslateValues = Record<string, string | number>

export interface TranslateOptions {
  /** `{name}` placeholder values. */
  values?: TranslateValues
  /**
   * Count for plural-aware messages. The translator picks the `.one` / `.other` variant.
   * English distinguishes one from many; Chinese uses a single form for every count.
   */
  count?: number
}

export type TranslateFn = (key: string, options?: TranslateOptions | TranslateValues) => string

/** Candidate catalog keys for a lookup, most specific first. */
function candidateKeys(locale: LocaleId, key: string, count?: number): string[] {
  if (count === undefined) return [key]
  const one = `${key}.one`
  const other = `${key}.other`
  // English distinguishes singular from plural; Chinese uses one form for all counts.
  if (locale === 'zh-CN') return [other, one, key]
  return count === 1 ? [one, other, key] : [other, one, key]
}

function lookup(catalog: Catalog | undefined, keys: string[]): string | undefined {
  if (!catalog) return undefined
  for (const key of keys) {
    const value = catalog[key]
    if (typeof value === 'string' && value.length) return value
  }
  return undefined
}

/**
 * Substitute `{name}` placeholders. Unknown placeholders are left untouched, so a missing value
 * is easier to spot than a silently blank label.
 */
export function interpolate(template: string, values?: TranslateValues): string {
  if (!values) return template
  return template.replace(/\{(\w+)\}/g, (match, key: string) => {
    const value = values[key]
    return value === undefined ? match : String(value)
  })
}

/** Normalize the two accepted call shapes: `t(key, {values, count})` and `t(key, {count})`. */
function normalize(options?: TranslateOptions | TranslateValues): TranslateOptions {
  if (!options) return {}
  if ('values' in options || 'count' in options) return options as TranslateOptions
  return { values: options as TranslateValues }
}

/**
 * Build a translator bound to one locale. The English catalog is always the fallback, so a
 * partially translated locale still renders every screen.
 */
export function createTranslator(locale: LocaleId, catalogs: Record<LocaleId, Catalog>): TranslateFn {
  const primary = catalogs[locale] ?? {}
  const fallback = catalogs[DEFAULT_LOCALE] ?? {}
  return (key, options) => {
    const { values, count } = normalize(options)
    const candidates = candidateKeys(locale, key, count)
    const template = lookup(primary, candidates) ?? lookup(fallback, candidates) ?? key
    // `{count}` is filled in automatically, so a plural message only needs its other values.
    const merged = count === undefined ? values : { count, ...values }
    return interpolate(template, merged)
  }
}
