import { NullIndirectCallError } from '@modules/native-emulator/CpuEngine';
import type { EmulatorSession } from '@modules/native-emulator/SessionManager';
import { R } from '@server/domains/shared/ResponseBuilder';
import type { ToolResponse } from '@server/types';

export function nativeDiagnostics(session: EmulatorSession): Record<string, unknown> {
  return {
    unresolvedImports: [...session.emulator.engine.unresolvedImports()],
    constructorFaults: [...session.emulator.engine.constructorFaultLog()],
  };
}

export function nativeCallFailure(
  error: unknown,
  session: EmulatorSession | undefined,
  symbol: string,
  phase: 'call_symbol' | 'call_jni_export',
): ToolResponse {
  const message = error instanceof Error ? error.message : String(error);
  const payload: Record<string, unknown> = {
    ...(session ? { sessionId: session.id } : {}),
    ...(symbol ? { symbol } : {}),
  };
  if (session) {
    payload.diagnostics = nativeDiagnostics(session);
  }
  if (error instanceof NullIndirectCallError) {
    payload.fault = {
      kind: 'null-indirect-call',
      phase,
      message,
    };
  }
  return R.fail(error).merge(payload).json();
}
