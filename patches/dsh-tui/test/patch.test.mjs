import test from 'node:test'
import assert from 'node:assert/strict'
import {
  load,
  patchEffortPrefsSource,
  patchMessageListSource,
  patchModelPrefsSource,
} from '../hooks.mjs'

test('patches the rendered-row cap only', () => {
  const source = 'const RENDERED_ROW_CAP = 120\nexport const X = 1\n'
  assert.equal(patchMessageListSource(source), 'const RENDERED_ROW_CAP = 600\nexport const X = 1\n')
  assert.equal(patchMessageListSource('const OTHER = 120\n'), 'const OTHER = 120\n')
  assert.equal(patchMessageListSource('const RENDERED_ROW_CAP = 600\n'), 'const RENDERED_ROW_CAP = 600\n')
})

test('patches readModelPref to prefer DSH_TUI_MODEL_ROUTE', () => {
  const source = 'export function readModelPref(dir = PREFS_DIR) {\n    try {\n        return undefined;\n    }\n    catch {\n        return undefined;\n    }\n}\n'
  const patched = patchModelPrefsSource(source)
  assert.match(patched, /DSH_TUI_MODEL_ROUTE/)
  assert.match(patched, /__dshSlash/)
  assert.match(patched, /provider: __dshProvider/)
  // An upstream implementation already mentioning the env var is left alone.
  assert.equal(patchModelPrefsSource('const x = process.env.DSH_TUI_MODEL_ROUTE\n'), 'const x = process.env.DSH_TUI_MODEL_ROUTE\n')
  // A different source shape is a no-op, not a broken module.
  assert.equal(patchModelPrefsSource('export const x = 1\n'), 'export const x = 1\n')
})

test('patches resolveEffortDefault to prefer DSH_TUI_EFFORT', () => {
  const source = 'export function resolveEffortDefault(settingsDefault, configured, persisted) {\n    return settingsDefault ?? persisted ?? configured;\n}\n'
  const patched = patchEffortPrefsSource(source)
  assert.match(patched, /DSH_TUI_EFFORT/)
  assert.match(patched, /if \(__dshEffort\) return __dshEffort;/)
  assert.equal(patchEffortPrefsSource('const x = process.env.DSH_TUI_EFFORT\n'), 'const x = process.env.DSH_TUI_EFFORT\n')
  assert.equal(patchEffortPrefsSource('export const x = 1\n'), 'export const x = 1\n')
})

test('load hook rewrites the dsh-TUI MessageList module', async () => {
  const url = 'file:///home/u/.dsh/profiles/tui/node_modules/@deepseek-harness-tui/dsh-tui/lib/types/components/MessageList.js'
  const nextLoad = async () => ({ format: 'module', source: 'const RENDERED_ROW_CAP = 120\n' })
  const result = await load(url, {}, nextLoad)
  assert.equal(result.source, 'const RENDERED_ROW_CAP = 600\n')
})

test('load hook rewrites modelPrefs and effortPrefs', async () => {
  const modelUrl = 'file:///home/u/.dsh/profiles/tui/node_modules/@deepseek-harness-tui/dsh-tui/lib/types/modelPrefs.js'
  const model = await load(modelUrl, {}, async () => ({
    format: 'module',
    source: 'export function readModelPref(dir = PREFS_DIR) {\n    try {\n        return undefined;\n    }\n}\n',
  }))
  assert.match(model.source, /DSH_TUI_MODEL_ROUTE/)

  const effortUrl = 'file:///home/u/.dsh/profiles/tui/node_modules/@deepseek-harness-tui/dsh-tui/lib/types/effortPrefs.js'
  const effort = await load(effortUrl, {}, async () => ({
    format: 'module',
    source: 'export function resolveEffortDefault(settingsDefault, configured, persisted) {\n    return settingsDefault ?? persisted ?? configured;\n}\n',
  }))
  assert.match(effort.source, /DSH_TUI_EFFORT/)
})

test('load hook leaves other modules alone', async () => {
  const url = 'file:///tmp/some/other.js'
  const nextLoad = async () => ({ format: 'module', source: 'const RENDERED_ROW_CAP = 120\n' })
  const result = await load(url, {}, nextLoad)
  assert.equal(result.source, 'const RENDERED_ROW_CAP = 120\n')
})
