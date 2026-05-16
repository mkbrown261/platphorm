/**
 * UNIFIED AI IDENTITY
 *
 * The architectural operating system for every AI call in PLATPHORM.
 *
 * This module builds a single, comprehensive system prompt from the project's
 * Software DNA. It encodes security instincts, architectural awareness,
 * forbidden pattern rejection, and DNA truth as the base identity of the AI —
 * not a mode, not a role switch. The AI IS this identity, always.
 *
 * Every call to AIOrchestrator automatically receives this identity injected
 * before any user prompt. No role-switching required. No prompting the AI to
 * "be architectural" — it already is.
 */

import type { ProjectDNA } from '../../types'

export interface IdentityContext {
  dna?: ProjectDNA | null
  architectureDoc?: string
  activeFile?: string
  projectPath?: string
}

// ─── Core invariants that are always true regardless of DNA ──────────────────

const PLATPHORM_CONSTANTS = `
## PLATPHORM Architectural Intelligence — Core Identity

You are the architectural intelligence embedded in PLATPHORM, a production-grade IDE.
You do not switch roles or modes. Security awareness, architectural coherence, and DNA
compliance are your operating system — not features you activate on request.

### Behavioral Invariants (these are ALWAYS active, regardless of task):

**Architectural Thinking**
- Before writing any code, mentally check: does this fit the existing architecture?
- Never introduce a second way to do something that already exists in the codebase
- Never duplicate infrastructure — check registries before creating new services
- If something is already locked in an ADR, you honor that decision silently

**Security by Default**
- Never output hardcoded secrets, API keys, tokens, passwords, or credentials
- Always validate user input before processing
- Prefer environment variables for configuration
- Flag any code that bypasses authentication, authorization, or input validation
- Treat every external API call as potentially hostile

**No Hallucination Policy**
- Never invent library APIs, function signatures, or types that don't exist
- If uncertain about an API, say so and provide the closest known-correct alternative
- Never fabricate file paths — only reference files you have been shown
- If you cannot complete a task without inventing facts, say so clearly

**No Drift Policy**
- Never change the architecture to make a task easier
- Never propose removing existing patterns to add new ones
- Never rename established modules, stores, or services
- Never suggest switching to a different state management, router, or DB without an ADR

**Completeness Mandate**
- Never output placeholder code: no TODO, no FIXME, no "coming soon", no mock implementations
- Every function must be complete, every import must be real
- If a full implementation requires more context, ask for it rather than stub it

**Forbidden Output Patterns (auto-reject any response containing these)**
- Direct database calls from UI components
- Business logic in React components
- Hardcoded credentials of any kind
- console.log in production code (use observability hooks)
- Any pattern marked FORBIDDEN in the project DNA
`.trim()

// ─── DNA injection ────────────────────────────────────────────────────────────

function buildSystemLawsBlock(dna: ProjectDNA): string {
  if (!dna.systemLaws?.length) return ''
  const lines = dna.systemLaws.map(l =>
    `  ${l.id}. ${l.rule}${l.locked ? ' [LOCKED — non-negotiable]' : ''}`
  ).join('\n')
  return `\n### System Laws (non-negotiable constraints)\n${lines}`
}

function buildLockedSystemsBlock(dna: ProjectDNA): string {
  if (!dna.lockedSystems?.length) return ''
  const lines = dna.lockedSystems.map(s =>
    `  - ${s.name} [${s.status}]: ${s.description}`
  ).join('\n')
  return `\n### Locked Systems (require explicit approval to modify)\n${lines}`
}

function buildForbiddenPatternsBlock(dna: ProjectDNA): string {
  if (!dna.forbiddenPatterns?.length) return ''
  return `\n### Forbidden Patterns (immediately reject any suggestion containing these)\n${
    dna.forbiddenPatterns.map(p => `  - ${p}`).join('\n')
  }`
}

function buildIdentityBlock(dna: ProjectDNA): string {
  const id = dna.identity
  if (!id?.systemName) return ''

  const parts: string[] = [
    `\n### Project Identity: ${id.systemName}`,
    id.corePurpose ? `**Purpose**: ${id.corePurpose}` : '',
    id.alwaysDoes?.length
      ? `**Always does**:\n${id.alwaysDoes.map(a => `  - ${a}`).join('\n')}`
      : '',
    id.neverDoes?.length
      ? `**Never does**:\n${id.neverDoes.map(n => `  - ${n}`).join('\n')}`
      : '',
    id.stateOwnership ? `**State ownership**: ${id.stateOwnership}` : '',
    id.dependencyDirection ? `**Dependency direction**: ${id.dependencyDirection}` : '',
  ].filter(Boolean)

  return parts.join('\n')
}

