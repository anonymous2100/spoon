import { Button } from './Button'
import { useT } from './i18n'
import { LOCALES } from '../../shared/i18n'
import type { LocaleId, Settings } from '../../shared/types'

/**
 * Language picker for the Appearance pane.
 *
 * The choice is stored with the rest of the settings, so it survives a restart and the main
 * process can rebuild the native menu in the new language.
 */
export function LanguagePicker({
  settings,
  onPersist
}: {
  settings: Settings | null
  onPersist: (patch: Partial<Settings>) => Promise<unknown>
}) {
  const t = useT()
  const current = settings?.locale ?? 'en'
  return (
    <>
      <h3>{t('Language')}</h3>
      <div className="language-row">
        {LOCALES.map((locale) => (
          <Button
            key={locale.id}
            type="button"
            className={`language-card ${current === locale.id ? 'on' : ''}`}
            aria-pressed={current === locale.id}
            onClick={() => void onPersist({ locale: locale.id as LocaleId })}
          >
            <strong>{locale.label}</strong>
            <span className="hint">{locale.english}</span>
          </Button>
        ))}
      </div>
      <p className="hint">{t('The menu, options and settings follow this language.')}</p>
    </>
  )
}
