import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { BinaryInstrumentHandlers } from '@server/domains/binary-instrument/handlers';
import type { BinaryInstrumentState } from '@server/domains/binary-instrument/handlers/shared';
import {
  getLegacyPluginStatus,
  hasInstalledLegacyPlugin,
  isGhidraAnalysisOutput,
  isRecord,
  makeMockId,
  parsePid,
  readHookOptions,
  readOptionalBoolean,
  readOptionalNumber,
  readOptionalString,
  readRequiredString,
  readStringArray,
  toHookTemplates,
} from '@server/domains/binary-instrument/handlers/shared';
import type { MCPServerContext } from '@server/MCPServer.context';
import { R } from '@server/domains/shared/ResponseBuilder';

interface ParsedToolResponse {
  success?: boolean;
  available?: boolean;
  capability?: string;
  reason?: string;
  sessionId?: string;
  count?: number;
  modules?: unknown[];
  functions?: unknown[];
  symbols?: unknown[];
  execution?: { output?: string; error?: string };
  matches?: unknown[];
  filesMatched?: number;
  result?: { stdout?: string; trace?: string[] };
}

const tempRoots: string[] = [];

afterEach(async () => {
  for (const root of tempRoots.splice(0)) {
    await rm(root, { recursive: true, force: true });
  }
  delete process.env['UNIDBG_JAR'];
});

function parse(response: unknown): ParsedToolResponse {
  if (response && typeof response === 'object' && 'content' in response) {
    return R.parse<ParsedToolResponse>(response as Parameters<typeof R.parse>[0]);
  }
  return response as ParsedToolResponse;
}

function contextWithPlugins(pluginIds: string[]): MCPServerContext {
  return {
    extensionPluginsById: new Map(pluginIds.map((id) => [id, {}])),
    extensionPluginRuntimeById: new Map(),
  } as unknown as MCPServerContext;
}

function createHandlersWithState(
  statePatch: Partial<BinaryInstrumentState>,
): BinaryInstrumentHandlers {
  const handlers = new BinaryInstrumentHandlers();
  Object.assign((handlers as unknown as { state: BinaryInstrumentState }).state, statePatch);
  return handlers;
}

class StubFridaSession {
  constructor(
    private readonly options: {
      available: boolean;
      sessionId?: string;
      diagnosticsStatus?: 'attached' | 'detached' | 'error';
      lastError?: string;
      scriptError?: string;
    },
  ) {}

  async getAvailability() {
    return this.options.available
      ? { available: true, path: 'frida', version: 'mock' }
      : { available: false, reason: 'mock frida unavailable' };
  }

  async attach(target: string) {
    if (target === 'fail') throw new Error('attach failed');
    return this.options.sessionId ?? 'session-1';
  }

  listSessions() {
    const sessionId = this.options.sessionId;
    return sessionId
      ? [
          {
            id: sessionId,
            target: '1234',
            pid: 1234,
            status: this.options.diagnosticsStatus ?? 'attached',
          },
        ]
      : [];
  }

  useSession(sessionId: string) {
    return sessionId === this.options.sessionId;
  }

  hasSession(sessionId: string) {
    return sessionId === this.options.sessionId;
  }

  async detach() {
    return undefined;
  }

  async enumerateModules() {
    return [{ name: 'app.exe', base: '0x1000', size: 4096, path: '/tmp/app.exe' }];
  }

  async executeScript(script: string) {
    return this.options.scriptError
      ? { output: '', error: this.options.scriptError }
      : { output: `ran:${script}` };
  }

  async enumerateFunctions(moduleName: string) {
    return [{ name: `${moduleName}!main`, address: '0x1010', size: 16 }];
  }

  async findSymbols(pattern: string) {
    return [{ name: pattern, address: '0x2020', demangled: pattern }];
  }

  getSessionDiagnostics(sessionId: string) {
    if (sessionId !== this.options.sessionId) return undefined;
    return {
      status: this.options.diagnosticsStatus ?? 'attached',
      lastError: this.options.lastError,
    };
  }
}

class StubJadxSearchEngine {
  calls: unknown[] = [];

  async search(options: unknown) {
    this.calls.push(options);
    return {
      matches: [{ file: 'MainActivity.java', line: 7, text: 'AES' }],
      filesMatched: 1,
      totalMatches: 1,
      engine: 'stub',
      durationMs: 2,
      decompileDir: (options as { decompileDir: string }).decompileDir,
      truncated: true,
    };
  }
}

class StubUnidbgRunner {
  launched = false;

  async launch(soPath: string, arch: string) {
    this.launched = true;
    if (soPath.includes('bad')) throw new Error('launch failed');
    return { sessionId: 'unidbg-1', soPath, arch };
  }

