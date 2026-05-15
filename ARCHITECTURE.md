# ARCHITECTURE.md — PLATPHORM

*The architectural identity of the platform itself. This is PLATPHORM's own DNA.*

---

## Architectural Identity (Software DNA)

**System:** PLATPHORM
**Purpose:** AI-Native Engineering Operating System — govern, validate, orchestrate, secure, and preserve software integrity at scale.

**Always does:**
- Passes every AI request through 10 intelligence layers before execution
- Preserves architectural coherence above implementation speed
- Validates all generated code before applying to codebase
- Maintains immutable audit logs of all governance events
- Treats all AI outputs as untrusted until validated
- Routes tasks to role-appropriate AI models
- Exposes human override points for every critical decision

**Never does:**
- Executes generated code without governance pipeline approval
- Stores API keys in source code (env-only)
- Imports from nonexistent packages
- Calls AI provider SDKs directly outside the provider abstraction layer
- Creates duplicate governance systems
- Bypasses locked systems without explicit user approval

**Hard boundaries:**
- Provider SDKs are never called directly — all calls route through AIOrchestrator
- AI-generated outputs are presumed unsafe until all 10 layers pass
- Secrets never enter source control
- Governance events are append-only (immutable)

---

## System Laws

1. All new logic communicates through the Intent Layer only
2. No direct Action Layer mutations without pipeline approval
3. No duplicated AI provider integrations
4. No hardcoded secrets or API keys
5. No business logic inside UI components
6. All external AI calls require typed validation
7. All async flows require error boundaries
8. All state mutations must be traceable (Zustand only)
9. No hidden side effects in intelligence layers
10. No placeholder or simulated production logic
11. Context Locking — no new state patterns without approval
12. Scope Containment — no feature scope expansion beyond intent
13. Abstraction Governance — no abstraction unless reused 3+ times
14. AI Output Distrust — all generated code presumed incomplete until validated
15. Provider Abstraction — never call provider SDKs outside AIOrchestrator
16. Paranoid Security Default — zero trust, least privilege, encrypted everything
17. Runtime Validation — never auto-execute AI-generated actions without governance

---

## Locked Systems

- **AIOrchestrator** [LOCKED] — Central AI routing; never bypass or duplicate
- **Pipeline** [LOCKED] — 10-layer governance; never skip layers
- **GovernanceEngine** [LOCKED] — Audit logs are immutable; no deletion
- **DNAEngine** [LOCKED] — Project DNA is source of truth; no direct mutation
- **Provider Abstraction Layer** [LOCKED] — All AI calls through this layer only

---

## Provider Abstraction Map

| Provider Interface | Current Implementations | Never Call Directly |
|---|---|---|
| AIProviderInterface | OpenRouterProvider, AnthropicProvider, OpenAIProvider | SDK directly |
| AIOrchestrator | Routes by role, handles fallback | — |

---

## Folder Structure

```
electron/
  main/       — Electron main process, IPC handlers, file system access
  preload/    — Secure bridge between main and renderer (contextBridge)

src/
  types/      — All TypeScript interfaces and contracts (no implementation)
  core/
    providers/    — AI provider abstraction layer (LOCKED)
    intelligence/ — 10-layer pipeline (LOCKED)
    dna/          — Software DNA engine (LOCKED)
    governance/   — Governance engine, audit logs (LOCKED)
  store/      — Zustand stores (one per domain)
  components/
    editor/       — Monaco editor + AI overlay
    governance/   — DNA panel, security panel
    intelligence/ — Pipeline panel
    layout/       — Sidebar, TopBar, StatusBar
    settings/     — API key management
```

---

## ADR-001: Electron over Web

**Decision:** Desktop Electron app, not web-based
**Reason:** Full filesystem access required for DNA analysis, ARCHITECTURE.md management, and codebase reading without CORS restrictions
**Status:** LOCKED

## ADR-002: OpenRouter as primary AI gateway

**Decision:** OpenRouter as default provider with direct provider fallbacks
**Reason:** Single API key grants access to all major models; model-agnostic architecture preserved via AIOrchestrator abstraction
**Status:** LOCKED

## ADR-003: Zustand for all state management

**Decision:** Zustand, no Redux, no Context for global state
**Reason:** Lower boilerplate, simpler async, better modularity, explicit store boundaries per domain
**Status:** LOCKED

## ADR-004: 10-layer pipeline is non-negotiable

**Decision:** All AI-generated code passes through all 10 intelligence layers
**Reason:** Generated code presumed unsafe until validated by Intent, Architecture, Security, Dependency, Performance, Continuity, Validation, Execution, Observability, and Self-Critique layers
**Status:** LOCKED — never skip layers, never auto-execute without approval

## ADR-005: Monaco Editor for code editing

**Decision:** Monaco Editor (the VS Code engine) for code editing
**Reason:** Full language server support, proven at scale, TypeScript-native
**Status:** LOCKED

---

## Security Requirements

- All API keys stored in `.env.local` only (gitignored)
- No keys ever in source control
- Electron contextIsolation enabled — preload bridge only
- AI outputs never auto-executed — require explicit pipeline approval + user confirmation
- Audit logs append-only via GovernanceEngine
- Zero trust between intelligence layers

---

## Forbidden Patterns

- Direct provider SDK calls outside AIOrchestrator
- Skipping pipeline layers
- Auto-executing AI-generated code
- Hardcoded API keys
- Business logic in UI components
- New state management patterns (Zustand only)
- Untyped API responses
- Silent async failures
- Placeholder logic in production paths
- Duplicate AI provider implementations
