import test from 'node:test';
import assert from 'node:assert/strict';
import { apply } from '../lib/index.js';

function makeHarness(definitions) {
  const listeners = new Map();
  const effects = [];
  const tools = {
    get(name) {
      return definitions[name];
    },
  };
  const ctx = {
    tools,
    inject(services, callback) {
      assert.deepEqual(services, ['tools']);
      callback(ctx);
    },
    effect(factory) {
      const disposer = factory();
      if (typeof disposer === 'function') effects.push(disposer);
      return () => {};
    },
    on(event, listener) {
      const list = listeners.get(event) ?? [];
      list.push(listener);
      listeners.set(event, list);
      return () => {
        const index = list.indexOf(listener);
        if (index !== -1) list.splice(index, 1);
      };
    },
    logger: { debug() {}, warn() {} },
  };
  return {
    ctx,
    tools,
    emit(event) {
      for (const listener of listeners.get(event) ?? []) listener();
    },
    dispose() {
      for (const disposer of effects.reverse()) disposer?.();
    },
  };
}

function bashDefinition() {
  return {
    name: 'bash',
    presentCall(args) {
      return { card: 'terminal', title: args.command, cwd: args.cwd };
    },
    presentResult(args, result) {
      return { card: 'terminal', output: result.content[0].text, exitCode: 0 };
    },
  };
}

test('apply compacts headers and leaves the result view untouched by default', () => {
  const definition = bashDefinition();
  const harness = makeHarness({ bash: definition });
  apply(harness.ctx, { tools: ['bash'], titleCells: 80 });

  const call = definition.presentCall({ command: 'git status\ngit diff', cwd: '/work' });
  assert.equal(call.title, 'git status  … +1 lines');
  assert.equal(call.cwd, '/work');

  const result = definition.presentResult({}, { isError: false, content: [{ type: 'text', text: '1\n2\n3' }] });
  assert.equal(result.output, '1\n2\n3');

  harness.dispose();
  assert.equal(definition.presentCall({ command: 'git status\ngit diff' }).title, 'git status\ngit diff');
});

test('apply trims result bodies only with trimResults: true', () => {
  const definition = bashDefinition();
  const harness = makeHarness({ bash: definition });
  apply(harness.ctx, { tools: ['bash'], trimResults: true, bodyLines: 1, titleCells: 80 });

  const result = definition.presentResult({}, { isError: false, content: [{ type: 'text', text: '1\n2\n3' }] });
  assert.equal(result.output, '1\n… +2 lines  ·  Ctrl+O');

  harness.dispose();
  assert.equal(
    definition.presentResult({}, { isError: false, content: [{ type: 'text', text: '1\n2\n3' }] }).output,
    '1\n2\n3',
  );
});

test('apply catches tools that register after the plugin row', () => {
  const definitions = {};
  const harness = makeHarness(definitions);
  apply(harness.ctx, { tools: ['bash'], titleCells: 80 });

  definitions.bash = bashDefinition();
  harness.emit('tools/change');

  assert.equal(
    definitions.bash.presentCall({ command: 'a\nb' }).title,
    'a  … +1 lines',
  );
  harness.dispose();
});

test('apply leaves frozen definitions alone', () => {
  const definition = Object.freeze(bashDefinition());
  const harness = makeHarness({ bash: definition });
  apply(harness.ctx, { tools: ['bash'] });
  assert.equal(
    definition.presentCall({ command: 'a\nb' }).title,
    'a\nb',
  );
  harness.dispose();
});

test('disabled config does not touch anything', () => {
  const definition = bashDefinition();
  const harness = makeHarness({ bash: definition });
  apply(harness.ctx, { enabled: false });
  assert.equal(definition.presentCall({ command: 'a\nb' }).title, 'a\nb');
  harness.dispose();
});

test('apply wraps result presenters for generic smart', () => {
  const definition = {
    name: 'mcp_demo',
    presentCall() {
      return { card: 'generic', title: 'mcp demo' };
    },
    presentResult() {
      return {
        card: 'generic',
        content: [{ type: 'text', text: JSON.stringify({ ok: true, data: Array.from({ length: 50 }, (_, i) => i), next: 'c2' }) }],
      };
    },
  };
  const harness = makeHarness({ mcp_demo: definition });
  apply(harness.ctx, { tools: ['mcp_demo'], generic: 'smart' });

  const out = definition.presentResult({}, { isError: false });
  assert.match(out.content[0].text, /ok=true/);
  assert.match(out.content[0].text, /data=50/);
  harness.dispose();
});
