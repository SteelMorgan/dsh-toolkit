/**
 * Pure presentation compaction for dsh-TUI tool cards.
 *
 * dsh-TUI renders a tool card as: a header (tool name + call title) and a body
 * capped to TEXT_BODY_MAX_LINES. The expensive part in orchestrator sessions is
 * the *header*: a Bash call whose command is a 5-line shell script produces a
 * 5-line header, and the 3-line body adds more. Codex/Claude-style UIs show one
 * line for the call and one or two for the output.
 *
 * This module only rewrites `ToolCallView` / `ToolResultView` values. It never
 * touches the model-facing content: expanding a card (Ctrl+O / click) still
 * reads the raw full result from the transcript.
 */

const ELLIPSIS = '…';

/** First physical line of `text` (CRLF-safe), without the trailing CR. */
export function firstLine(text) {
  const at = text.indexOf('\n');
  const line = at === -1 ? text : text.slice(0, at);
  return line.endsWith('\r') ? line.slice(0, -1) : line;
}

/** Number of line breaks whose lines would be hidden by folding to one line. */
export function hiddenLineCount(text) {
  if (!text.includes('\n')) return 0;
  let breaks = 0;
  for (let at = text.indexOf('\n'); at !== -1; at = text.indexOf('\n', at + 1)) breaks += 1;
  // A trailing newline terminates the last visible line, it does not add one.
  return text.endsWith('\n') ? Math.max(0, breaks - 1) : breaks;
}

/** Clip a single-line string to a cell budget, appending an ellipsis. */
export function clipLine(text, cells) {
  const chars = Array.from(text);
  if (chars.length <= cells) return { text, clipped: false };
  const keep = Math.max(0, cells - 1);
  return { text: `${chars.slice(0, keep).join('')}${ELLIPSIS}`, clipped: true };
}

/**
 * Compact a terminal call header: first source line, clipped, with a
 * `+N lines` marker when the command had more lines.
 *
 * @param {string} title
 * @param {{ titleCells?: number }} [options]
 */
export function compactTerminalTitle(title, options = {}) {
  if (typeof title !== 'string' || title === '') return title;
  const cells = Number.isFinite(options.titleCells) ? Math.max(20, options.titleCells) : 100;
  const hidden = hiddenLineCount(title);
  const { text } = clipLine(firstLine(title).trimEnd(), cells);
  if (hidden === 0) return text;
  return `${text}  ${ELLIPSIS} +${hidden} lines`;
}

/**
 * Compact captured terminal output for the collapsed card.
 *
 * Success keeps the first lines; a failure keeps the tail (where the error
 * usually is) so the collapsed card still tells the reader what broke.
 *
 * @param {string} output
 * @param {{ bodyLines?: number, failureLines?: number, failed?: boolean }} [options]
 */
export function compactTerminalOutput(output, options = {}) {
  if (typeof output !== 'string' || output === '') return output;
  const normalized = output.replace(/\r\n/g, '\n').replace(/\n+$/, '');
  const lines = normalized.split('\n');
  const failed = options.failed === true;
  const limit = failed
    ? Math.max(1, options.failureLines ?? 4)
    : Math.max(1, options.bodyLines ?? 1);
  if (lines.length <= limit) return normalized;
  const hidden = lines.length - limit;
  const marker = `${ELLIPSIS} +${hidden} lines  ·  Ctrl+O`;
  const kept = failed ? lines.slice(-limit) : lines.slice(0, limit);
  // The collapsed card itself caps at 3 rows and takes the head. Put the
  // marker last for failures so the cap keeps the error tail, not the marker.
  return `${kept.join('\n')}\n${marker}`;
}

const JSON_PARSE_LIMIT = 512 * 1024;
const GENERIC_LINE_CELLS = 220;

