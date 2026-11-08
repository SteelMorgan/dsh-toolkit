import test from 'node:test';
import assert from 'node:assert/strict';
import { apply } from '../lib/index.js';

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

function makeHarness({ global, scoped, agents: initialAgents = [], definitions = [] }) {
  const listeners = new Map();
  const effects = [];
  const agents = { list: () => initialAgents };
  const byName = new Map();
  if (global) byName.set(global.name, global);
  for (const definition of definitions) byName.set(definition.name, definition);
  const tools = {
    get(name, scope) {
      if (scope === undefined) return byName.get(name);
      return scoped.get(scope);
    },
    definitions() {
      return definitions.length > 0 ? definitions : global ? [global] : [];
    },
  };
  const ctx = {
    tools,
    agents,
    get(name) {
      return name === 'agents' ? agents : undefined;
    },
    inject(_services, callback) {
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
    emit(event, payload) {
      for (const listener of listeners.get(event) ?? []) listener(payload);
    },
    dispose() {
      for (const disposer of effects.reverse()) disposer?.();
    },
  };
}

test('apply patches the agent-scoped bash definition, not just the global one', () => {
  const global = bashDefinition();
  const agent = { id: 'agent-1' };
  const scoped = bashDefinition();
  const harness = makeHarness({ global, scoped: new Map([[agent, scoped]]), agents: [agent] });

  apply(harness.ctx, { tools: ['bash'], titleCells: 80, trimResults: true, bodyLines: 1 });

  assert.equal(scoped.presentCall({ command: 'a\nb' }).title, 'a  … +1 lines');
  assert.equal(
    scoped.presentResult({}, { isError: false, content: [{ type: 'text', text: '1\n2\n3' }] }).output,
    '1\n… +2 lines  ·  Ctrl+O',
  );
  // The global fallback is patched too, but the scoped one is what the TUI reads.
  assert.equal(global.presentCall({ command: 'a\nb' }).title, 'a  … +1 lines');

  harness.dispose();
  assert.equal(scoped.presentCall({ command: 'a\nb' }).title, 'a\nb');
});

test('apply patches an agent created after the plugin row', () => {
  const global = bashDefinition();
  const agent = { id: 'agent-2' };
  const scoped = bashDefinition();
  const harness = makeHarness({ global, scoped: new Map([[agent, scoped]]), agents: [] });

  apply(harness.ctx, { tools: ['bash'], titleCells: 80 });
  assert.equal(scoped.presentCall({ command: 'a\nb' }).title, 'a\nb');

  harness.emit('agent/created', { agent });
  assert.equal(scoped.presentCall({ command: 'a\nb' }).title, 'a  … +1 lines');

  harness.dispose();
});

test('apply patches the agent-context tools registry used by a restored session', () => {
  const global = bashDefinition();
  const scoped = bashDefinition();
  const scopedTools = { get(name) { return name === 'bash' ? scoped : undefined; } };
  const agent = {
    id: 'agent-restored',
    ctx: { get(name) { return name === 'tools' ? scopedTools : undefined; } },
  };
  const harness = makeHarness({ global, scoped: new Map(), agents: [agent] });

  apply(harness.ctx, { tools: ['bash'], titleCells: 80 });

  // The real transcript resolves through agent.ctx.get('tools'), not the
  // global tools.get(name, agent) view.
  assert.equal(scoped.presentCall({ command: 'a\nb' }).title, 'a  … +1 lines');
  assert.equal(global.presentCall({ command: 'a\nb' }).title, 'a  … +1 lines');

  harness.dispose();
  assert.equal(scoped.presentCall({ command: 'a\nb' }).title, 'a\nb');
});


function genericDefinition() {
  const result = {
    card: 'generic',
    content: [{
      type: 'text',
      text: JSON.stringify({
        total: 42,
        items: Array.from({ length: 20 }, (_, i) => ({ id: i, status: 'ok', note: 'row ' + i })),
        next: 'cursor-42',
      }),
    }],
  };
  return {
    name: 'mcp__demo',
    presentCall(args) {
      return { card: 'generic', content: [{ type: 'text', text: JSON.stringify(args) }] };
    },
    presentResult() {
      return result;
    },
  };
}

test('allTools compacts generic/MCP results without changing their call headers', () => {
  const bash = bashDefinition();
  const mcp = genericDefinition();
  const harness = makeHarness({ global: bash, scoped: new Map(), definitions: [bash, mcp] });
  const beforeCall = mcp.presentCall({ q: 'demo' });
  const fullResult = mcp.presentResult().content[0].text;

  apply(harness.ctx, { allTools: true, tools: ['bash'], generic: 'smart', titleCells: 80 });

  // MCP call headers are generic cards: compactCallView deliberately leaves them alone.
  assert.deepEqual(mcp.presentCall({ q: 'demo' }), beforeCall);
  const compacted = mcp.presentResult().content[0].text;
  assert.match(compacted, /hidden/);
  assert.ok(compacted.length < fullResult.length);

  harness.dispose();
  assert.equal(mcp.presentResult().content[0].text, fullResult);
});

test('without allTools the generic/MCP result is not wrapped', () => {
  const bash = bashDefinition();
  const mcp = genericDefinition();
  const harness = makeHarness({ global: bash, scoped: new Map(), definitions: [bash, mcp] });
  const fullResult = mcp.presentResult().content[0].text;

  apply(harness.ctx, { tools: ['bash'], generic: 'smart', titleCells: 80 });

  assert.equal(mcp.presentResult().content[0].text, fullResult);
  harness.dispose();
});
