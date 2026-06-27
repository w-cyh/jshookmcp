# Network Domain — Military-Grade Audit

**Score: 9.5/10** | Tools: 33 | Platform: all

## Tools
- network_monitor / network_enable / network_disable / network_get_stats — monitoring
- network_get_requests / network_get_response_body / network_export_har / network_get_status — retrieval
- console_get_exceptions / console_inject / console_inject_fetch_interceptor / console_inject_xhr_interceptor — injection
- network_intercept / network_replay_request / network_extract_auth — interception/replay
- performance_get_metrics / performance_coverage / performance_take_heap_snapshot / performance_trace — performance
- profiler_cpu / profiler_heap_sampling — profiling
- http_request_build / http_plain_request / http2_probe / http2_frame_build — HTTP
- dns_resolve / dns_reverse / dns_probe / dns_cname_chain / dns_bulk_resolve — DNS
- network_rtt_measure / network_latency_stats / network_icmp_probe / network_traceroute — network
- network_tls_fingerprint — TLS
- network_bot_detect_analyze — bot detection

## Key Strengths
1. SSRF-aware replay engine (DNS pinning, private IP guard, authorization scoping, HTTP/2 path)
2. HAR 1.2 full export (concurrency-batched body collection, safe path writing)
3. TLS JA3-style fingerprint + HTTP fingerprint
4. 33 tools with role-based activation (RAW_NETWORK_TOOLS bypass browser requirement)
5. Defense-in-depth (10 test suites, EventBus, DDM smart truncation)

## Top Gaps
1. [HIGH] No WebSocket message capture
2. [HIGH] No Core Web Vitals attribution (per-element LCP/FID)
3. [MED] No pcap/pcapng export
4. [MED] No HTTP/3 (QUIC) active dissection
5. [MED] No application-layer protocol dissection (SQL/NoSQL/MQTT/Redis)