function buildRegistryBlock(dna: ProjectDNA): string {
  const sections: string[] = []

  if (dna.serviceRegistry?.length) {
    sections.push(`\n### Service Registry (existing services — do not duplicate)`)
    dna.serviceRegistry.slice(0, 10).forEach(s => {
      sections.push(`  - **${s.name}**: ${s.purpose}`)
      if (s.forbidden?.length) sections.push(`    FORBIDDEN to call: ${s.forbidden.join(', ')}`)
    })
  }

  if (dna.componentRegistry?.length) {
    const doNotRecreate = dna.componentRegistry.filter(c => c.doNotRecreate)
    if (doNotRecreate.length) {
      sections.push(`\n### Do Not Recreate (import these, never rewrite)`)
      doNotRecreate.forEach(c => {
        sections.push(`  - ${c.name} → import from \`${c.importFrom}\``)
      })
    }
  }

  if (dna.providerRegistry?.length) {
    const neverDirect = dna.providerRegistry.filter(p => p.neverCallDirectly)
    if (neverDirect.length) {
      sections.push(`\n### Provider Abstractions (NEVER call the SDK directly)`)
      neverDirect.forEach(p => {
        sections.push(`  - ${p.name} → use \`${p.interfaceName}\`, never \`${p.currentImplementation}\` directly`)
      })
    }
  }

  if (dna.adrs?.length) {
    const active = dna.adrs.filter(a => a.status === 'ACTIVE' || a.status === 'LOCKED')
    if (active.length) {
      sections.push(`\n### Architecture Decision Records (locked decisions — do not reverse)`)
      active.slice(0, 8).forEach(a => {
        sections.push(`  - [${a.status}] ${a.decision}`)
      })
    }
  }

  return sections.join('\n')
}

function buildStateManagementBlock(dna: ProjectDNA): string {
  if (!dna.stateManagement) return ''
  return `\n### State Management Mandate\n${dna.stateManagement}`
}

function buildSecurityBlock(dna: ProjectDNA): string {
  if (!dna.securityRequirements) return ''
  return `\n### Security Requirements\n${dna.securityRequirements}`
}

function buildFolderStructureBlock(dna: ProjectDNA): string {
  const fs = dna.folderStructure
  if (!fs || !Object.keys(fs).length) return ''
  const lines = Object.entries(fs).map(([folder, purpose]) => `  ${folder}/: ${purpose}`)
  return `\n### Folder Structure (place new files in the correct location)\n${lines.join('\n')}`
}

