/**
 * Node module hooks for the local dsh-TUI patches.
 *
 * Two opt-in source rewrites happen at module load time:
 *
 * 1. Rendered-row window (always on):
 *      const RENDERED_ROW_CAP = 120  ->  const RENDERED_ROW_CAP = 600
 *    in `lib/types/components/MessageList.js`.
 *
 * 2. Launch-time model/effort override (only when the env vars are set):
 *      DSH_TUI_MODEL_ROUTE=provider/model
 *      DSH_TUI_EFFORT=high
 *    are read before the persisted `~/.dsh-tui/model.json` /
 *    `effort.json` (and, for effort, before the settings user layer).
 *    This is the local prototype of the upstream `DSH_TUI_MODEL_ROUTE`
 *    override proposal; when upstream implements it, the marker guard
 *    (`source.includes('DSH_TUI_MODEL_ROUTE')`) makes these hooks no-ops.
 *
 * Nothing on disk is modified. If dsh-TUI is upgraded, the hooks apply to
 * the new module source; if the relevant markers disappear, the hook is a
 * no-op rather than a failure.
 */

export const MESSAGE_LIST_SUFFIX = '/@deepseek-harness-tui/dsh-tui/lib/types/components/MessageList.js'
export const MODEL_PREFS_SUFFIX = '/@deepseek-harness-tui/dsh-tui/lib/types/modelPrefs.js'
export const EFFORT_PREFS_SUFFIX = '/@deepseek-harness-tui/dsh-tui/lib/types/effortPrefs.js'

export const ROWCAP_FROM = 'const RENDERED_ROW_CAP = 120'
export const ROWCAP_TO = 'const RENDERED_ROW_CAP = 600'

const MODEL_FROM = 'export function readModelPref(dir = PREFS_DIR) {\n    try {'
const MODEL_TO = [
  'export function readModelPref(dir = PREFS_DIR) {',
  '    const __dshRoute = process.env.DSH_TUI_MODEL_ROUTE?.trim();',
  '    if (__dshRoute) {',
  "        const __dshSlash = __dshRoute.indexOf('/');",
  "        const __dshProvider = __dshSlash > 0 ? __dshRoute.slice(0, __dshSlash).trim() : '';",
  "        const __dshModel = __dshSlash > 0 ? __dshRoute.slice(__dshSlash + 1).trim() : '';",
  '        if (__dshProvider && __dshModel) {',
  '            return { provider: __dshProvider, model: __dshModel };',
  '        }',
  '    }',
  '    try {',
].join('\n')

const EFFORT_FROM = 'return settingsDefault ?? persisted ?? configured;'
const EFFORT_TO = [
  'const __dshEffort = process.env.DSH_TUI_EFFORT?.trim();',
  '    if (__dshEffort) return __dshEffort;',
  '    return settingsDefault ?? persisted ?? configured;',
].join('\n')

/** Pure, testable rewrite of the rendered-row cap. */
export function patchMessageListSource(source) {
  if (typeof source !== 'string' || !source.includes(ROWCAP_FROM)) return source
  return source.replace(ROWCAP_FROM, ROWCAP_TO)
}

/** Pure, testable rewrite of `readModelPref`: env route wins over the file. */
export function patchModelPrefsSource(source) {
  if (typeof source !== 'string') return source
  if (source.includes('DSH_TUI_MODEL_ROUTE')) return source
  return source.replace(MODEL_FROM, MODEL_TO)
}

/** Pure, testable rewrite of `resolveEffortDefault`: env effort wins. */
export function patchEffortPrefsSource(source) {
  if (typeof source !== 'string') return source
  if (source.includes('DSH_TUI_EFFORT')) return source
  return source.replace(EFFORT_FROM, EFFORT_TO)
}

function sourceOf(result) {
  if (typeof result.source === 'string') return result.source
  return result.source == null ? '' : Buffer.from(result.source).toString('utf8')
}

export async function load(url, context, nextLoad) {
  const result = await nextLoad(url, context)
  const source = sourceOf(result)
  let patched
  if (url.includes(MESSAGE_LIST_SUFFIX)) {
    patched = patchMessageListSource(source)
  } else if (url.includes(MODEL_PREFS_SUFFIX)) {
    patched = patchModelPrefsSource(source)
  } else if (url.includes(EFFORT_PREFS_SUFFIX)) {
    patched = patchEffortPrefsSource(source)
  } else {
    return result
  }
  if (patched === source) return result
  if (process.env.DSH_ROWCAP_DEBUG === '1') {
    process.stderr.write(`[dsh-local-patch] patched ${url}\n`)
  }
  return { ...result, source: patched }
}
