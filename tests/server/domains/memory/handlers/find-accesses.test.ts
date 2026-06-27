import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FindAccessesHandlers } from '../../../../../src/server/domains/memory/handlers/find-accesses';

describe('FindAccessesHandlers', () => {
  let handlers: FindAccessesHandlers;

  const BP_ID = 'bp-find-1';
  const ADDRESS = '0x7FF612340000';

  const makeHit = (
    overrides: Partial<{
      instructionAddress: string;
      accessType: string;
      timestamp: number;
      threadId: number;
      breakpointId: string;
    }> = {},
  ) => ({
    breakpointId: overrides.breakpointId ?? BP_ID,
    address: ADDRESS,
    accessAddress: ADDRESS,
    instructionAddress: overrides.instructionAddress ?? '0x7FF612341000',
    threadId: overrides.threadId ?? 5678,
    accessType: overrides.accessType ?? 'write',
    timestamp: overrides.timestamp ?? Date.now(),
    registers: {
      rax: '0x1',
      rbx: '0x2',
      rcx: '0x3',
      rdx: '0x4',
      rsi: '0x5',
      rdi: '0x6',
      rsp: '0x7',
      rbp: '0x8',
      r8: '0x9',
      r9: '0xA',
      r10: '0xB',
      r11: '0xC',
      r12: '0xD',
      r13: '0xE',
      r14: '0xF',
      r15: '0x10',
      rip: overrides.instructionAddress ?? '0x7FF612341000',
      rflags: '0x246',
    },
  });

  const makeBpEngine = () => ({
    setBreakpoint: vi.fn(),
    removeBreakpoint: vi.fn(),
    waitForHit: vi.fn(),
    listBreakpoints: vi.fn().mockReturnValue([]),
  });

  const makeDisassembler = () => vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('instantiates correctly', () => {
    const bpEngine = makeBpEngine();
    const disassembler = makeDisassembler();
    handlers = new FindAccessesHandlers(bpEngine as any, disassembler);
    expect(handlers).toBeInstanceOf(FindAccessesHandlers);
    expect(typeof handlers.handleFindAccesses).toBe('function');
  });

  describe('handleFindAccesses', () => {
    it('captures hits with auto-rearm and returns per-hit context', async () => {
      const bpEngine = makeBpEngine();
      const disassembler = makeDisassembler();
      handlers = new FindAccessesHandlers(bpEngine as any, disassembler);

      // setBreakpoint always returns same id — re-arm keeps the same logical breakpoint
      bpEngine.setBreakpoint.mockResolvedValue({ id: BP_ID, address: ADDRESS });

      // First hit, then auto-rearm, then second hit, then timeout (null)
      bpEngine.waitForHit
        .mockResolvedValueOnce(makeHit({ instructionAddress: '0x7FF612341000' }))
        .mockResolvedValueOnce(makeHit({ instructionAddress: '0x7FF612342000' }))
        .mockResolvedValue(null);

      bpEngine.removeBreakpoint.mockResolvedValue(true);
      disassembler.mockReturnValue('mov [rcx], eax');

      const response = await handlers.handleFindAccesses({
        address: ADDRESS,
        mode: 'write',
        maxHits: 20,
        timeoutMs: 5000,
      });

      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(true);
      expect(parsed.hits).toHaveLength(2);
      expect(parsed.hitCount).toBe(2);

      // First hit: disassembled
      expect(parsed.hits[0].instructionAddress).toBe('0x7FF612341000');
      expect(parsed.hits[0].instructionMnemonic).toBe('mov [rcx], eax');
      expect(parsed.hits[0].accessType).toBe('write');
      expect(parsed.hits[0].hitCount).toBe(1);

      // Second hit
      expect(parsed.hits[1].instructionAddress).toBe('0x7FF612342000');
      expect(parsed.hits[1].hitCount).toBe(2);

      // Auto-rearm: setBreakpoint called for initial + after hit1 + after hit2 = 3 times
      // waitForHit called 3 times (2 hits + null which triggers timeout)
      expect(bpEngine.setBreakpoint).toHaveBeenCalledTimes(3);
      expect(bpEngine.setBreakpoint).toHaveBeenCalledWith(undefined, ADDRESS, 'write', 4);
      expect(bpEngine.waitForHit).toHaveBeenCalledTimes(3);
      // Cleanup: remove called during re-arm (hit1, hit2) + finally block = 3 times
      expect(bpEngine.removeBreakpoint).toHaveBeenCalledTimes(3);
    });

    it('captures readwrite mode hits', async () => {
      const bpEngine = makeBpEngine();
      const disassembler = makeDisassembler();
      handlers = new FindAccessesHandlers(bpEngine as any, disassembler);

      bpEngine.setBreakpoint.mockResolvedValue({ id: BP_ID, address: ADDRESS });

      bpEngine.waitForHit
        .mockResolvedValueOnce(makeHit({ accessType: 'write', instructionAddress: '0x1000' }))
        .mockResolvedValueOnce(makeHit({ accessType: 'read', instructionAddress: '0x2000' }))
        .mockResolvedValue(null);

      bpEngine.removeBreakpoint.mockResolvedValue(true);
      disassembler.mockReturnValue('nop');

      const response = await handlers.handleFindAccesses({
        address: ADDRESS,
        mode: 'readwrite',
        timeoutMs: 1000,
      });

      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(true);
      expect(parsed.hits).toHaveLength(2);
      expect(parsed.hits[0].accessType).toBe('write');
      expect(parsed.hits[1].accessType).toBe('read');
      // Initial call
      expect(bpEngine.setBreakpoint).toHaveBeenCalledWith(undefined, ADDRESS, 'readwrite', 4);
    });

    it('respects maxHits limit', async () => {
      const bpEngine = makeBpEngine();
      const disassembler = makeDisassembler();
      handlers = new FindAccessesHandlers(bpEngine as any, disassembler);

      bpEngine.setBreakpoint.mockResolvedValue({ id: BP_ID, address: ADDRESS });

      // Queue several hits with matching breakpointId
      bpEngine.waitForHit
        .mockResolvedValueOnce(makeHit({ instructionAddress: '0x1000' }))
        .mockResolvedValueOnce(makeHit({ instructionAddress: '0x1100' }))
        .mockResolvedValueOnce(makeHit({ instructionAddress: '0x1200' }))
        .mockResolvedValueOnce(makeHit({ instructionAddress: '0x1300' }))
        .mockResolvedValue(null); // fallback timeout

      bpEngine.removeBreakpoint.mockResolvedValue(true);
      disassembler.mockReturnValue('add eax, 1');

      const response = await handlers.handleFindAccesses({
        address: ADDRESS,
        mode: 'write',
        maxHits: 3,
        timeoutMs: 5000,
      });

      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(true);
      expect(parsed.hits).toHaveLength(3);
      expect(parsed.hitCount).toBe(3);
      expect(parsed.stoppedBy).toBe('maxHits');
      expect(bpEngine.removeBreakpoint).toHaveBeenCalled();
    });

    it('stops on timeout', async () => {
      const bpEngine = makeBpEngine();
      const disassembler = makeDisassembler();
      handlers = new FindAccessesHandlers(bpEngine as any, disassembler);

      bpEngine.setBreakpoint.mockResolvedValue({ id: BP_ID, address: ADDRESS });

      // Return one hit then null (simulating timeout — no more hits before deadline)
      bpEngine.waitForHit
        .mockResolvedValueOnce(makeHit({ instructionAddress: '0x1000' }))
        .mockResolvedValue(null);

      bpEngine.removeBreakpoint.mockResolvedValue(true);
      disassembler.mockReturnValue('xor eax, eax');

      const response = await handlers.handleFindAccesses({
        address: ADDRESS,
        mode: 'write',
        maxHits: 50,
        timeoutMs: 100, // short timeout
      });

      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(true);
      expect(parsed.hits).toHaveLength(1);
      expect(parsed.stoppedBy).toBe('timeout');
    });

    it('returns raw instruction bytes when disassemble=false', async () => {
      const bpEngine = makeBpEngine();
      const disassembler = makeDisassembler();
      handlers = new FindAccessesHandlers(bpEngine as any, disassembler);

      bpEngine.setBreakpoint.mockResolvedValue({ id: BP_ID, address: ADDRESS });

      bpEngine.waitForHit
        .mockResolvedValueOnce(makeHit({ instructionAddress: '0x1000' }))
        .mockResolvedValue(null);

      bpEngine.removeBreakpoint.mockResolvedValue(true);

      const response = await handlers.handleFindAccesses({
        address: ADDRESS,
        mode: 'write',
        disassemble: false,
        timeoutMs: 1000,
      });

      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(true);
      expect(parsed.hits).toHaveLength(1);
      expect(parsed.hits[0].instructionBytes).toBeDefined();
      expect(parsed.hits[0].instructionMnemonic).toBeUndefined();
      expect(disassembler).not.toHaveBeenCalled();
    });

    it('returns error for invalid address', async () => {
      const bpEngine = makeBpEngine();
      const disassembler = makeDisassembler();
      handlers = new FindAccessesHandlers(bpEngine as any, disassembler);

      const response = await handlers.handleFindAccesses({
        address: 'not-a-hex-address',
        mode: 'write',
      });

      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(false);
      expect(parsed.error).toContain('address must be a hex address');
      expect(bpEngine.setBreakpoint).not.toHaveBeenCalled();
    });

    it('returns error when bpEngine is null (unsupported platform)', async () => {
      handlers = new FindAccessesHandlers(null, makeDisassembler());

      const response = await handlers.handleFindAccesses({
        address: ADDRESS,
        mode: 'write',
      });

      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(false);
      expect(parsed.error).toContain('only supported on Windows');
    });

    it('rejects invalid mode', async () => {
      const bpEngine = makeBpEngine();
      const disassembler = makeDisassembler();
      handlers = new FindAccessesHandlers(bpEngine as any, disassembler);

      const response = await handlers.handleFindAccesses({
        address: ADDRESS,
        mode: 'execute',
      });

      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(false);
      expect(parsed.error).toContain('Invalid mode');
      expect(bpEngine.setBreakpoint).not.toHaveBeenCalled();
    });

    it('rejects invalid size', async () => {
      const bpEngine = makeBpEngine();
      const disassembler = makeDisassembler();
      handlers = new FindAccessesHandlers(bpEngine as any, disassembler);

      const response = await handlers.handleFindAccesses({
        address: ADDRESS,
        mode: 'write',
        size: 3, // not in 1, 2, 4, 8
      });

      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(false);
      expect(parsed.error).toContain('"size"');
      expect(bpEngine.setBreakpoint).not.toHaveBeenCalled();
    });

    it('accepts valid sizes 1, 2, 4, 8', async () => {
      for (const size of [1, 2, 4, 8]) {
        const bpEngine = makeBpEngine();
        const disassembler = makeDisassembler();
        const h = new FindAccessesHandlers(bpEngine as any, disassembler);

        bpEngine.setBreakpoint.mockResolvedValue({ id: `bp-${size}`, address: ADDRESS });
        // Return null immediately so the loop exits on timeout
        bpEngine.waitForHit.mockResolvedValue(null);
        bpEngine.removeBreakpoint.mockResolvedValue(true);
        bpEngine.listBreakpoints.mockReturnValue([]);

        const response = await h.handleFindAccesses({
          address: ADDRESS,
          mode: 'write',
          size,
          timeoutMs: 100, // very short timeout — exits quickly
        });

        const parsed = JSON.parse((response.content[0] as any).text);
        expect(parsed.success).toBe(true);
        expect(bpEngine.setBreakpoint).toHaveBeenCalledWith(undefined, ADDRESS, 'write', size);
      }
    });

    it('returns summary when no hits captured within timeout', async () => {
      const bpEngine = makeBpEngine();
      const disassembler = makeDisassembler();
      handlers = new FindAccessesHandlers(bpEngine as any, disassembler);

      bpEngine.setBreakpoint.mockResolvedValue({ id: BP_ID, address: ADDRESS });
      bpEngine.waitForHit.mockResolvedValue(null); // no hits — timeout immediately
      bpEngine.removeBreakpoint.mockResolvedValue(true);

      // Use a very short timeout so the deadline expires quickly
      const response = await handlers.handleFindAccesses({
        address: ADDRESS,
        mode: 'write',
        timeoutMs: 100,
      });

      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(true);
      expect(parsed.hits).toHaveLength(0);
      expect(parsed.hitCount).toBe(0);
      expect(parsed.hint).toContain('No accesses');
    });
  });
});