  async callFunction(sessionId: string, functionName: string, args: Record<string, unknown>) {
    if (sessionId !== 'unidbg-1') throw new Error(`No unidbg session found for ${sessionId}`);
    return { sessionId, functionName, args, returnValue: '0x2a' };
  }

  async trace(sessionId: string) {
    if (sessionId !== 'unidbg-1') throw new Error(`No unidbg session found for ${sessionId}`);
    return { sessionId, trace: ['mov x0, x0'] };
  }

  listSessions() {
    return this.launched
      ? [{ id: 'unidbg-1', soPath: '/tmp/libok.so', arch: 'arm64', startedAt: 'now' }]
      : [];
  }
}

describe('binary-instrument handler helper coverage', () => {
  it('normalizes scalar arguments and hook template inputs', () => {
    const args = {
      required: ' value ',
      optional: ' other ',
      blank: '   ',
      number: 7,
      nan: Number.NaN,
      flag: false,
      list: ['a', '', 42, 'b'],
      options: { includeArgs: true, includeRetAddr: false, ignored: 'x' },
    };

    expect(readRequiredString(args, 'required')).toBe('value');
    expect(() => readRequiredString(args, 'blank')).toThrow(/blank/);
    expect(readOptionalString(args, 'optional')).toBe('other');
    expect(readOptionalString(args, 'blank')).toBeUndefined();
    expect(readOptionalNumber(args, 'number')).toBe(7);
    expect(readOptionalNumber(args, 'nan')).toBeUndefined();
    expect(readOptionalBoolean(args, 'flag')).toBe(false);
    expect(readStringArray(args, 'list')).toEqual(['a', 'b']);
    expect(readHookOptions(args, 'options')).toEqual({ includeArgs: true, includeRetAddr: false });
    expect(readHookOptions(args, 'missing')).toBeUndefined();
    expect(parsePid('1234')).toBe(1234);
    expect(parsePid('abc')).toBeNull();
    expect(makeMockId('C:/Program Files/App.exe')).toBe('c-program-files-app-exe');
    expect(isRecord({ ok: true })).toBe(true);
    expect(isRecord(null)).toBe(false);
    expect(isGhidraAnalysisOutput({ functions: [], imports: [] })).toBe(true);
    expect(isGhidraAnalysisOutput({ functions: [] })).toBe(false);
  });

  it('reports legacy plugin status for installed, missing, and unknown registries', () => {
    const installed = contextWithPlugins(['plugin_frida_bridge']);
    const missing = contextWithPlugins([]);

    expect(hasInstalledLegacyPlugin(installed, 'plugin_frida_bridge')).toBe(true);
    expect(hasInstalledLegacyPlugin(missing, 'plugin_frida_bridge')).toBe(false);
    expect(hasInstalledLegacyPlugin(undefined, 'plugin_frida_bridge')).toBeUndefined();
    expect(getLegacyPluginStatus(installed, 'plugin_frida_bridge').status).toBe('available');
    expect(getLegacyPluginStatus(missing, 'plugin_frida_bridge')).toMatchObject({
      status: 'unavailable',
      reason: expect.stringContaining('not installed'),
    });
    expect(getLegacyPluginStatus(undefined, 'plugin_frida_bridge')).toMatchObject({
      status: 'unknown',
      reason: expect.stringContaining('registry'),
    });
  });

  it('drops malformed hook templates and parameters', () => {
    const templates = toHookTemplates([
      {
        functionName: 'target',
        hookCode: 'Interceptor.attach(ptr("0x1"), {});',
        description: 'valid',
        parameters: [
          { name: 'arg0', type: 'pointer', description: 'first' },
          { name: 'bad', type: 'pointer' },
          'ignored',
        ],
      },
      { functionName: 'missingCode', description: 'invalid' },
      null,
    ]);

    expect(templates).toEqual([
      {
        functionName: 'target',
        hookCode: 'Interceptor.attach(ptr("0x1"), {});',
        description: 'valid',
        parameters: [{ name: 'arg0', type: 'pointer', description: 'first' }],
      },
    ]);
  });
});

