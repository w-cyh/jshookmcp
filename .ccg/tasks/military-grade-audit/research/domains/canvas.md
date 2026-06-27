# Canvas Domain — Military-Grade Audit

**Score: 7.0/10** | Tools: 4 (+3 Skia sub-domain) | Platform: all

## Tools
- canvas_engine_fingerprint — layered detection (global anchors + canvas scan + RAF evidence)
- canvas_scene_dump — scene tree dump (engine adapter dispatch)
- canvas_pick_object_at_point — coordinate picking (engine hit-test)
- canvas_trace_click_handler — click event → JS call stack tracing
- skia_detect_renderer / skia_extract_scene / skia_correlate_objects — Skia sub-domain (3 tools)

## Key Strengths
1. 4 engine adapters (Pixi/Phaser/Cocos/Laya)
2. 3-layer fingerprint detection
3. Skia GPU backend detection + V8 heap correlation

## Top Gaps
1. [HIGH] No WebGL shader extraction or SPIR-V disassembly
2. [HIGH] Stub fallback on undetected engines (returns createStub() with partial completeness)
3. [MED] No standard scene export format (glTF/USD)
4. [MED] Cross-domain coupling to ReverseEvidenceGraph (no manifest dependency)
5. [LOW] canvas_trace_click_handler requires debugger_lifecycle(enable) — undocumented prerequisite
