/**
 * Tests for process hollowing detection
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock factories ──

const mockCompareMemoryWithDisk = vi.fn();
const mockOpenProcessForMemory = vi.fn();
const mockCloseHandle = vi.fn();
const mockEnumProcessModules = vi.fn();
const mockGetModuleFileNameEx = vi.fn();
const mockGetModuleInformation = vi.fn();
const mockReadProcessMemory = vi.fn();

vi.mock('@native/PEAnalyzer', () => {
  return {
    PEAnalyzer: class {
      compareMemoryWithDisk = mockCompareMemoryWithDisk;
    },
  };
});

vi.mock('@native/Win32API', () => ({
  openProcessForMemory: (...args: any[]) => mockOpenProcessForMemory(...args),
  CloseHandle: (...args: any[]) => mockCloseHandle(...args),
  EnumProcessModules: (...args: any[]) => mockEnumProcessModules(...args),
  GetModuleFileNameEx: (...args: any[]) => mockGetModuleFileNameEx(...args),
  GetModuleInformation: (...args: any[]) => mockGetModuleInformation(...args),
  ReadProcessMemory: (...args: any[]) => mockReadProcessMemory(...args),
}));

vi.mock('@utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { HollowingDetectionHandlers } from '@server/domains/process/handlers/hollowing-detection';

describe('HollowingDetectionHandlers', () => {
  let handlers: HollowingDetectionHandlers;

  beforeEach(() => {
    vi.clearAllMocks();

    mockOpenProcessForMemory.mockReturnValue(BigInt(0x1234));
    mockCloseHandle.mockImplementation(() => {});
    mockReadProcessMemory.mockReturnValue(Buffer.alloc(100));
    mockEnumProcessModules.mockReturnValue({
      success: true,
      modules: [BigInt(0x400000)],
      count: 1,
    });
    mockGetModuleFileNameEx.mockReturnValue('C:\\Windows\\System32\\notepad.exe');
    mockGetModuleInformation.mockReturnValue({
      success: true,
      info: {
        lpBaseOfDll: BigInt(0x400000),
        SizeOfImage: 0x100000,
        EntryPoint: BigInt(0x401000),
      },
    });

    handlers = new HollowingDetectionHandlers();
  });

  describe('handleDetectHollowing', () => {
    it('should detect normal (non-hollowed) process', async () => {
      mockCompareMemoryWithDisk.mockResolvedValue({
        isMatch: true,
        confidence: 100,
        differences: [],
      });

      const result = await handlers.handleDetectHollowing({ pid: 1234 });

      expect(result.success).toBe(true);
      expect(result.isHollowed).toBe(false);
      expect(result.confidence).toBe(100);
    });

    it('should detect hollowed process (hash mismatch)', async () => {
      mockCompareMemoryWithDisk.mockResolvedValue({
        isMatch: false,
        confidence: 45,
        differences: [
          {
            sectionName: '.text',
            offsetStart: 0x1000,
            offsetEnd: 0x50000,
            memoryHash: 'deadbeef...',
            diskHash: 'cafebabe...',
            bytesCompared: 0x4f000,
          },
        ],
      });

      const result = await handlers.handleDetectHollowing({ pid: 5678 });

      expect(result.success).toBe(true);
      expect(result.isHollowed).toBe(true);
      expect(result.confidence).toBe(45);
      expect(result.differences).toBeDefined();
      expect(result.differences).toHaveLength(1);
    });

    it('should return error when no modules found', async () => {
      mockEnumProcessModules.mockReturnValue({
        success: false,
        modules: [],
        count: 0,
      });

      const result = await handlers.handleDetectHollowing({ pid: 9999 });

      expect(result.success).toBe(false);
      expect(result.error).toContain('No modules found');
    });

    it('should return error when GetModuleFileNameEx fails', async () => {
      mockGetModuleFileNameEx.mockReturnValue(null);

      const result = await handlers.handleDetectHollowing({ pid: 1234 });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Failed to get module path');
    });
  });
});
