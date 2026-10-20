// The translation core: fallback behaviour, interpolation, plurals and the shipped language pack.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  createTranslator,
  DEFAULT_LOCALE,
  interpolate,
  isLocaleId,
  LOCALES,
  sanitizeLocale
} from '../../src/shared/i18n.ts'
import { CATALOGS, translatorFor } from '../../src/shared/locales/index.ts'

test('i18n: locale ids are validated and sanitised', () => {
  assert.equal(isLocaleId('zh-CN'), true)
  assert.equal(isLocaleId('en'), true)
  assert.equal(isLocaleId('fr'), false)
  assert.equal(isLocaleId(null), false)
  assert.equal(sanitizeLocale('zh-CN'), 'zh-CN')
  assert.equal(sanitizeLocale('fr'), DEFAULT_LOCALE)
  assert.equal(sanitizeLocale(undefined), DEFAULT_LOCALE)
  assert.equal(sanitizeLocale(42), DEFAULT_LOCALE)
})

test('i18n: the shipped locales are listed with a native and an English name', () => {
  assert.ok(LOCALES.length >= 2)
  const zh = LOCALES.find((l) => l.id === 'zh-CN')
  assert.equal(zh?.label, '简体中文')
  assert.ok(zh?.english)
})

test('i18n: a missing translation falls back to English instead of the raw key', () => {
  const t = createTranslator('zh-CN', { en: { Hello: 'Hello' }, 'zh-CN': {} })
  assert.equal(t('Hello'), 'Hello')
})

test('i18n: a translated string uses the target locale', () => {
  const t = createTranslator('zh-CN', { en: { Hello: 'Hello' }, 'zh-CN': { Hello: '你好' } })
  assert.equal(t('Hello'), '你好')
})

test('i18n: an unknown key is returned as-is so it is easy to spot', () => {
  const t = createTranslator('en', { en: {}, 'zh-CN': {} })
  assert.equal(t('Totally unknown string'), 'Totally unknown string')
})

test('i18n: placeholders are substituted and unknown placeholders are left alone', () => {
  assert.equal(interpolate('Hello {name}', { name: 'Ada' }), 'Hello Ada')
  assert.equal(interpolate('Hello {name}'), 'Hello {name}')
  assert.equal(interpolate('Hello {name}', { other: 1 }), 'Hello {name}')
  const t = createTranslator('en', { en: { 'Hi {name}': 'Hi {name}' }, 'zh-CN': {} })
  assert.equal(t('Hi {name}', { values: { name: 'Bo' } }), 'Hi Bo')
})

test('i18n: values may be passed directly as the second argument', () => {
  const t = createTranslator('en', { en: { 'Hi {name}': 'Hi {name}' }, 'zh-CN': {} })
  assert.equal(t('Hi {name}', { name: 'Bo' }), 'Hi Bo')
})

test('i18n: English plurals pick .one and .other by count', () => {
  const en = { 'x.item.one': '{count} item', 'x.item.other': '{count} items' }
  const t = createTranslator('en', { en, 'zh-CN': {} })
  assert.equal(t('x.item', { count: 1 }), '1 item')
  assert.equal(t('x.item', { count: 3 }), '3 items')
  assert.equal(t('x.item', { count: 0 }), '0 items')
})

test('i18n: Chinese uses one form for every count', () => {
  const zh = { 'x.item.one': '{count} 个项目', 'x.item.other': '{count} 个项目' }
  const t = createTranslator('zh-CN', { en: {}, 'zh-CN': zh })
  assert.equal(t('x.item', { count: 1 }), '1 个项目')
  assert.equal(t('x.item', { count: 3 }), '3 个项目')
})

test('i18n: a plural key falls back to the singular form when only one is defined', () => {
  const t = createTranslator('en', { en: { 'x.item.one': '{count} item' }, 'zh-CN': {} })
  assert.equal(t('x.item', { count: 4 }), '4 item')
})

test('i18n: the zh-CN pack is a superset of the English dynamic keys', () => {
  const missing = Object.keys(CATALOGS.en).filter((key) => !(key in CATALOGS['zh-CN']))
  assert.deepEqual(missing, [], `zh-CN is missing: ${missing.join(', ')}`)
})

test('i18n: every shipped translation is a non-empty string', () => {
  for (const [id, catalog] of Object.entries(CATALOGS)) {
    for (const [key, value] of Object.entries(catalog)) {
      assert.equal(typeof value, 'string', `${id}/${key} must be a string`)
      assert.ok(value.trim().length > 0, `${id}/${key} must not be empty`)
    }
  }
})

test('i18n: placeholders in the zh-CN pack match the English ones', () => {
  const placeholders = (text: string) => (text.match(/\{(\w+)\}/g) ?? []).sort()
  for (const [key, en] of Object.entries(CATALOGS.en)) {
    const zh = CATALOGS['zh-CN'][key]
    if (!zh) continue
    assert.deepEqual(
      placeholders(zh),
      placeholders(en),
      `placeholders differ for ${key}: ${en} vs ${zh}`
    )
  }
})

test('i18n: translatorFor returns a working translator for every locale', () => {
  for (const locale of LOCALES) {
    const t = translatorFor(locale.id)
    assert.equal(typeof t('File'), 'string')
    assert.ok(t('File').length > 0)
  }
})
