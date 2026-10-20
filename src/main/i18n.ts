import { translatorFor } from '../shared/locales'
import type { LocaleId, TranslateFn } from '../shared/i18n'

/**
 * Main-process translator.
 *
 * The main process has no React context, so it keeps its own module-level translator. The active
 * locale is pushed in from `index.ts` whenever the settings change (including at startup).
 */

let active: TranslateFn = translatorFor('en')

/** Switch the main process to a different locale. */
export function setActiveLocale(locale: LocaleId): void {
  active = translatorFor(locale)
}

/** Translate using the main process's active locale. */
export function mt(key: string, options?: Parameters<TranslateFn>[1]): string {
  return active(key, options)
}