function formatCount(n) {
  if (!Number.isFinite(n) || n < 0) return String(n);
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

function clipCells(text, cells = GENERIC_LINE_CELLS) {
  return clipLine(String(text), cells).text;
}

/** One-cell JSON value for summaries. Depth is intentionally shallow: the
 *  point is a compact shape, not a faithful rendering. */
function summarizeValue(value) {
  if (value === null) return 'null';
  if (typeof value === 'string') {
    const flat = value.replace(/\s+/gu, ' ').trim();
    return clipCells(JSON.stringify(flat), 64);
  }
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return `[${value.length}]`;
  if (typeof value === 'object') return `{${Object.keys(value).length} keys}`;
  return String(value);
}

const SUMMARY_KEYS = [
  'ok', 'success', 'error', 'errors', 'status', 'code', 'message',
  'next', 'nextCursor', 'next_cursor', 'cursor', 'has_more', 'hasMore',
  'total', 'count', 'totalCount',
];
const COUNT_KEYS = ['items', 'data', 'results', 'rows', 'content', 'edges', 'nodes', 'list'];

function jsonSummary(value) {
  if (Array.isArray(value)) {
    const first = value.length > 0 ? ` · first: ${summarizeValue(value[0])}` : '';
    return `${value.length} items${first}`;
  }
  if (value === null || typeof value !== 'object') return clipCells(summarizeValue(value));
  const parts = [];
  for (const key of SUMMARY_KEYS) {
    if (Object.hasOwn(value, key) && value[key] !== undefined) {
      parts.push(`${key}=${summarizeValue(value[key])}`);
    }
    if (parts.length >= 5) break;
  }
  for (const key of COUNT_KEYS) {
    if (Array.isArray(value[key])) parts.push(`${key}=${value[key].length}`);
    if (parts.length >= 7) break;
  }
  if (parts.length === 0) {
    for (const key of Object.keys(value).slice(0, 6)) {
      parts.push(`${key}=${summarizeValue(value[key])}`);
    }
  }
  return clipCells(parts.join(' · ') || '{}');
}

function jsonTail(value) {
  if (Array.isArray(value)) {
    return value.length > 0 ? `last: ${summarizeValue(value[value.length - 1])}` : '';
  }
  if (value === null || typeof value !== 'object') return '';
  for (const key of ['error', 'next', 'nextCursor', 'next_cursor', 'message']) {
    if (Object.hasOwn(value, key) && value[key] !== undefined) {
      return `${key}=${summarizeValue(value[key])}`;
    }
  }
  for (const key of COUNT_KEYS) {
    const list = value[key];
    if (Array.isArray(list) && list.length > 0) {
      return `last ${key}: ${summarizeValue(list[list.length - 1])}`;
    }
  }
  return '';
}

/** Produce at most three visible lines for one generic text payload. */
export function genericSummaryLines(text, mode = 'smart') {
  const normalized = String(text).replace(/\r\n/g, '\n').trim();
  if (normalized === '') return [];
  if (mode === 'smart' && normalized.length <= JSON_PARSE_LIMIT) {
    const first = normalized[0];
    if (first === '{' || first === '[') {
      try {
        const value = JSON.parse(normalized);
        if (value !== null && typeof value === 'object') {
          const summary = jsonSummary(value);
          const tail = jsonTail(value);
          const marker = `… ${formatCount(normalized.length)} chars hidden`;
          const lines = [summary, marker, tail].filter(line => line !== '');
          if (lines.join('').length < normalized.length) return lines.slice(0, 3);
        }
      } catch {
        // Not JSON after all: fall through to the head/tail form.
      }
    }
  }
  const lines = normalized.split('\n').map(line => line.trimEnd()).filter(line => line !== '');
  if (lines.length <= 3) return lines;
  const hidden = lines.length - 2;
  return [
    clipCells(lines[0]),
    `… ${formatCount(hidden)} lines hidden`,
    clipCells(lines[lines.length - 1]),
  ];
}

/** Replace text blocks in a GenericResultView with the compact summary.
 *  Non-text blocks (images, etc.) are kept untouched. */
export function compactGenericContent(content, options) {
  if (!Array.isArray(content)) return content;
  const textBlocks = content.filter(block => block !== null && typeof block === 'object' && block.type === 'text' && typeof block.text === 'string');
  if (textBlocks.length === 0) return content;
  const text = textBlocks.map(block => block.text).join('\n');
  const lines = genericSummaryLines(text, options.generic === 'smart' ? 'smart' : 'headtail');
  if (lines.length === 0) return content;
  const replacement = { type: 'text', text: lines.join('\n') };
  const nonText = content.filter(block => !textBlocks.includes(block));
  return [replacement, ...nonText];
}

/**
 * Rewrite a `ToolCallView` without changing its card kind.
 *
 * @param {unknown} view
 * @param {ReturnType<typeof normalizeOptions>} options
 */
export function compactCallView(view, options) {
  if (view === null || typeof view !== 'object' || view.card !== 'terminal') return view;
  const title = compactTerminalTitle(view.title, options);
  if (title === view.title) return view;
  return { ...view, title };
}

/**
 * Rewrite a `ToolResultView` — OPT-IN ONLY.
 *
 * Header-only mode (the default) returns the view untouched: the TUI renders
 * the collapsed and the expanded card from the same `resultView`, so trimming
 * the body would also trim what Ctrl+O shows. The full result stays in the
 * model context and the session log either way.
 *
 * With `trimResults: true`, the body is shortened for maximum visual density
 * and the card's Ctrl+O view is shortened too.
 *
 * @param {unknown} view
 * @param {unknown} result `{ isError?: boolean }` from the tool presenter
 * @param {ReturnType<typeof normalizeOptions>} options
 */
export function compactResultView(view, result, options) {
  if (view === null || typeof view !== 'object') return view;
  const isError = result !== null && typeof result === 'object' && result.isError === true;

  if (view.card === 'generic') {
    if (isError || options.generic === false || !Array.isArray(view.content)) return view;
    const content = compactGenericContent(view.content, options);
    return content === view.content ? view : { ...view, content };
  }

  if (options.trimResults !== true) return view;

  if (view.card === 'terminal') {
    const failed = isError || (typeof view.exitCode === 'number' && view.exitCode !== 0);
    if (typeof view.output !== 'string' || view.output === '') return view;
    const output = compactTerminalOutput(view.output, {
      bodyLines: options.bodyLines,
      failureLines: options.failureLines,
      failed,
    });
    if (output === view.output) return view;
    return { ...view, output };
  }
  return view;
}

function intInRange(value, min, max, fallback) {
  const n = Number.isInteger(value) ? value : Number.parseInt(String(value ?? ''), 10);
  if (!Number.isInteger(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/**
 * Normalize the plugin row's config. Unknown keys are ignored; an empty or
 * malformed config resolves to safe defaults.
 *
 * @param {Record<string, unknown>} config
 */
export function normalizeOptions(config = {}) {
  const rawTools = Array.isArray(config.tools)
    ? config.tools
    : typeof config.tools === 'string'
      ? config.tools.split(',')
      : ['bash'];
  const tools = [...new Set(rawTools
    .filter(tool => typeof tool === 'string')
    .map(tool => tool.trim())
    .filter(tool => tool !== ''))];
  const allTools = config.allTools === true || tools.includes('*');
  const namedTools = tools.filter(tool => tool !== '*');
  return {
    enabled: config.enabled !== false,
    allTools,
    tools: namedTools.length > 0 ? namedTools : ['bash'],
    // Header-only is the default: keep the result view (and therefore Ctrl+O)
    // lossless. Trimming is an explicit opt-in.
    trimResults: config.trimResults === true,
    bodyLines: intInRange(config.bodyLines, 1, 8, 1),
    failureLines: intInRange(config.failureLines, 1, 12, 4),
    titleCells: intInRange(config.titleCells, 40, 300, 100),
    // false | 'headtail' | 'smart' (true is the legacy alias of 'headtail').
    generic: config.generic === 'smart' || config.generic === 'headtail'
      ? config.generic
      : config.generic === true ? 'headtail' : false,
  };
}
