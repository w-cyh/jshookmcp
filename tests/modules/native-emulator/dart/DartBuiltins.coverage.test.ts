/**
 * Coverage tests for DartBuiltins — registry lookups, registration, dispatch.
 * Builtins are functions (args: bigint[], ctx) => bigint.
 */

import { afterEach, describe, expect, it } from 'vitest';
import {
  DART_BUILTINS,
  callDartBuiltin,
  getBuiltinNames,
  hasBuiltin,
  registerBuiltin,
  unregisterBuiltin,
} from '@modules/native-emulator/dart/DartBuiltins';

const TEST = '__test_stub';
const added: string[] = [];

afterEach(() => {
  for (const name of added) unregisterBuiltin(name);
  added.length = 0;
});

describe('DartBuiltins — registry queries', () => {
  it('DART_BUILTINS is a non-empty record', () => {
    expect(Object.keys(DART_BUILTINS).length).toBeGreaterThan(0);
  });

  it('hasBuiltin returns true for a known name, false for unknown', () => {
    const known = getBuiltinNames()[0]!;
    expect(hasBuiltin(known)).toBe(true);
    expect(hasBuiltin('__definitely_not_a_builtin__')).toBe(false);
  });

  it('getBuiltinNames returns an array of strings', () => {
    const names = getBuiltinNames();
    expect(Array.isArray(names)).toBe(true);
    expect(names.every((n) => typeof n === 'string')).toBe(true);
  });
});

describe('DartBuiltins — register / unregister', () => {
  it('registerBuiltin adds a callable stub + hasBuiltin sees it', () => {
    registerBuiltin(TEST, (() => 42n) as never);
    added.push(TEST);
    expect(hasBuiltin(TEST)).toBe(true);
  });

  it('unregisterBuiltin removes the stub + returns true; false if absent', () => {
    registerBuiltin(TEST, (() => 0n) as never);
    expect(unregisterBuiltin(TEST)).toBe(true);
    expect(unregisterBuiltin(TEST)).toBe(false); // already removed
    expect(hasBuiltin(TEST)).toBe(false);
  });
});

describe('callDartBuiltin — dispatch', () => {
  it('returns the stub result for a registered builtin', () => {
    registerBuiltin(TEST, ((args: bigint[]) => args[0]! + args[1]!) as never);
    added.push(TEST);
    expect(callDartBuiltin(TEST, [1n, 2n], {} as never)).toBe(3n);
  });

  it('returns undefined for an unknown builtin', () => {
    expect(callDartBuiltin('__nope__', [], {} as never)).toBeUndefined();
  });

  it('returns 0n when the stub throws (fail-soft)', () => {
    registerBuiltin(TEST, (() => {
      throw new Error('boom');
    }) as never);
    added.push(TEST);
    expect(callDartBuiltin(TEST, [], {} as never)).toBe(0n);
  });
});
