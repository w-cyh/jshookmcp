import { inflateSync } from 'node:zlib';
import {
  matchBinaryMagicHints,
  resolveBinaryMagicHints,
  type BinaryMagicHintInput,
} from '@src/config/binary-magic';
import { getReverseEngineeringConfig } from '@utils/reverseEngineeringConfig';

export interface TransformWorkbenchStep {
  op: string;
  key?: string;
  keyHex?: string;
}

export interface TransformWorkbenchOptions {
  inputBase64: string;
  steps: TransformWorkbenchStep[];
  previewBytes?: number;
  includeOutputBase64?: boolean;
  customMagicHints?: BinaryMagicHintInput[];
  maxInputBytes?: number;
  maxOutputBytes?: number;
  maxSteps?: number;
}

export interface TransformWorkbenchResult {
  success: true;
  input: BufferMetrics;
  steps: TransformWorkbenchStepResult[];
  output: BufferMetrics & {
    base64?: string;
    base64Omitted?: true;
    hexPreview: string;
    asciiPreview: string;
    magicHints: string[];
  };
}

interface TransformWorkbenchStepResult {
  op: string;
  before: BufferMetrics;
  after: BufferMetrics;
  changed: boolean;
}

interface BufferMetrics {
  size: number;
  entropy: number;
  printableRatio: number;
}

export function runTransformWorkbench(
  options: TransformWorkbenchOptions,
): TransformWorkbenchResult {
  if (!Array.isArray(options.steps) || options.steps.length === 0) {
    throw new Error('steps must contain at least one transform step');
  }
  const config = getReverseEngineeringConfig().transformWorkbench;
  const previewBytes = Math.max(
    1,
    Math.min(
      Math.floor(options.previewBytes ?? config.defaultPreviewBytes),
      config.maxPreviewBytes,
    ),
  );
  const maxInputBytes = boundedLimit(options.maxInputBytes, config.maxInputBytes);
  const maxOutputBytes = boundedLimit(options.maxOutputBytes, config.maxOutputBytes);
  const maxSteps = boundedLimit(options.maxSteps, config.maxSteps);
  if (options.steps.length > maxSteps) {
    throw new Error(
      `Too many transform steps: ${options.steps.length} > ${maxSteps}. Split the transform into smaller workbench calls.`,
    );
  }
  if (estimatedBase64DecodedBytes(options.inputBase64) > maxInputBytes) {
    throw new Error(`Transform workbench input is too large: exceeds ${maxInputBytes} bytes`);
  }
  const includeOutputBase64 = options.includeOutputBase64 ?? false;
  let current: Buffer<ArrayBufferLike> = Buffer.from(options.inputBase64, 'base64');
  ensureBufferWithinLimit(current, maxInputBytes, 'input');
  const input = metrics(current);
  const results: TransformWorkbenchStepResult[] = [];

  for (const rawStep of options.steps) {
    const step = normalizeStep(rawStep);
    const beforeBuffer = current;
    const before = metrics(beforeBuffer);
    current = applyStep(beforeBuffer, step, maxOutputBytes);
    ensureBufferWithinLimit(current, maxOutputBytes, 'output');
    const after = metrics(current);
    results.push({
      op: step.op,
      before,
      after,
      changed: !beforeBuffer.equals(current),
    });
  }

  return {
    success: true,
    input,
    steps: results,
    output: {
      ...metrics(current),
      ...(includeOutputBase64
        ? { base64: current.toString('base64') }
        : { base64Omitted: true as const }),
      hexPreview: current.subarray(0, previewBytes).toString('hex'),
      asciiPreview: asciiPreview(current, previewBytes),
      magicHints: detectMagicHints(current, config.textSampleBytes, options.customMagicHints),
    },
  };
}

function normalizeStep(step: TransformWorkbenchStep): TransformWorkbenchStep {
  if (!step || typeof step !== 'object') throw new Error('Each step must be an object');
  const op = typeof step.op === 'string' ? step.op.trim() : '';
  if (!op) throw new Error('step.op is required');
  return {
    op,
    ...(typeof step.key === 'string' ? { key: step.key } : {}),
    ...(typeof step.keyHex === 'string' ? { keyHex: step.keyHex } : {}),
  };
}

