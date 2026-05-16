import { orchestrator } from '../../providers/AIOrchestrator'
import type { Finding, LayerResult, PipelineContext } from '../../../types'
import { parseJSONFromAI } from '../utils/parseJSON'

export async function runContinuityLayer(context: PipelineContext): Promise<LayerResult> {
  const start = Date.now()
  const hasCode = Boolean(context.selectedCode?.trim())

  // No DNA and no code → skip entirely, advisory pass
  if (!context.projectDNAAvailable && !hasCode) {
    return {
      layer: 'continuity',
      status: 'passed',
      score: 80,
      findings: [],
      durationMs: Date.now() - start,
      timestamp: Date.now()
    }
  }

  // No code → intent-only advisory pass
  if (!hasCode) {
    return {
      layer: 'continuity',
      status: 'passed',
      score: 85,
      findings: [{
        id: 'continuity-intent-pass',
        layer: 'continuity',
        severity: 'low',
        category: 'Continuity',
        message: 'No existing code to analyze for drift — continuity will be checked after generation.',
        autoFixable: false
      }],
      durationMs: Date.now() - start,
      timestamp: Date.now()
    }
  }

  const prompt = `You are the Continuity Layer of the PLATPHORM engineering OS.

Detect inconsistencies and drift in this EXISTING CODE versus the project's patterns.

Project architecture context:
${context.architectureDoc ?? 'Not available'}

Developer request: "${context.userPrompt}"

Code to review:
\`\`\`
${context.selectedCode}
\`\`\`

Detect REAL issues visible in the code:
1. Naming convention inconsistencies vs the rest of the codebase
2. Pattern contradictions (e.g., two different state patterns in same file)
3. Duplicate utility functions that already exist
4. Partial refactors that are incomplete
5. Contradictory abstractions

Do NOT flag theoretical risks or things that might happen in future code.
Only report what you can actually see.

Severity rules:
- high: clear pattern contradiction or incomplete refactor that will break things
- medium: naming inconsistency or duplicate logic
- low: style drift or advisory

Respond ONLY with JSON:
{
  "findings": [
    {
      "severity": "high|medium|low",
      "category": "Naming|Pattern|Duplication|Partial Refactor|Abstraction",
      "message": "...",
      "location": "...",
      "suggestedFix": "..."
    }
  ],
  "coherenceScore": 85,
  "driftDetected": false
}`

  try {
    const result = await orchestrator.orchestrate({ prompt, role: 'refactor' })
    const parsed = parseJSONFromAI(result.result.content)
    const findings: Finding[] = []

    for (const f of parsed.findings ?? []) {
      findings.push({
        id: `continuity-${Date.now()}-${Math.random()}`,
        layer: 'continuity',
        severity: f.severity ?? 'low',
        category: f.category ?? 'Continuity',
        message: f.message,
        location: f.location,
        suggestedFix: f.suggestedFix,
        autoFixable: false
      })
    }

    return {
      layer: 'continuity',
      status: parsed.driftDetected && findings.some(f => f.severity === 'high') ? 'warned' : 'passed',
      score: parsed.coherenceScore ?? 85,
      findings,
      durationMs: Date.now() - start,
      timestamp: Date.now()
    }
  } catch {
    return {
      layer: 'continuity',
      status: 'passed',
      score: 80,
      findings: [],
      durationMs: Date.now() - start,
      timestamp: Date.now()
    }
  }
}
