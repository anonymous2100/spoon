// Smoke test: load the shipped catalogs through the real translator and print a sample.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { translatorFor, CATALOGS } from '../../src/shared/locales/index.ts'

test('zh-CN pack translates menus, options and settings', () => {
  const t = translatorFor('zh-CN')
  const samples = [
    ['File', '文件'],
    ['Preferences…', '首选项…'],
    ['Clone Repository…', '克隆仓库…'],
    ['Settings', '设置'],
    ['Language', '语言'],
    ['Appearance', '外观'],
    ['History layout', '历史布局'],
    ['Stage', '暂存'],
    ['Discard', '丢弃'],
    ['Check for updates', '检查更新'],
    ['Start using Spoon', '开始使用 Spoon'],
    ['No commits to show', '无可显示的提交']
  ]
  for (const [en, zh] of samples) {
    assert.equal(t(en), zh, `${en} should translate to ${zh}`)
  }
  assert.equal(t('x.filesCount', { count: 3 }), '3 个文件')
  assert.equal(t('x.deleteBranchPrompt', { values: { name: 'dev' } }), '要删除分支 dev 吗？')
  assert.ok(Object.keys(CATALOGS['zh-CN']).length > 800, 'the pack covers the whole UI')
})

test('en locale still renders the original English', () => {
  const t = translatorFor('en')
  assert.equal(t('File'), 'File')
  assert.equal(t('x.filesCount', { count: 3 }), '3 files')
})
