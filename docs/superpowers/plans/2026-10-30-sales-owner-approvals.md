# Sales Owner Approvals Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development and independent final review.

**Goal:** Make the operator-selected prospecting flow work with Groq conversation, per-lead price approval and personal WhatsApp handoff.

**Architecture:** Preserve SQLite and WA-AKG. Distinguish operator authorization for one selected outreach cycle from recipient marketing consent. Keep conversation and approvals per lead, with deterministic approval execution and owner identity validation.

**Spec:** docs/superpowers/specs/2026-10-30-sales-owner-approvals.md

**Tech Stack:** Node ES modules, SQLite, browser JavaScript, Groq and existing WA-AKG transport.

## Constraints and review focus

- Explicit click Abordar authorizes only selected business leads; never manufacture opt-in or auto-start discovery contacts.
- 90-second persisted spacing; no retries for ambiguous delivery, no resend across restarts.
- Existing customers, owner, suppressed contacts and active human conversations excluded.
- Quote choices 350/550/1500 BRL, 50% entry and 50% delivery, minimum four days. Never auto-quote 550 or promise three days.
- Owner decisions require exact full phone + selected session; single-use approval, stale/context/expiry checks, forwarded tokens insufficient.
- All real tests only to already authorized personal number final7336; other contacts synthetic.
- MCP remains disabled. Production publication authorization persists from this session.

## Tasks

- [x] Operator-selected queue: failing tests, separate per-cycle operator authorization, UI select-all and no silent truncation, local greeting, continuous conversation eligibility after reply.
- [x] Price approvals: persistent per-lead requests, three choices + reject/handoff, native buttons and safe WhatsApp confirmation links, exact quote construction and one-time delivery.
- [x] Groq/handoff: intercept price before model quote, resume only valid follow-up, enrich interest notice with company/number/sourced links, isolate concurrent conversations.
- [x] Integrate owner webhook and timers, remove misleading UI copy and obsolete media use. Personal target configuration follows publication.
- [ ] End-to-end synthetic and Chrome tests, independent review, full suite and CI; publish and test owner interactions only at final7336.

Ruling: owner-selected contact is a persisted operator instruction, not consent. Automatic follow-up is limited to inbound replies in that selected cycle; no unanswered-contact chase.

Ruling: native WhatsApp buttons are attempted once; uncertain transports are never blindly retried. Confirmation links open a prefilled command that only the verified owner's message can execute.

Review: independent reviewer found model text could mention spelled-out money, 24-hour delivery or 100% upfront terms. Added failing examples and conservative output rejection; approved server-composed quotes remain the only source of commercial values/terms.