describe('binary-instrument Frida fallback branches', () => {
  it('returns a local mock session when Frida CLI is unavailable', async () => {
    const handlers = createHandlersWithState({
      fridaSession: new StubFridaSession({ available: false }) as never,
    });

    const result = parse(await handlers.handleFridaAttach({ target: '1234' }));
    expect(result).toMatchObject({
      success: false,
      available: false,
      capability: 'frida_cli',
      sessionId: 'mock-frida-1234',
    });
  });

  it('covers local Frida session success and diagnostic error paths', async () => {
    const handlers = createHandlersWithState({
      fridaSession: new StubFridaSession({
        available: true,
        sessionId: 'session-1',
        diagnosticsStatus: 'error',
        lastError: 'enumeration failed',
        scriptError: 'script failed',
      }) as never,
    });

    expect(parse(await handlers.handleFridaListSessions({}))).toMatchObject({
      success: true,
      available: true,
      count: 1,
    });
    expect(
      parse(await handlers.handleFridaEnumerateModules({ sessionId: 'missing' })),
    ).toMatchObject({
      available: false,
      capability: 'frida_session',
    });
    expect(
      parse(await handlers.handleFridaEnumerateModules({ sessionId: 'session-1' })),
    ).toMatchObject({
      success: false,
      reason: 'enumeration failed',
      modules: [{ name: 'app.exe' }],
    });
    expect(
      parse(await handlers.handleFridaRunScript({ sessionId: 'session-1', script: '1+1' })),
    ).toMatchObject({
      success: false,
      reason: 'script failed',
    });
    expect(
      parse(
        await handlers.handleFridaEnumerateFunctions({
          sessionId: 'session-1',
          moduleName: 'app.exe',
        }),
      ),
    ).toMatchObject({
      success: false,
      count: 1,
    });
    expect(
      parse(await handlers.handleFridaFindSymbols({ sessionId: 'session-1', pattern: 'main' })),
    ).toMatchObject({
      success: false,
      count: 1,
    });
    expect(parse(await handlers.handleFridaDetach({ sessionId: 'session-1' }))).toMatchObject({
      success: true,
      detached: true,
    });
  });
});

describe('binary-instrument analysis coverage branches', () => {
  it('passes validated search options to the JADX search engine', async () => {
    const engine = new StubJadxSearchEngine();
    const handlers = createHandlersWithState({ jadxSearchEngine: engine as never });

    const result = parse(
      await handlers.handleJadxSearchCode({
        decompileDir: '/tmp/jadx-out',
        query: 'AES',
        literal: true,
        caseInsensitive: true,
        contextLines: 2,
        maxMatchesPerFile: 3,
        maxResults: 4,
        globs: ['**/*.java'],
      }),
    );

    expect(result).toMatchObject({
      success: true,
      filesMatched: 1,
      matches: [{ file: 'MainActivity.java' }],
    });
    expect(engine.calls[0]).toEqual({
      decompileDir: '/tmp/jadx-out',
      query: 'AES',
      literal: true,
      caseInsensitive: true,
      contextLines: 2,
      maxMatchesPerFile: 3,
      maxResults: 4,
      globs: ['**/*.java'],
    });
  });

  it('returns static strings when Ghidra is unavailable and the binary is readable', async () => {
    const root = await mkdtemp(join(tmpdir(), 'jshook-ghidra-fallback-'));
    tempRoots.push(root);
    const binaryPath = join(root, 'sample.bin');
    await writeFile(binaryPath, Buffer.from([0, ...Buffer.from('alpha\0beta-string\0alpha')]));

    const handlers = createHandlersWithState({
      ghidra: {
        getAvailability: async () => ({ available: false, reason: 'no ghidra' }),
      } as never,
    });
    const result = parse(await handlers.handleGhidraAnalyze({ binaryPath }));

    expect(result).toMatchObject({
      available: false,
      capability: 'ghidra_headless',
      reason: 'no ghidra',
    });
    expect(result).toHaveProperty('strings', ['alpha', 'beta-string']);
  });

  it('covers unidbg unavailable, launch success, call, trace, and launch failure responses', async () => {
    const runner = new StubUnidbgRunner();
    const handlers = createHandlersWithState({ unidbgRunner: runner as never });

    expect(
      parse(
        await handlers.handleUnidbgEmulate({
          binaryPath: '/tmp/libx.so',
          functionName: 'JNI_OnLoad',
          args: ['a', 7],
        }),
      ),
    ).toMatchObject({
      available: false,
      capability: 'unidbg_jar',
      result: { trace: ['mock-unidbg-unavailable'] },
    });
    expect(
      parse(await handlers.handleUnidbgLaunch({ soPath: '/tmp/libok.so', arch: 'arm64' })),
    ).toMatchObject({
      available: true,
      sessionId: 'unidbg-1',
    });
    expect(
      parse(
        await handlers.handleUnidbgCall({
          sessionId: 'unidbg-1',
          functionName: 'foo',
          args: { x: 1 },
        }),
      ),
    ).toMatchObject({
      returnValue: '0x2a',
    });
    expect(parse(await handlers.handleUnidbgTrace({ sessionId: 'unidbg-1' }))).toMatchObject({
      trace: ['mov x0, x0'],
    });
    expect(await handlers.handleUnidbgLaunch({ soPath: '/tmp/bad.so' })).toMatchObject({
      available: false,
      reason: 'launch failed',
    });
  });
});
