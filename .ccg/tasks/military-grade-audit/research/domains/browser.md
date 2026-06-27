# Browser Domain — Military-Grade Audit

**Score: 8.7/10** | Tools: ~60 | Platform: all (requires browser)

## Tools
- browser_launch / browser_attach / browser_close / browser_status — lifecycle
- browser_list_tabs / browser_select_tab / browser_list_cdp_targets — tab management
- browser_attach_cdp_target / browser_detach_cdp_target / browser_evaluate_cdp_target — CDP targets
- page_navigate / page_reload / page_back / page_forward — navigation
- page_click / page_type / page_scroll / page_hover / page_select / page_upload_files / page_press_key — interaction
- page_screenshot / page_evaluate / page_inject_script — evaluation
- page_cookies / page_local_storage / page_session_storage — storage
- page_set_viewport / page_emulate_device / page_wait_for_selector — configuration
- get_all_scripts / get_script_source / page_list_frames — script inspection
- console_monitor / console_get_logs / console_execute — console
- stealth_inject / stealth_set_user_agent / stealth_configure_jitter / stealth_generate_fingerprint / stealth_verify — stealth
- human_mouse / human_scroll / human_typing — human simulation
- captcha_detect / captcha_wait / captcha_config / captcha_vision_solve / widget_challenge_solve — captcha
- framework_state_extract / indexeddb_dump / js_heap_search — advanced
- tab_workflow / browser_codegen_start / browser_codegen_stop — workflow
- browser_passkey_seed — WebAuthn

## Key Strengths
1. Bezier-curve mouse simulation (cubic Bezier + perpendicular offset, 4 easing modes)
2. Framework state extraction (React fiber traversal, Vue 3, Svelte, Solid, Preact)
3. Dual-engine stealth architecture (Chrome CDP + Camoufox Playwright, 11 patch vectors)
4. Multi-provider captcha orchestration (2captcha, Anti-Captcha, CapSolver)
5. 22 handler classes with clean facade pattern

## Top Gaps
1. [HIGH] Angular state extraction not implemented
2. [HIGH] CDP Fetch domain network interception absent from browser domain
3. [MED] Chrome evaluate path unsandboxed
4. [MED] No script blocking API (DOMDebugger.setBreakpoint)
5. [LOW] No JS/CSS coverage API


## Round 1 修复结果 (2026-06-24)

| 修复项 | 状态 | 变更 |
|--------|------|------|
| B3: Angular state extraction added | ✅ | 新增 extractAngular 方法，支持 __ngContext__/window.ng/[ng-version] 检测；framework_state_extract 的 auto 模式已集成 Angular 路径 |

**修正评分**: 8.7 -> 8.9/10
**Round 2 关联**: [[../research/final-report#四、差距项清单]] 中剩余缺口 + [[../../military-grade-audit-fixes/requirements]] Tie2/3
