# Analysis Domain Audit Report

**Score: 7.2/10**

## Tool Inventory (14 tools)
| # | Tool Name | Primary Dependency |
|---|-----------|-------------------|
| 1 | collect_code | CodeCollector (CDP/Playwright) |
| 2 | search_in_scripts | ScriptManager |
| 3 | extract_function_tree | ScriptManager |
| 4 | deobfuscate | Deobfuscator + AdvancedDeobfuscator |
| 5 | understand_code | CodeAnalyzer (LLM-assisted) |
| 6 | detect_crypto | CryptoDetector |
| 7 | manage_hooks | HookManager |
| 8 | detect_obfuscation | ObfuscationDetector |
| 9 | webcrack_unpack | webcrack (npm) |
| 10 | clear_collected_data | CodeCollector + ScriptManager |
| 11 | get_collection_stats | CodeCollector |
| 12 | webpack_enumerate | CodeCollector + inline injection |
| 13 | llm_suggest_names | LLMDeobfuscator + MCP sampling |
| 14 | js_deobfuscate_jsvmp | JSVMPDeobfuscator |
| 15 | js_deobfuscate_pipeline | inline-deobfuscation.ts + webcrack |
| 16 | js_analyze_vm | JSVMPDeobfuscator + vm-analysis.ts |
| 17 | js_solve_constraints | solve-constraints.ts |
| 18 | analysis_ast_match | Babel parser/traverse/generate |
| 19 | analysis_deflat_control_flow | Babel AST CFF detection + flattening |
| 20 | analysis_decode_string_array | AdvancedDeobfuscator.ast.ts |
| 21 | js_symbolic_execute | SymbolicExecutor |
| 22 | js_symbolic_execute_jsvmp | JSVMPSymbolicExecutor |
| 23 | ai_suggest_exploits | LLM sampling bridge |

## Category Scores
| Category | Score | Notes |
|----------|-------|-------|
| Collection & Search | 9/10 | Smart modes, size guards, compression |
| Generic Deobfuscation | 8/10 | Webcrack integration, CFF unflattening |
| JSVMP Deobfuscation | 7/10 | Detection good, symbolic execution unwired |
| AST Analysis | 9/10 | Protected-range replacement, CFF AST unflattening |
| Symbolic Execution | 4/10 | Regex-based, no SMT solver |
| Crypto/Obfuscation Detection | 9/10 | Keyword + AST hybrid, 10 obfuscation types |
| Pipeline Orchestration | 7/10 | Observable 3-stage pipeline |
| Hook Management | 8/10 | Full CRUD, 6 types × 3 actions |

## Top 5 Gaps
1. [HIGH] No Z3/Manticore SMT solver — symbolic execution is heuristics-only
2. [HIGH] JSVMP symbolic executor "unwired" despite full implementation
3. [MED] JScrambler/Packer dead code (257+239 lines, unregistered)
4. [MED] Data flow + security analyzer exist but no user-facing tools
5. [LOW-MED] Heuristic rename only, no semantic rename

## Key Strengths
1. Unified Babel abstraction (ESM/CJS interop)
2. Protected-range replacement engine (state-machine parser)
3. CFF AST dispatcher reconstruction with scope binding analysis
4. Three-stage pipeline with observable statistics
5. LLM integration with graceful degradation
