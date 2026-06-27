# Utility Domains — Military-Grade Audit (Batch)

**Score range: 5.0-7.5/10** | Tools: ~80 across 15 domains

## Individual Domain Scores

| Domain | Tools | Score | Summary |
|--------|-------|-------|---------|
| wasm | 12 | 7.5/10 | WebAssembly analysis tools, good binary parsing |
| graphql | 6 | 7.0/10 | GraphQL introspection + replay |
| coordination | 7 | 7.0/10 | Inter-agent coordination |
| workflow | 7 | 6.5/10 | Workflow execution engine |
| maintenance | 13 | 6.5/10 | System maintenance/health |
| encoding | 5 | 6.5/10 | Binary/base64/hex encoding |
| transform | 7 | 6.5/10 | Data transformation pipeline |
| streaming | 5 | 6.5/10 | Streaming data handling |
| cross-domain | 6 | 6.5/10 | Cross-domain correlation |
| sourcemap | 6 | 7.0/10 | Source map parsing |
| proxy | 8 | 6.5/10 | Proxy configuration/routing |
| mojo-ipc | 5 | 6.5/10 | Mojo IPC interceptor (Chromium) |
| extension-registry | 5 | 6.5/10 | Extension lifecycle management |
| antidebug | 2 | 5.0/10 | Anti-debug bypass (too few tools) |
| secrets | 1 | 3.0/10 | Secret management (minimal) |

## Common Strengths Across Utility Domains
- Clean manifest pattern compliance
- Type-safe arg parsing via parseArgs utilities
- handleSafe error wrapping

## Common Gaps Across Utility Domains
- Several are thin wrappers with minimal domain-specific logic
- Limited test coverage compared to core domains
- Some (mojo-ipc, streaming) appear to be integrations/externally-dependent
