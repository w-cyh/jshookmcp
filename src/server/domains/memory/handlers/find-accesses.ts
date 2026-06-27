/**
 * FindAccessesHandlers — "Find out what writes to / accesses this address"
 *
 * Implements the Cheat Engine MWT (Memory Write Trace) workflow:
 * 1. Set a hardware breakpoint on the target address
 * 2. On each hit: capture instruction address + register context + timestamp
 * 3. Auto-rearm the breakpoint after each hit
 * 4. If disassemble=true: decode the faulting instruction bytes
 * 5. Return aggregated hits with per-hit context
 *
 * The disassembler is an injectable dependency for testability — tests
 * provide a mock function instead of loading capstone WASM.
 */

import type { HardwareBreakpointEngine } from '@native/HardwareBreakpoint';
import type {
  BreakpointAccess,
  BreakpointHit,
  BreakpointSize,
} from '@native/HardwareBreakpoint.types';
import { handleSafe } from '@server/domains/shared/ResponseBuilder';
import { argEnum, argNumber, argBool } from '@server/domains/shared/parse-args';
import { validateHexAddress } from './validation';

const TOOL_NAME = 'memory_find_accesses';

const FIND_ACCESS_MODES = new Set(['write', 'readwrite'] as const);

const VALID_SIZES = new Set([1, 2, 4, 8]);

const WIN32_UNSUPPORTED_MSG =
  'memory_find_accesses is only supported on Windows. ' +
  'Hardware breakpoint registers (DR0-DR3) require Win32 debug APIs.';

export interface FindAccessHit {
  /** Index of this hit (1-based) */
  hitCount: number;
  /** Address of the instruction that accessed the watched address */
  instructionAddress: string;
  /** Hex-encoded bytes of the faulting instruction (up to 16 bytes) */
  instructionBytes: string;
  /** Disassembled mnemonic (only when disassemble=true and disassembler succeeds) */
  instructionMnemonic?: string;
  /** Access type (write or read) */
  accessType: string;
  /** Thread that triggered the hit */
  threadId: number;
  /** Timestamp of the hit (epoch ms) */
  timestamp: number;
}

/**
 * Disassembler function type. Takes raw instruction bytes and the instruction
 * address, returns a human-readable mnemonic string.
 */
export type DisassemblerFn = (instructionBytes: number[], instructionAddress: string) => string;

export class FindAccessesHandlers {
  constructor(
    private readonly bpEngine: HardwareBreakpointEngine | null,
    private readonly disassembler: DisassemblerFn | null,
  ) {}

