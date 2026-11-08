/**
 * dsh-tui-compact-tech — compact terminal tool cards for dsh-TUI.
 *
 * dsh-TUI renders a tool call as a header plus a small body. In orchestrator
 * sessions the header is the problem: a Bash call whose command is a multi-line
 * shell script paints every source line. This plugin wraps the tools'
 * presentation callbacks and rewrites the *view* only:
 *
 *   - terminal call title -> first line, clipped, with `+N lines`.
 *
 * Header-only is the default for terminal cards. Their result view is left
 * untouched, so the TUI's own 3-line preview and the full Ctrl+O expansion
 * keep working. `trimResults: true` additionally shortens the terminal body
 * (and therefore the Ctrl+O view — both states use the same result view).
 *
 * Generic/MCP cards can opt into `generic: 'smart'` (JSON-aware summary
 * + head/tail) or `'headtail'`; that is also lossy in the card, by design.
 *
 * TUI profiles mount model-facing tools inside each agent's scope (the agent
 * preset's standing mount). A global `tools.get('bash')` therefore does not
 * see the definition the transcript uses. The plugin patches both the global
 * view and every agent scope, and follows `agent/created` for agents created
 * after the row activates.
 *
 * @module dsh-tui-compact-tech
 */

import { compactCallView, compactResultView, normalizeOptions } from './compact.js';

export const name = 'dsh-tui-compact-tech';

/** Marks a definition this plugin already wrapped (per process). */
const PATCHED = Symbol.for('dsh-tui-compact-tech.patched');

/**
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {Record<string, unknown>} [config]
 */
export function apply(ctx, config = {}) {
  const options = normalizeOptions(config ?? {});
  if (!options.enabled) return;

  ctx.inject(['tools'], toolsCtx => {
    const tools = toolsCtx.tools;
    if (tools === undefined || typeof tools.get !== 'function') {
      toolsCtx.logger?.warn?.('dsh-tui-compact-tech: tools service is unavailable; nothing to compact');
      return;
    }

    /** @type {Map<object, { call?: { original: Function, wrapped: Function }, result?: { original: Function, wrapped: Function } }>} */
    const patches = new Map();
    let disposed = false;

    const patchDefinition = (toolName, definition) => {
      if (definition === null || typeof definition !== 'object') return;
      if (definition[PATCHED] === true) return;
      if (Object.isFrozen(definition)) {
        toolsCtx.logger?.debug?.(`dsh-tui-compact-tech: "${toolName}" is frozen; leaving its cards unchanged`);
        return;
      }

      const record = {};
      if (typeof definition.presentCall === 'function') {
        const original = definition.presentCall;
        const wrapped = function presentCall(args) {
          try {
            return compactCallView(original.call(this, args), options);
          } catch {
            try {
              return original.call(this, args);
            } catch {
              return undefined;
            }
          }
        };
        definition.presentCall = wrapped;
        record.call = { original, wrapped };
      }
      if ((options.trimResults || options.generic !== false) && typeof definition.presentResult === 'function') {
        const original = definition.presentResult;
        const wrapped = function presentResult(args, result) {
          try {
            return compactResultView(original.call(this, args, result), result, options);
          } catch {
            try {
              return original.call(this, args, result);
            } catch {
              return undefined;
            }
          }
        };
        definition.presentResult = wrapped;
        record.result = { original, wrapped };
      }
      if (record.call === undefined && record.result === undefined) return;
      definition[PATCHED] = true;
      patches.set(definition, record);
      toolsCtx.logger?.debug?.(`dsh-tui-compact-tech: compacting "${toolName}" cards`);
    };

    /** Patch configured tools, or every definition when `allTools` is set. */
    const patchService = (service, scope) => {
      if (service === undefined || typeof service.get !== 'function') return;
      // Agent-context registries accept either their default view or the
      // agent as an explicit scope; global registries only take undefined.
      const scopes = scope === undefined ? [undefined] : [scope, undefined];
      const names = new Set(options.tools);
      if (options.allTools && typeof service.definitions === 'function') {
        for (const candidateScope of scopes) {
          try {
            const definitions = service.definitions(candidateScope);
            if (!Array.isArray(definitions)) continue;
            for (const definition of definitions) {
              if (definition !== null && typeof definition === 'object' && typeof definition.name === 'string') {
                names.add(definition.name);
              }
            }
          } catch {
            // Fall back to the explicit list; a registry without definitions()
            // just cannot enumerate MCP/generic tools.
          }
        }
      }
      for (const toolName of names) {
        const seen = new Set();
        for (const candidateScope of scopes) {
          let definition;
          try {
            definition = service.get(toolName, candidateScope);
          } catch {
            continue;
          }
          if (definition === undefined || seen.has(definition)) continue;
          seen.add(definition);
          patchDefinition(toolName, definition);
        }
      }
    };

    /**
     * Patch the given scope (undefined = the global view).
     *
     * The transcript's presenter resolves definitions through the agent's own
     * context (`agent.ctx.get('tools')`), not through the global registry with
     * the agent passed as a scope argument. On preset-scoped profiles those are
     * different registries, so patching only the global one leaves restored
     * sessions with full Bash cards. Patch the agent-context registry first and
     * keep the global scope view as a legacy fallback.
     */
    const patchScope = scope => {
      if (scope === undefined) {
        patchService(tools, undefined);
        return;
      }
      const scopedTools = scope?.ctx?.get?.('tools');
      if (scopedTools !== undefined && typeof scopedTools.get === 'function') {
        patchService(scopedTools, scope);
      }
      patchService(tools, scope);
    };

    const patchAll = () => {
      if (disposed) return;
      patchScope(undefined);
      const agents = toolsCtx.get?.('agents');
      if (agents !== undefined && typeof agents.list === 'function') {
        let list = [];
        try {
          list = agents.list();
        } catch {
          list = [];
        }
        for (const agent of list) patchScope(agent);
      }
    };

    // Tools and agents may exist before or after this row: sweep now, then
    // follow both the tool registry and the agent lifecycle. A short late
    // sweep catches a restored foreground agent that is published after the
    // row's synchronous apply but before its first tools/change event.
    patchAll();
    const offChange = toolsCtx.on('tools/change', patchAll);
    const offCreated = toolsCtx.on('agent/created', payload => {
      if (!disposed) patchScope(payload?.agent);
    });
    const lateSweeps = [];
    if (typeof queueMicrotask === 'function') queueMicrotask(patchAll);
    else lateSweeps.push(setTimeout(patchAll, 0));
    lateSweeps.push(setTimeout(patchAll, 500));
    for (const timer of lateSweeps) timer?.unref?.();

    toolsCtx.effect(() => () => {
      disposed = true;
      offChange?.();
      offCreated?.();
      for (const timer of lateSweeps) clearTimeout(timer);
      for (const [definition, record] of patches) {
        if (record.call !== undefined && definition.presentCall === record.call.wrapped) {
          definition.presentCall = record.call.original;
        }
        if (record.result !== undefined && definition.presentResult === record.result.wrapped) {
          definition.presentResult = record.result.original;
        }
        delete definition[PATCHED];
      }
      patches.clear();
    });
  });
}
