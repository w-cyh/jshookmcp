import type { UnifiedProcessManager } from '@server/domains/shared/modules/native';
import type { MCPServerContext } from '@server/MCPServer.context';
import { resolvePidOrAttachedRenderer } from '@server/runtime/renderer-pid';

export async function resolveMemoryDomainPid(
  pid: unknown,
  processManager: UnifiedProcessManager,
  ctx?: MCPServerContext | null,
): Promise<number> {
  return await resolvePidOrAttachedRenderer(pid, processManager, ctx);
}