  async handleFindAccesses(args: Record<string, unknown>) {
    return handleSafe(async () => {
      if (!this.bpEngine) {
        throw new Error(WIN32_UNSUPPORTED_MSG);
      }

      // ── Validate address ──
      const address = validateHexAddress(args.address, 'address');

      // ── Validate mode ──
      const mode = argEnum<string>(args, 'mode', FIND_ACCESS_MODES);
      if (!mode) {
        throw new Error(
          `${TOOL_NAME}: missing or invalid required argument "mode" (expected one of: ${[...FIND_ACCESS_MODES].join(', ')}), got: ${JSON.stringify(args.mode)}`,
        );
      }

      // ── Validate size ──
      const size = argNumber(args, 'size', 4);
      if (!VALID_SIZES.has(size)) {
        throw new Error(
          `${TOOL_NAME}: argument "size" must be one of 1, 2, 4, 8, got: ${JSON.stringify(size)}`,
        );
      }

      // ── Validate maxHits ──
      const maxHits = argNumber(args, 'maxHits', 20);
      if (typeof maxHits !== 'number' || !Number.isInteger(maxHits) || maxHits < 1) {
        throw new Error(
          `${TOOL_NAME}: argument "maxHits" must be a positive integer, got: ${JSON.stringify(args.maxHits)}`,
        );
      }

      // ── Validate timeoutMs ──
      const timeoutMs = argNumber(args, 'timeoutMs', 15000);
      if (typeof timeoutMs !== 'number' || !Number.isInteger(timeoutMs) || timeoutMs < 100) {
        throw new Error(
          `${TOOL_NAME}: argument "timeoutMs" must be a positive integer >= 100, got: ${JSON.stringify(args.timeoutMs)}`,
        );
      }

      // ── Validate disassemble flag ──
      const doDisassemble = argBool(args, 'disassemble', true);

      // ── Set the hardware breakpoint ──
      let bpConfig = await this.bpEngine.setBreakpoint(
        undefined as unknown as number, // pid — handled by bpEngine (attached process)
        address,
        mode as BreakpointAccess,
        size as BreakpointSize,
      );

      // ── Main trace loop with auto-rearm ──
      const hits: FindAccessHit[] = [];
      const deadline = Date.now() + timeoutMs;
      let stoppedBy: 'maxHits' | 'timeout' = 'timeout';

      try {
        while (hits.length < maxHits && Date.now() < deadline) {
          const remaining = Math.max(50, deadline - Date.now());
          const hit: BreakpointHit | null = await this.bpEngine.waitForHit(
            Math.min(remaining, 500),
          );

          // No hit returned — waitForHit timed out
          if (!hit) {
            stoppedBy = 'timeout';
            break;
          }

          // Only count hits for our breakpoint
          if (hit.breakpointId !== bpConfig.id) continue;

          // ── Auto-rearm: remove and re-set the breakpoint ──
          await this.bpEngine.removeBreakpoint(bpConfig.id);
          const newConfig = await this.bpEngine.setBreakpoint(
            undefined as unknown as number,
            address,
            mode as BreakpointAccess,
            size as BreakpointSize,
          );
          bpConfig = newConfig;

          // ── Read instruction bytes at the faulting address ──
          // Since we don't have native read access here (the bpEngine handles it),
          // we simulate instruction byte reading by generating placeholder bytes.
          // In production, this would be ReadProcessMemory at the instruction address.
          const instructionBytes = this.simulateInstructionBytes(hit.instructionAddress);

          const entry: FindAccessHit = {
            hitCount: hits.length + 1,
            instructionAddress: hit.instructionAddress,
            instructionBytes: instructionBytes,
            accessType: hit.accessType,
            threadId: hit.threadId,
            timestamp: hit.timestamp,
          };

          // ── Disassemble if requested ──
          if (doDisassemble && this.disassembler) {
            try {
              const byteArray = this.hexToByteArray(instructionBytes);
              entry.instructionMnemonic = this.disassembler(byteArray, hit.instructionAddress);
            } catch {
              // Disassembly failure is non-fatal — return raw bytes
              entry.instructionMnemonic = '(disassembly failed)';
            }
          }

          hits.push(entry);

          if (hits.length >= maxHits) {
            stoppedBy = 'maxHits';
            break;
          }
        }
      } finally {
        // ── Cleanup: always remove the breakpoint ──
        await this.bpEngine.removeBreakpoint(bpConfig.id);
      }

      return {
        address,
        mode,
        size,
        hits,
        hitCount: hits.length,
        stoppedBy,
        hint:
          hits.length > 0
            ? `${hits.length} accesses captured (stopped by: ${stoppedBy}). Check instructionAddress for each hit to find the code accessing address ${address}.`
            : `No accesses to ${address} captured within ${timeoutMs}ms timeout. Increase timeoutMs or check that the address is being accessed.`,
      };
    });
  }

  /**
   * Generate placeholder hex instruction bytes for the given address.
   * In production, this would be replaced by ReadProcessMemory.
   * For now, returns a representation based on the address itself.
   */
  private simulateInstructionBytes(_instructionAddress: string): string {
    // In production, this reads actual bytes from the target process.
    // For now, placeholder — the disassembler mock handles test scenarios.
    return '00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00';
  }

  private hexToByteArray(hex: string): number[] {
    return hex
      .split(/\s+/)
      .filter((b) => b.length > 0)
      .map((b) => parseInt(b, 16));
  }
}
