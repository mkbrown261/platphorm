import { orchestrator } from '../../providers/AIOrchestrator'
import type { Finding, LayerResult, PipelineContext } from '../../../types'
import { extractJSON, safeParseJSON, clampScore } from '../utils'

export async function runArchitectureLayer(context: PipelineContext): Promise<LayerResult> {
  const start = Date.now()
  const findings: Finding[] = []

  if (!context.projectDNAAvailable) {
    return {
      layer: 'architecture',
      status: 'warned',
      score: 60,
      findings: [
        {
          id: 'arch-no-dna',
          layer: 'architecture',
          severity: 'medium',
          category: 'DNA',
          message:
            'No project DNA found. Initialize DNA to enable full architectural governance.',
          autoFixable: false
        }
      ],
      durationMs: Date.now() - start,
      timestamp: Date.now()
    }
  }

  const prompt = `You are the Architecture Layer of the PLATPHORM engineering OS.

Validate this request against the project's architectural rules.

System Laws:
${context.systemLaws.map((l, i) => `${i + 1}. ${l}`).join('\n')}

Forbidden Patterns:
${context.forbiddenPatterns.join('\n')}

Architecture Document:
${context.architectureDoc ?? 'Not provided'}

Relevant Registries:
${context.relevantRegistries}

Developer request: "${context.userPrompt}"
${context.selectedCode ? `\nCode context:\n\`\`\`\n${context.selectedCode}\n\`\`\`` : ''}

Check for:
1. System law violations
2. Forbidden patterns
3. Service boundary violations
4. Domain boundary crossings
5. Duplicate system creation
6. Premature abstraction
7. Provider abstraction violations
8. Context lock violations

Respond in JSON:
{
  "violations": [
    { "lawId": 1, "pattern": "...", "description": "...", "severity": "critical|high|medium|low", "location": "...", "suggestedFix": "..." }
  ],
  "score": 95,
  "architecturallySound": true
}`

  try {
    const result = await orchestrator.orchestrate({ prompt, role: 'architect' })
    const parsed = safeParseJSON(result.result.content, {})

    for (const v of parsed.violations ?? []) {
      findings.push({
        id: `arch-violation-${Date.now()}-${Math.random()}`,
        layer: 'architecture',
        severity: v.severity ?? 'medium',
        category: 'Architecture Violation',
        message: v.description,
        location: v.location,
        suggestedFix: v.suggestedFix,
        autoFixable: false,
        dnaViolation: {
          lawId: v.lawId,
          pattern: v.pattern,
          description: v.description,
          severity: v.severity
        }
      })
    }

    const hasBlocker = findings.some((f) => f.severity === 'critical' || f.severity === 'high')

    return {
      layer: 'architecture',
      status: hasBlocker ? 'failed' : findings.length > 0 ? 'warned' : 'passed',
      score: parsed.score ?? 95,
      findings,
      durationMs: Date.now() - start,
      timestamp: Date.now()
    }
  } catch {
    return {
      layer: 'architecture',
      status: 'warned',
      score: 70,
      findings: [],
      durationMs: Date.now() - start,
      timestamp: Date.now()
    }
  }
}
/)
  return match ? match[0] : '{}'
}
