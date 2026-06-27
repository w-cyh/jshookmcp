# Analysis Domain — Military-Grade Audit

**Score: 7.2/10** | Tools: 14 (manifest registers 25) | Platform: all

## Tools
- collect_code / search_in_scripts / extract_function_tree — code collection
- deobfuscate / webcrack_unpack / analysis_decode_string_array — deobfuscation
- js_analyze_vm / js_deobfuscate_jsvmp — JSVMP analysis
- js_deobfuscate_pipeline / js_solve_constraints — pipeline
- analysis_ast_match / analysis_deflat_control_flow — AST analysis
- js_symbolic_execute / js_symbolic_execute_jsvmp — symbolic execution
- detect_crypto / detect_obfuscation / understand_code — code understanding
- llm_suggest_names / ai_suggest_exploits — LLM integration
- manage_hooks / clear_collected_data / get_collection_stats — utilities

## Key Strengths
1. Unified Babel abstraction layer (ESM/CJS interop)
2. Protected-range replacement engine (dual-mode: AST + state-machine parser)
3. CFF AST unflattening with dispatcher reconstruction + scope binding
4. Three-stage pipeline with observable statistics
5. 10 obfuscation technique types detected with confidence scoring

## Top Gaps
1. [CRITICAL] No Z3/Manticore SMT solver — symbolic execution is heuristics-only
2. [HIGH] JSVMP symbolic executor "unwired" despite full implementation
3. [MED] JScrambler(257 lines) + Packer(239 lines) dead code — unregistered
4. [MED] Data flow + security analyzer exist but no user-facing tools
5. [LOW] Heuristic rename only, no semantic rename

## Round 1 修复结果 (2026-06-24)

| 修复项 | 状态 | 变更 |
|--------|------|------|
| A3: JScrambler(302行)/Packer(286行)/VM Deobfuscator(197行) dead code 激活 | ✅ | Engine 枚举扩展为 ['auto','webcrack','jscrambler','packer','vm']，三条代码路径全部激活 |

**修正评分**: 7.2 → 8.0/10
**Round 2 关联**: [[../research/final-report#四、差距项清单]] 中剩余缺口（Z3/Manticore SMT solver、JSVMP symbolic executor wiring、data flow 用户工具）+ [[../../military-grade-audit-fixes/requirements]] Tie2/3
