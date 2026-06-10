import { describe, expect, it } from 'vitest';
import { deflateSync } from 'node:zlib';

import { BINARY_MAGIC_HINTS } from '@src/config/binary-magic';
import { runTransformWorkbench } from '@modules/transform/workbench';

describe('transform workbench', () => {
  it('detects generic binary magic through the config table', () => {
    const labels = BINARY_MAGIC_HINTS.map((hint) => hint.label);

    expect(labels.toSorted()).toEqual(['cdex', 'dex', 'elf', 'gzip', 'zip']);
    const elfPrefix = BINARY_MAGIC_HINTS.find((hint) => hint.label === 'elf')?.prefix;
    expect(elfPrefix).toBeDefined();

    const result = runTransformWorkbench({
      inputBase64: Buffer.from([...(elfPrefix ?? []), 0x02, 0x01]).toString('base64'),
      steps: [{ op: 'entropy' }],
      includeOutputBase64: false,
    });

    expect(result.output.magicHints).toContain('elf');
  });

  it('omits full output bytes by default', () => {
    const result = runTransformWorkbench({
      inputBase64: Buffer.from('hello').toString('base64'),
      steps: [{ op: 'entropy' }],
    });

    expect(result.output.base64).toBeUndefined();
    expect(result.output.base64Omitted).toBe(true);
  });

  it('rejects oversized input, too many steps, and oversized inflate output', () => {
    expect(() =>
      runTransformWorkbench({
        inputBase64: Buffer.from('hello').toString('base64'),
        steps: [{ op: 'entropy' }],
        maxInputBytes: 4,
      }),
    ).toThrow(/input.*too large/i);

    expect(() =>
      runTransformWorkbench({
        inputBase64: Buffer.from('hello').toString('base64'),
        steps: [{ op: 'entropy' }, { op: 'entropy' }],
        maxSteps: 1,
      }),
    ).toThrow(/too many transform steps/i);

    expect(() =>
      runTransformWorkbench({
        inputBase64: deflateSync(Buffer.from('hello')).toString('base64'),
        steps: [{ op: 'zlib_inflate' }],
        maxOutputBytes: 4,
      }),
    ).toThrow(/output.*too large/i);
  });
});
