import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clipLine,
  compactCallView,
  compactResultView,
  compactTerminalOutput,
  compactTerminalTitle,
  firstLine,
  hiddenLineCount,
  normalizeOptions,
} from '../lib/compact.js';

test('firstLine and hiddenLineCount handle CRLF and trailing newlines', () => {
  assert.equal(firstLine('a\r\nb'), 'a');
  assert.equal(firstLine('a'), 'a');
  assert.equal(hiddenLineCount('a'), 0);
  assert.equal(hiddenLineCount('a\nb'), 1);
  assert.equal(hiddenLineCount('a\nb\n'), 1);
  assert.equal(hiddenLineCount('a\nb\nc'), 2);
});

test('clipLine keeps short strings and ellipsizes long ones', () => {
  assert.deepEqual(clipLine('short', 10), { text: 'short', clipped: false });
  const clipped = clipLine('abcdefghijkl', 8);
  assert.equal(clipped.clipped, true);
  assert.equal(Array.from(clipped.text).length, 8);
  assert.ok(clipped.text.endsWith('…'));
});

test('compactTerminalTitle folds multi-line commands to one line', () => {
  assert.equal(compactTerminalTitle('echo hi', {}), 'echo hi');
  assert.equal(
    compactTerminalTitle('git status\ngit diff\ngit log', { titleCells: 120 }),
    'git status  … +2 lines',
  );
  assert.equal(compactTerminalTitle('a\nb\n', { titleCells: 120 }), 'a  … +1 lines');
});

test('compactTerminalTitle clips a one-line command', () => {
  const title = 'x'.repeat(200);
  const compact = compactTerminalTitle(title, { titleCells: 40 });
  assert.equal(Array.from(compact).length, 40);
  assert.ok(compact.endsWith('…'));
});

test('compactTerminalOutput keeps the head on success and the tail on failure', () => {
  const output = 'line1\nline2\nline3\nline4';
  assert.equal(
    compactTerminalOutput(output, { bodyLines: 2, failed: false }),
    'line1\nline2\n… +2 lines  ·  Ctrl+O',
  );
  assert.equal(
    compactTerminalOutput(output, { failureLines: 2, failed: true }),
    'line3\nline4\n… +2 lines  ·  Ctrl+O',
  );
  assert.equal(compactTerminalOutput('one line', { bodyLines: 1 }), 'one line');
});

test('compactCallView only rewrites terminal cards', () => {
  const generic = { card: 'generic', title: 'a\nb' };
  assert.equal(compactCallView(generic, normalizeOptions({})), generic);
  const terminal = { card: 'terminal', title: 'a\nb', cwd: '/tmp' };
  assert.equal(compactCallView(terminal, normalizeOptions({ titleCells: 80 })).title, 'a  … +1 lines');
});

test('compactResultView compacts terminal output and respects failures', () => {
  const options = normalizeOptions({ trimResults: true, bodyLines: 1, failureLines: 2 });
  const ok = { card: 'terminal', output: '1\n2\n3' };
  assert.equal(compactResultView(ok, { isError: false }, options).output, '1\n… +2 lines  ·  Ctrl+O');

  const failed = { card: 'terminal', output: '1\n2\n3\n4', exitCode: 1 };
  assert.equal(
    compactResultView(failed, { isError: false }, options).output,
    '3\n4\n… +2 lines  ·  Ctrl+O',
  );

  const read = { card: 'read', lines: [{ number: 1, text: 'x' }] };
  assert.equal(compactResultView(read, { isError: false }, options), read);
});

test('compactResultView is header-only by default', () => {
  const view = { card: 'terminal', output: '1\n2\n3' };
  assert.equal(compactResultView(view, { isError: false }, normalizeOptions({})), view);
});

test('normalizeOptions clamps and falls back safely', () => {
  assert.deepEqual(normalizeOptions({}), {
    enabled: true,
    allTools: false,
    tools: ['bash'],
    trimResults: false,
    bodyLines: 1,
    failureLines: 4,
    titleCells: 100,
    generic: false,
  });
  const odd = normalizeOptions({ enabled: false, tools: 'bash, pwsh,bash', bodyLines: 99, titleCells: 5 });
  assert.equal(odd.enabled, false);
  assert.deepEqual(odd.tools, ['bash', 'pwsh']);
  assert.equal(odd.bodyLines, 8);
  assert.equal(odd.titleCells, 40);
  const all = normalizeOptions({ tools: ['*'], generic: 'smart' });
  assert.equal(all.allTools, true);
  assert.deepEqual(all.tools, ['bash']);
  assert.equal(all.generic, 'smart');
});
