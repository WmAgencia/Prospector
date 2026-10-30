# Prospector Functional Audit Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development for independent components and final code review.

**Goal:** Correct the ten audited defects, implement an authenticated MCP connection, and verify the application without real customer sends.

**Architecture:** Preserve SQLite, existing WA-AKG transport and operator approvals. Add focused regression tests and a bounded MCP interface using the existing OAuth store; keep all credentials server-side.

**Tech Stack:** Node.js ES modules, SQLite, browser JavaScript, Bun gateway.

**Spec:** The user requested the audited system be functional and tested before delivery; findings are documented in the chat audit.

## Global Constraints

- No real customer messages during testing, no fabricated consent, no automatic retry of ambiguous deliveries.
- Preserve documented opt-in, suppression, owner identity and explicit approval boundaries.
- Tests run against temporary storage and simulated providers; live checks read only.
- Use a feature branch; production deployment must be reported truthfully and verified separately.

## Review Focus

- Session selected but absent must never appear connected through another identity.
- Slow model or transport activity must not override newer inbound or human takeover.
- New authorized outreach cycle must reset only safe prior state, never uncertain sends.
- Authentication must isolate browser sessions and OAuth grants; anonymous writes denied.
- Partial deliveries must retain history without retrying accepted text.

## Tasks

- [x] UI and data: reproduce and fix audio validation, customer labeling, missing-field enrichment and commercial outcome transitions.
- [x] Messaging: reproduce and fix session identity, introduction recontact, stale qualification and partial delivery history. Preview now shares recontact eligibility and calendar month-end boundaries.
- [x] MCP: implement OAuth discovery/registration/PKCE approval/token and authenticated JSON-RPC tools, with temporary HTTP integration tests and operator documentation.
- [x] Gateway: reproduce and fix backend cookie expiry/rotation recovery and proxy MCP headers/routes.
- [x] Run full test suite, syntax and HTTP smoke; independent final review. 266 tests pass; Chrome smoke passed without real sends.
- [x] Prepare reviewable GitHub delivery and obtain production publication approval. PR #59; user approved production and the owned-phone test.
- [ ] Deploy backend/gateway, configure MCP, verify one authorized text/audio attempt and report provider results separately from phone confirmation.

Ruling: MCP outbound access uses a separate optional OAuth scope plus explicit per-call approval and existing documented consent gates; no arbitrary owner impersonation or removal of delivery safeguards.

Ruling: Production publication remains a final approval step because it changes the running service and exposes a newly authenticated integration; all code and verification are prepared first.
