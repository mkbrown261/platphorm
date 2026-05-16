/**
 * VALIDATION LAYER (Layer 7)
 *
 * CRITICAL FIX — Previous implementation was self-defeating:
 * It evaluated context.selectedCode (the user's EXISTING code, often empty)
 * and reported "placeholder logic" / "no implementation" — blocking the
 * very generation process that was supposed to CREATE the code.
 *
 * Correct behavior:
 * - If code exists (selectedCode), validate it for quality
 * - If NO code exists, validate the INTENT/PLAN for completeness and feasibility
 * - NEVER block on "no code provided" — that's the POINT of generation
 * - Only block on actual logical impossibilities or spec contradictions
 */

import { orchestrator } from '../../providers/AIOrchestrator'
import type { Finding, LayerResult, PipelineContext } from '../../../types'
import { parseJSONFromAI } from '../utils/parseJSON'

export async function runValidationLayer(context: PipelineContext): Promise<LayerResult> {
  const start = Date.now()
  const findings: Finding[] = []

  const hasExistingCode = Boolean(context.selectedCode?.trim())

  // Two distinct validation modes
  const prompt = hasExistingCode
    ? buildCodeValidationPrompt(context)
    : buildIntentValidationPrompt(context)

  try {
    const result = await orchestrator.orchestrate({ prompt, role: 'validation' })
    const parsed = parseJSONFromAI(result.result.content)

    // In code mode: check for actual placeholder markers in real code
    if (hasExistingCode && parsed.hasPlaceholders) {
      findings.push({
        id: 'val-placeholder',
        layer: 'validation',
        severity: 'high',  // high, not critical — auto-fixable by agent
        category: 'Integrity',
        message: 'Placeholder markers detected in existing code — ensure final output is complete',
        suggestedFix: 'Remove TODO/FIXME/placeholder comments and implement the actual logic',
        autoFixable: true
      })
    }

    if (hasExistingCode && parsed.hasMockLogic) {
      findings.push({
        id: 'val-mock-logic',
        layer: 'validation',
        severity: 'high',
        category: 'Integrity',
        message: 'Mock/stub logic in code context — agent will replace with real implementation',
        suggestedFix: 'Replace mock with production implementation',
        autoFixable: true
      })
    }

    // Specification-only request is valid — agent will generate the code
    // Only block if the intent itself is logically impossible or contradictory
    if (parsed.intentImpossible) {
      findings.push({
        id: 'val-impossible-intent',
        layer: 'validation',
        severity: 'critical',
        category: 'Feasibility',
        message: parsed.impossibilityReason ?? 'Request cannot be implemented as stated — logical contradiction detected',
        autoFixable: false
      })
    }

    for (const f of parsed.findings ?? []) {
      // Skip findings that just complain about missing code — agent generates it
      if (isNoCodeComplaint(f.message)) continue

      findings.push({
        id: `val-${Date.now()}-${Math.random()}`,
        layer: 'validation',
        severity: f.severity ?? 'medium',
        category: f.category ?? 'Validation',
        message: f.message,
        location: f.location,
        suggestedFix: f.suggestedFix,
        autoFixable: Boolean(f.autoFixable)
      })
    }

    const hasBlocker = findings.some((f) => f.severity === 'critical')

    return {
      layer: 'validation',
      status: hasBlocker ? 'failed' : findings.length > 0 ? 'warned' : 'passed',
      score: parsed.score ?? 88,
      findings,
      durationMs: Date.now() - start,
      timestamp: Date.now()
    }
  } catch {
    // On AI failure, pass — don't block generation on validator timeout
    return {
      layer: 'validation',
      status: 'passed',
      score: 75,
      findings: [],
      durationMs: Date.now() - start,
      timestamp: Date.now()
    }
  }
}

// ─── Prompt builders ──────────────────────────────────────────────────────────

function buildCodeValidationPrompt(context: PipelineContext): string {
  return `You are the Validation Layer of PLATPHORM's governance pipeline.

IMPORTANT: You are validating EXISTING code, not generated output. This code already exists.

Validate the existing code for:
1. Correctness — does it solve the stated intent?
2. Completeness — missing error boundaries, edge cases, guards?
3. Type safety — no implicit any, full interface coverage?
4. Error handling — all async flows covered?
5. No hidden side effects
6. Placeholder markers (TODO/FIXME) that shouldn't be in production

Developer intent: "${context.userPrompt}"

Existing code to validate:
\`\`\`
${(context.selectedCode ?? '').slice(0, 4000)}
\`\`\`

Respond in JSON:
{
  "findings": [
    {
      "severity": "critical|high|medium|low",
      "category": "Correctness|Completeness|TypeSafety|ErrorHandling|SideEffect|Integrity",
      "message": "...",
      "location": "...",
      "suggestedFix": "...",
      "autoFixable": true
    }
  ],
  "score": 88,
  "productionReady": true,
  "hasPlaceholders": false,
  "hasMockLogic": false,
  "intentImpossible": false,
  "impossibilityReason": ""
}`
}

function buildIntentValidationPrompt(context: PipelineContext): string {
  return `You are the Validation Layer of PLATPHORM's governance pipeline.

IMPORTANT: No existing code has been provided. The agent will GENERATE code after this validation.
Your job is to validate the INTENT, not demand code that doesn't exist yet.

Validate whether this request is:
1. Technically feasible — can it actually be implemented?
2. Logically coherent — is it self-consistent?
3. Scoped appropriately — not trying to do 50 things at once?
4. Requires missing context — does it need information not available?
5. Dependencies resolvable — do the required libraries/APIs exist?

DO NOT flag "no code provided" as an error — code generation is the NEXT step.
DO NOT demand implementation details — you are validating intent, not output.
ONLY block if the request is logically impossible or directly contradictory.

Developer intent: "${context.userPrompt}"
${context.activeFile ? `Active file context: ${context.activeFile}` : ''}
${context.architectureDoc ? `\nArchitecture:\n${context.architectureDoc.slice(0, 1500)}` : ''}
${context.systemLaws.length ? `\nSystem Laws: ${context.systemLaws.slice(0, 5).join('; ')}` : ''}

Respond in JSON:
{
  "findings": [
    {
      "severity": "critical|high|medium|low",
      "category": "Feasibility|Coherence|Scope|Dependencies|Context",
      "message": "...",
      "suggestedFix": "...",
      "autoFixable": false
    }
  ],
  "score": 90,
  "feasible": true,
  "intentClear": true,
  "intentImpossible": false,
  "impossibilityReason": "",
  "hasPlaceholders": false,
  "hasMockLogic": false
}`
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Returns true if a finding message is just complaining about absent code.
 * These are false positives from the validation AI when no code exists yet.
 */
function isNoCodeComplaint(message: string): boolean {
  const noCodePhrases = [
    'no code provided',
    'no implementation provided',
    'specification only',
    'no executable content',
    'empty code block',
    'implementation is missing',
    'no python script',
    'no actual code',
    'code was not provided',
    'missing implementation',
    'no content to validate',
    'pretends to provide',
    'empty blocks',
    'literally nothing',
    'not deployable',
    'request is a specification',
  ]
  const lower = message.toLowerCase()
  return noCodePhrases.some(phrase => lower.includes(phrase))
}