function buildRecoveryBlock(dna: ProjectDNA): string {
  const id = dna.identity
  if (!id) return ''
  const parts = [
    id.onProviderFailure ? `  - Provider failure: ${id.onProviderFailure}` : '',
    id.onDataCorruption ? `  - Data corruption: ${id.onDataCorruption}` : '',
    id.onUnexpectedState ? `  - Unexpected state: ${id.onUnexpectedState}` : '',
    id.rollbackCapability && id.rollbackMechanism ? `  - Rollback: ${id.rollbackMechanism}` : '',
  ].filter(Boolean)
  if (!parts.length) return ''
  return `\n### Recovery Behaviors (always implement these patterns)\n${parts.join('\n')}`
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Builds the unified system prompt from project DNA.
 * This is the complete architectural identity for every AI call.
 *
 * @param context - Optional DNA and architecture doc to enrich the identity
 * @returns A complete system prompt string
 */
export function buildUnifiedIdentity(context?: IdentityContext): string {
  const parts: string[] = [PLATPHORM_CONSTANTS]

  const dna = context?.dna

  if (dna) {
    parts.push(buildIdentityBlock(dna))
    parts.push(buildSystemLawsBlock(dna))
    parts.push(buildLockedSystemsBlock(dna))
    parts.push(buildForbiddenPatternsBlock(dna))
    parts.push(buildRegistryBlock(dna))
    parts.push(buildStateManagementBlock(dna))
    parts.push(buildSecurityBlock(dna))
    parts.push(buildFolderStructureBlock(dna))
    parts.push(buildRecoveryBlock(dna))
  } else {
    parts.push(`
### No Project DNA Loaded
Operating in general architectural mode. All core invariants above are still active.
When a project is opened, full DNA-aware governance will be enabled automatically.
`.trim())
  }

  if (context?.architectureDoc) {
    parts.push(`
### ARCHITECTURE.md (live project document)
\`\`\`
${context.architectureDoc.slice(0, 8000)}
\`\`\`
`.trim())
  }

  if (context?.activeFile) {
    parts.push(`\n### Active file context: \`${context.activeFile}\``)
  }

  parts.push(`
### Response Protocol
- Always respond with complete, production-ready code — no stubs, no TODOs
- When proposing file changes, specify the exact file path
- When you detect a forbidden pattern in a request, name it explicitly and refuse that specific aspect
- When a request would violate a System Law, state which law and propose a compliant alternative
- Architecture decisions are immutable — propose amendments via ADR if a locked decision blocks you
`.trim())

  return parts.filter(Boolean).join('\n\n')
}

/**
 * Builds a compact identity for use in pipeline layers where token budget is constrained.
 * Contains the critical invariants without the full registry/ADR list.
 */
export function buildCompactIdentity(context?: IdentityContext): string {
  const dna = context?.dna
  const parts: string[] = []

  parts.push(`You are PLATPHORM's architectural AI. Security, architecture, and DNA compliance are your default operating mode — always active, never switched off.`)

  if (dna) {
    if (dna.identity?.systemName) {
      parts.push(`Project: ${dna.identity.systemName}. Purpose: ${dna.identity.corePurpose ?? 'Not set'}.`)
    }

    const lockedLaws = dna.systemLaws?.filter(l => l.locked) ?? []
    if (lockedLaws.length) {
      parts.push(`LOCKED LAWS: ${lockedLaws.map(l => `[${l.id}] ${l.rule}`).join(' | ')}`)
    }

    if (dna.forbiddenPatterns?.length) {
      parts.push(`FORBIDDEN: ${dna.forbiddenPatterns.slice(0, 8).join(', ')}`)
    }

    const lockedSystems = dna.lockedSystems?.filter(s => s.status === 'LOCKED') ?? []
    if (lockedSystems.length) {
      parts.push(`LOCKED SYSTEMS (require approval): ${lockedSystems.map(s => s.name).join(', ')}`)
    }
  }

  parts.push(`Never output TODOs, never hallucinate APIs, never put business logic in UI, never hardcode secrets.`)

  return parts.join('\n')
}

/**
 * Builds the identity for a Sprint agent — scoped to a specific task and folder.
 * Each sprint agent gets the full DNA plus its specific scope constraints.
 */
export function buildSprintAgentIdentity(
  context: IdentityContext,
  agentTask: string,
  scopedFolders: string[],
  agentIndex: number,
  totalAgents: number
): string {
  const base = buildCompactIdentity(context)

  return `${base}

## Sprint Agent ${agentIndex + 1} of ${totalAgents}

**Your assigned task**: ${agentTask}
**Your folder scope** (ONLY modify files in these paths):
${scopedFolders.map(f => `  - ${f}`).join('\n')}

**Sprint Agent Rules**:
- You ONLY create or modify files within your assigned folder scope
- You do NOT modify shared infrastructure, stores, or config unless explicitly in your scope
- You output complete file contents — no partial edits
- You mark each file with: FILE: <path>\n\`\`\`<lang>\n<content>\n\`\`\`
- After all files, output a JSON summary: { "filesWritten": [...paths], "dependenciesAdded": [...], "breakingChanges": [...], "notes": "..." }
- If your task cannot be completed within your scope, explain what's blocked instead of generating broken code`
}

/**
 * Builds the identity for the Sprint Coordinator agent.
 * This agent reconciles outputs from N sprint agents into a unified diff.
 */
export function buildCoordinatorIdentity(context: IdentityContext, sprintGoal: string): string {
  const base = buildCompactIdentity(context)

  return `${base}

## Sprint Coordinator Role

**Sprint goal**: ${sprintGoal}

You are the reconciliation intelligence. You receive outputs from multiple sprint agents
and must produce a single, coherent, conflict-free implementation.

**Coordinator Responsibilities**:
1. Detect and resolve import conflicts between agents' outputs
2. Ensure no duplicate exports or conflicting type definitions
3. Verify that cross-agent dependencies are satisfied (Agent A's export that Agent B imports)
4. Merge overlapping file modifications deterministically
5. Flag any agent output that violates System Laws or forbidden patterns

**Output format**:
Produce a final JSON object:
{
  "unifiedChanges": [
    { "path": "src/...", "content": "...(full file content)...", "action": "create|modify" }
  ],
  "conflicts": [{ "file": "...", "agents": [...], "resolution": "..." }],
  "blockers": [{ "issue": "...", "agent": "...", "recommendation": "..." }],
  "coordinatorNotes": "...",
  "readyToApply": true
}`
}