function applyStep(buffer: Buffer, step: TransformWorkbenchStep, maxOutputBytes: number): Buffer {
  switch (step.op) {
    case 'base64_decode':
      return Buffer.from(buffer.toString('utf8').trim(), 'base64');
    case 'base64_encode':
      return Buffer.from(buffer.toString('base64'), 'utf8');
    case 'xor':
      return xor(buffer, readKey(step));
    case 'rc4':
      return rc4(buffer, readKey(step));
    case 'zlib_inflate':
      try {
        return inflateSync(buffer, { maxOutputLength: maxOutputBytes });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (/larger than|maxOutputLength|unexpected end/i.test(message)) {
          throw new Error(
            `Transform workbench output is too large: exceeds ${maxOutputBytes} bytes`,
            { cause: error },
          );
        }
        throw error;
      }
    case 'entropy':
      return buffer;
    default:
      throw new Error(`Unsupported transform workbench op: ${step.op}`);
  }
}

function boundedLimit(value: number | undefined, hardLimit: number): number {
  if (value === undefined || !Number.isFinite(value)) return hardLimit;
  return Math.max(1, Math.min(Math.floor(value), hardLimit));
}

function ensureBufferWithinLimit(buffer: Buffer, limit: number, label: string): void {
  if (buffer.length > limit) {
    throw new Error(`Transform workbench ${label} is too large: ${buffer.length} > ${limit} bytes`);
  }
}

function estimatedBase64DecodedBytes(value: string): number {
  const normalized = value.replace(/\s+/g, '');
  if (normalized.length === 0) return 0;
  const padding = normalized.endsWith('==') ? 2 : normalized.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((normalized.length * 3) / 4) - padding);
}

function readKey(step: TransformWorkbenchStep): Buffer {
  if (step.keyHex) {
    const normalized = step.keyHex.replace(/\s+/g, '');
    if (!/^(?:[0-9a-fA-F]{2})+$/.test(normalized)) {
      throw new Error(`${step.op} keyHex must contain an even number of hex bytes`);
    }
    return Buffer.from(normalized, 'hex');
  }
  if (step.key) return Buffer.from(step.key, 'utf8');
  throw new Error(`${step.op} requires key or keyHex`);
}

function xor(buffer: Buffer, key: Buffer): Buffer {
  if (key.length === 0) throw new Error('xor key cannot be empty');
  const out = Buffer.allocUnsafe(buffer.length);
  for (let index = 0; index < buffer.length; index++) {
    out[index] = buffer[index]! ^ key[index % key.length]!;
  }
  return out;
}

function rc4(buffer: Buffer, key: Buffer): Buffer {
  if (key.length === 0) throw new Error('rc4 key cannot be empty');
  const s = Array.from({ length: 256 }, (_v, index) => index);
  let j = 0;
  for (let i = 0; i < 256; i++) {
    j = (j + s[i]! + key[i % key.length]!) & 0xff;
    [s[i], s[j]] = [s[j]!, s[i]!];
  }
  const out = Buffer.alloc(buffer.length);
  let i = 0;
  j = 0;
  for (let n = 0; n < buffer.length; n++) {
    i = (i + 1) & 0xff;
    j = (j + s[i]!) & 0xff;
    [s[i], s[j]] = [s[j]!, s[i]!];
    const k = s[(s[i]! + s[j]!) & 0xff]!;
    out[n] = buffer[n]! ^ k;
  }
  return out;
}

function metrics(buffer: Buffer): BufferMetrics {
  if (buffer.length === 0) return { size: 0, entropy: 0, printableRatio: 0 };
  const counts = Array.from({ length: 256 }, () => 0);
  let printable = 0;
  for (const byte of buffer) {
    counts[byte] = (counts[byte] ?? 0) + 1;
    if (byte >= 0x20 && byte <= 0x7e) printable += 1;
  }
  let entropy = 0;
  for (const count of counts) {
    if (count === 0) continue;
    const p = count / buffer.length;
    entropy -= p * Math.log2(p);
  }
  return {
    size: buffer.length,
    entropy: Number(entropy.toFixed(4)),
    printableRatio: Number((printable / buffer.length).toFixed(4)),
  };
}

function asciiPreview(buffer: Buffer, previewBytes: number): string {
  return buffer
    .subarray(0, previewBytes)
    .toString('latin1')
    .replace(/[^\x20-\x7e]/g, '.');
}

function detectMagicHints(
  buffer: Buffer,
  textSampleBytes: number,
  customMagicHints?: BinaryMagicHintInput[],
): string[] {
  const hints = matchBinaryMagicHints(buffer, resolveBinaryMagicHints(customMagicHints));
  const text = asciiPreview(buffer, Math.min(buffer.length, 256)).trim();
  const textSample = buffer
    .subarray(0, Math.min(buffer.length, textSampleBytes))
    .toString('latin1');
  if (/^[\x20-\x7e\r\n\t]+$/.test(textSample) && text.length > 0) {
    hints.push('text');
  }
  if (text.startsWith('{') || text.startsWith('[')) hints.push('json');
  return [...new Set(hints)];
}
