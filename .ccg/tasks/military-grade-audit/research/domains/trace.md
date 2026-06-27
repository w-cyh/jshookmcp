# Trace Domain — Military-Grade Audit

**Score: 9.0/10** | Tools: 9 | Platform: all

## Tools
- trace_recording / start_trace_recording / stop_trace_recording — recording lifecycle
- query_trace_sql — SQL query over recorded trace data
- seek_to_timestamp — time-travel seek to specific trace timestamp
- trace_get_network_flow — request-scoped flow with chunk timing
- diff_heap_snapshots — V8 heap snapshot diff (added/removed/changed objects)
- export_trace — Chrome Trace JSON export
- summarize_trace — AI-powered trace summarization

## Key Strengths
1. SQLite backend enables forensic-grade querying
2. Dual time-domain support (wall/monotonic) — unusual and valuable
3. AI-powered trace summarization via LLM sampling
4. Structured heap diff with object counts

## Top Gaps
1. [MED] No reverse execution (forward-only seek from recording)
2. [MED] No syscall correlation integration (trace + syscall events in separate domains)
3. [LOW] No unified timeline across domains
