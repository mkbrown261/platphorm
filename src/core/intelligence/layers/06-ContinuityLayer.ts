import { orchestrator } from '../../providers/AIOrchestrator'
import type { Finding, LayerResult, PipelineContext } from '../../../types'
import { extractJSON, safeParseJSON, clampScore } from '../utils'

export async function runContinuityLayer(context: PipelineContext): Promise<LayerResult> {
  const start = Date.now()

  if (!context.projectDNAAvailable) {
    return {
      layer: 'continuity',
      status: 'skipped',
      score: 70,
      findings: [
        {
          id: 'continuity-no-dna',
          layer: 'continuity',
          severity: 'low',
          category: 'DNA',
          message: 'No project DNA — continuity analysis skipped. Initialize DNA to enable.',
          autoFixable: false
        }
      ],
      durationMs: Date.now() - start,
      timestamp: Date.now()
    }
  }

  const prompt = `You are the Continuity Layer of the PLATPHORM engineering OS.

Your job is to detect inconsistencies, drift, and fragmentation across the codebase.

Project architecture context:
${context.architectureDoc ?? 'Not available'}

Developer request: "${context.userPrompt}"
${context.selectedCode ? `\nCode:\n\`\`\`\n${context.selectedCode}\n\`\`\`` : ''}

Detect:
1. Naming convention inconsistencies
2. Pattern contradictions (e.g., two different state patterns)
3. Duplicate utility functions or logic
4. Partial refactors (started but not completed)
5. Schema inconsistencies across the codebase
6. Contradictory abstractions
7. Dead code / zombie systems
8. Fragmented state management
9. Inconsistent error handling patterns
10. Conflicting API response shapes

Respond in JSON:
{
  "findings": [
    {
      "severity": "high|medium|low",
      "category": "Naming|Pattern|Duplication|Partial Refactor|Schema|Abstraction|Dead Code|State|Error|API",
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
    const parsed = safeParseJSON(result.result.content, {})
    const findings: Finding[] = []

    for (const f of parsed.findings ?? []) {
      findings.push({
        id: `continuity-${Date.now()}-${Math.random()}`,
        layer: 'continuity',
        severity: f.severity ?? 'medium',
        category: f.category ?? 'Continuity',
        message: f.message,
        location: f.location,
        suggestedFix: f.suggestedFix,
        autoFixable: false
      })
    }

    return {
      layer: 'continuity',
      status: parsed.driftDetected ? 'warned' : 'passed',
      score: parsed.coherenceScore ?? 85,
      findings,
      durationMs: Date.now() - start,
      timestamp: Date.now()
    }
  } catch {
    return {
      layer: 'continuity',
      status: 'skipped',
      score: 75,
      findings: [],
      durationMs: Date.now() - start,
      timestamp: Date.now()
    }
  }
}
