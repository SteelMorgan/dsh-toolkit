import test from 'node:test';
import assert from 'node:assert/strict';
import {
  compactResultView,
  genericSummaryLines,
  normalizeOptions,
} from '../lib/compact.js';

function genericView(text) {
  return { card: 'generic', content: [{ type: 'text', text }] };
}

test('smart JSON object summary keeps status, counts and cursor', () => {
  const text = JSON.stringify({
    ok: true,
    items: [{ id: 1 }, { id: 2 }, { id: 3 }],
    next: 'cursor-2',
    error: null,
  });
  const out = compactResultView(genericView(text), { isError: false }, normalizeOptions({ generic: 'smart' }));
  assert.notEqual(out, undefined);
  assert.equal(out.card, 'generic');
  const summary = out.content[0].text;
  assert.match(summary, /ok=true/);
  assert.match(summary, /items=3/);
  assert.match(summary, /next="cursor-2"/);
  assert.match(summary, /chars hidden/);
});

test('smart JSON array summary reports the count', () => {
  const out = compactResultView(
    genericView(JSON.stringify(Array.from({ length: 12 }, (_, i) => ({ id: i })))),
    { isError: false },
    normalizeOptions({ generic: 'smart' }),
  );
  assert.match(out.content[0].text, /12 items/);
});

test('smart falls back to head/tail for non-JSON text', () => {
  const text = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`).join('\n');
  const lines = genericSummaryLines(text, 'smart');
  assert.equal(lines.length, 3);
  assert.equal(lines[0], 'line 1');
  assert.match(lines[1], /18 lines hidden/);
  assert.equal(lines[2], 'line 20');
});

test('headtail mode does not parse JSON', () => {
  const lines = genericSummaryLines('{"ok":true}', 'headtail');
  assert.deepEqual(lines, ['{"ok":true}']);
});

test('generic smart compacts even when terminal trimming is off', () => {
  const options = normalizeOptions({ generic: 'smart' });
  assert.equal(options.trimResults, false);
  const out = compactResultView(
    genericView(JSON.stringify({ ok: true, data: Array.from({ length: 50 }, (_, i) => i) })),
    { isError: false },
    options,
  );
  assert.match(out.content[0].text, /data=50/);
});

test('errors and generic=false are left alone', () => {
  const view = genericView(JSON.stringify({ error: 'boom', stack: 'x'.repeat(1000) }));
  assert.equal(compactResultView(view, { isError: true }, normalizeOptions({ generic: 'smart' })), view);
  assert.equal(compactResultView(view, { isError: false }, normalizeOptions({})), view);
});

test('non-text blocks survive the summary', () => {
  const image = { type: 'image', data: 'x' };
  const out = compactResultView(
    { card: 'generic', content: [{ type: 'text', text: 'a\nb\nc\nd' }, image] },
    { isError: false },
    normalizeOptions({ generic: 'smart' }),
  );
  assert.equal(out.content.length, 2);
  assert.equal(out.content[1], image);
});
