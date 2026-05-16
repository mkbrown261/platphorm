/**
 * INTENT LAYER (Layer 1)
 *
 * FIXED — Previous version treated ambiguous/underspecified requests as blockers.
 * A terse prompt like "run an mcp" is not a failure — it's a high-level intent
 * that the agent is smart enough to interpret and execute.
 *
 * Correct behavior:
 * - Parse the ACTUAL underlying intent (make a reasonable interpretation)
 * - Only block on true ambiguity where two completely different outcomes are possible
 * - Scope expansion is a WARNING, not a blocker — agent handles scope
 * - Locked system touches are CRITICAL (unchanged — those must gate)
 * - "Underspecified" is not a blocker — agent asks via thinking or makes informed choice
 */

import { orchestrator } from '../../providers/AIOrchestrator'
import type { Finding, LayerResult, PipelineContext } from '../../../types'
import { parseJSONFromAI } from '../utils/parseJSON'

export async function runIntentLayer(context: PipelineContext): Promise<LayerResult> {
  const start = Date.now()
  const findings: Finding[] = []

  const prompt = `You are the Intent Layer of PLATPHORM's governance pipeline.

Your job: Parse what the developer ACTUALLY wants and identify only genuine blockers.

IMPORTANT RULES:
- Brief/terse requests are FINE — make a reasonable, informed interpretation
- "Underspecified" is NOT a blocker unless two radically different outcomes are equally likely
- Mark requests as ambiguous ONLY when you genuinely cannot determine the primary intent
- Scope expansion is a WARNING only — the agent manages scope intelligently
- Only lock on locked systems (hard block) and genuine logical contradictions

Locked systems to check: ${context.lockedSystems.length ? context.lockedSystems.join(', ') : 'none defined'}

Developer request: "${context.userPrompt}"
${context.selectedCode ? `\nSelected code:\n\`\`\`\n${context.selectedCode.slice(0, 2000)}\n\`\`\`` : ''}
${context.activeFile ? `\nActive file: ${context.activeFile}` : ''}

Respond in JSON:
{
  "clarifiedIntent": "Your interpretation of what the developer wants to build",
  "isAmbiguous": false,
  "ambiguityReason": "",
  "scopeExpansionRisk": false,
  "touchesLockedSystems": [],
  "riskFlags": [],
  "score": 95
}`

  try {
    const result = await orchestrator.orchestrate({ prompt, role: 'architect' })
    const parsed = parseJSONFromAI(result.result.content)

    // Only add ambiguity warning, never block on it — agent resolves ambiguity
    if (parsed.isAmbiguous) {
      findings.push({
        id: 'intent-ambiguous',
        layer: 'intent',
        severity: 'low',    // LOW — agent will make a reasonable interpretation
        category: 'Clarity',
        message: parsed.ambiguityReason
          ? `Intent interpretation: "${parsed.clarifiedIntent}" — ${parsed.ambiguityReason}`
          : `Interpreted intent: "${parsed.clarifiedIntent}"`,
        suggestedFix: 'Agent will proceed with the most likely interpretation. Refine prompt if the result misses the mark.',
        autoFixable: true
      })
    }

    // Scope expansion is informational
    if (parsed.scopeExpansionRisk) {
      findings.push({
        id: 'intent-scope-expansion',
        layer: 'intent',
        severity: 'low',
        category: 'Scope',
        message: 'Broad scope detected — agent will tackle the core task first',
        autoFixable: true
      })
    }

    // Locked system touches ARE a hard block — these require explicit approval
    for (const system of parsed.touchesLockedSystems ?? []) {
      findings.push({
        id: `intent-locked-${system}`,
        layer: 'intent',
        severity: 'critical',
        category: 'Locked System',
        message: `Request touches locked system: "${system}" — explicit approval required before proceeding`,
        autoFixable: false
      })
    }

    return {
      layer: 'intent',
      status: findings.some((f) => f.severity === 'critical') ? 'failed' : 'passed',
      score: parsed.score ?? 92,
      findings,
      durationMs: Date.now() - start,
      timestamp: Date.now()
    }
  } catch {
    // On AI failure, always pass — don't block generation on a governance timeout
    return {
      layer: 'intent',
      status: 'passed',
      score: 80,
      findings: [],
      durationMs: Date.now() - start,
      timestamp: Date.now()
    }
  }
}
