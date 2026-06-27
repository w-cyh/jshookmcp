# Instrumentation Domain — Military-Grade Audit

**Score: 9.0/10** | Tools: 10 (+hooks +evidence) | Platform: all

## Tools
- instrumentation_session / instrumentation_operation / instrumentation_artifact — session/artifact management
- instrumentation_hook_preset / ai_hook / hook_preset — 20+ curated hook presets
- instrumentation_network_replay — network replay within session
- evidence_query / evidence_export / evidence_chain — ReverseEvidenceGraph

## Key Strengths
1. Session-scoped instrumentation with lifecycle management
2. 20+ curated presets (core + security categories)
3. ReverseEvidenceGraph with provenance chains (unique differentiator)
4. AI-powered hook injection

## Top Gaps
1. [HIGH] No native ARM/x64 inline hooking (pure JS injection via CDP evaluate)
2. [MED] Evidence graph has no TTL or size limits — unbounded growth risk
3. [LOW] No cross-session evidence correlation
