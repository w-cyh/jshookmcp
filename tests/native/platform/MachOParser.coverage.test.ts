/**
 * Coverage tests for MachOParser — error paths + minimal valid Mach-O 64-bit
 * header (readFileSync mocked).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockReadFileSync = vi.fn();

vi.mock('node:fs', () => ({
  readFileSync: (p: string) => mockReadFileSync(p),
}));

import {
  parseMachOHeader,
  parseMachoSections,
  parseMachOSymbols,
} from '@native/platform/MachOParser';

/** Minimal Mach-O 64-bit header: magic 0xFEEDFACF + cputype + cpusubtype + filetype. */
function macho64Header(): Buffer {
  const b = Buffer.alloc(32);
  b.writeUInt32LE(0xfeedfacf, 0); // MH_MAGIC_64
  b.writeUInt32LE(0x0100000c, 4); // CPU_TYPE_X86_64
  b.writeUInt32LE(0x80000003, 8); // CPU_SUBTYPE_X86_64_ALL | LIB64
  b.writeUInt32LE(2, 12); // MH_EXECUTE
  b.writeUInt32LE(0, 16); // ncmds
  b.writeUInt32LE(0, 20); // sizeofcmds
  b.writeUInt32LE(0, 24); // flags
  b.writeUInt32LE(0, 28); // reserved
  return b;
}

beforeEach(() => {
  mockReadFileSync.mockReset();
});

describe('parseMachOHeader', () => {
  it('returns null when readFileSync throws', () => {
    mockReadFileSync.mockImplementation(() => {
      throw new Error('ENOENT');
    });
    expect(parseMachOHeader('/nope')).toBeNull();
  });

  it('returns null for a buffer with bad magic', () => {
    mockReadFileSync.mockReturnValue(Buffer.alloc(32));
    expect(parseMachOHeader('/x')).toBeNull();
  });

  it('parses a minimal valid Mach-O 64-bit header', () => {
    mockReadFileSync.mockReturnValue(macho64Header());
    const h = parseMachOHeader('/x');
    expect(h).not.toBeNull();
    expect(h?.cpuType).toBe(0x0100000c); // CPU_TYPE_X86_64
    expect(h?.fileType).toBe(2); // MH_EXECUTE
  });
});

describe('parseMachoSections', () => {
  it('returns [] when readFileSync throws', () => {
    mockReadFileSync.mockImplementation(() => {
      throw new Error('ENOENT');
    });
    expect(parseMachoSections('/nope')).toEqual([]);
  });

  it('returns [] for a non-Mach-O buffer', () => {
    mockReadFileSync.mockReturnValue(Buffer.alloc(32));
    expect(parseMachoSections('/x')).toEqual([]);
  });

  it('returns [] for a valid header with zero load commands', () => {
    mockReadFileSync.mockReturnValue(macho64Header());
    expect(parseMachoSections('/x')).toEqual([]);
  });
});

describe('parseMachOSymbols', () => {
  it('returns empty symbol table when readFileSync throws', () => {
    mockReadFileSync.mockImplementation(() => {
      throw new Error('ENOENT');
    });
    const r = parseMachOSymbols('/nope');
    expect(r.imports).toEqual([]);
    expect(r.exports).toEqual([]);
  });

  it('returns empty symbol table for a non-Mach-O buffer', () => {
    mockReadFileSync.mockReturnValue(Buffer.alloc(32));
    const r = parseMachOSymbols('/x');
    expect(r.imports).toEqual([]);
    expect(r.exports).toEqual([]);
  });
});
