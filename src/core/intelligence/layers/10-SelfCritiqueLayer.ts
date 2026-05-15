import type { Finding, LayerResult, PipelineContext, QualityScorecard } from '../../../types'
import { orchestrator } from '../../providers/AIOrchestrator'

export async function runSelfCritiqueLayer(
  context: PipelineContext,
  generatedContent: string
): Promise<LayerResult & { scorecard?: QualityScorecard }> {
  const start = Date.now()
  const findings: Finding[] = []

  const prompt = `You are the Self-Critique Layer of the PLATPHORM engineering OS.

Your role: Aggressively attack your own implementation. Find every flaw before it reaches production.

You are NOT here to approve. You are here to FIND PROBLEMS.

Original request: "${context.userPrompt}"

Generated implementation:
\`\`\`
${generatedContent.slice(0, 6000)}
\`\`\`

Architecture DNA:
${context.architectureDoc?.slice(0, 1000) ?? 'Not available'}
System Laws: ${context.systemLaws.slice(0, 5).join('; ')}
Forbidden Patterns: ${context.forbiddenPatterns.slice(0, 10).join('; ')}

Attack vectors to check:
1. HALLUCINATION — Does it reference real, existing systems? Any invented APIs?
2. ARCHITECTURE — Does it violate any System Law or forbidden pattern?
3. SECURITY — Could an attacker exploit this?
4. COMPLETENESS — What cases weren't handled?
5. SCALABILITY — What breaks at 100x load?
6. MAINTAINABILITY — Will a future engineer understand and extend this safely?
7. DNA CONSISTENCY — Does this match the project's Architectural Identity?
8. PRODUCTION SAFETY — Is this actually deployable or just demo code?

Score each dimension 0-100 (100 = perfect).

Respond in JSON:
{
  "selfCritique": "Your honest, harsh assessment...",
  "findings": [
    {
      "severity": "critical|high|medium|low",
      "category": "Hallucination|Architecture|Security|Completeness|Scalability|Maintainability|DNA|Production",
      "message": "...",
      "suggestedFix": "..."
    }
  ],
  "scorecard": {
    "hallucinationRisk": 90,
    "architecturalCoherence": 85,
    "securityConfidence": 80,
    "maintainability": 88,
    "driftIndicators": 95,
    "overall": 87,
    "dnaConsistent": true,
    "issues": []
  },
  "approved": true
}`

  try {
    const result = await orchestrator.orchestrate({
      prompt,
      role: 'architect',
      options: { temperature: 0.1 }
    })
    const parsed = JSON.parse(extractJSON(result.result.content))

    for (const f of parsed.findings ?? []) {
      findings.push({
        id: `critique-${Date.now()}-${Math.random()}`,
        layer: 'selfCritique',
        severity: f.severity ?? 'medium',
        category: f.category ?? 'Self-Critique',
        message: f.message,
        suggestedFix: f.suggestedFix,
        autoFixable: false
      })
    }

    const scorecard: QualityScorecard = parsed.scorecard ?? {
      hallucinationRisk: 75,
      architecturalCoherence: 75,
      securityConfidence: 75,
      maintainability: 75,
      driftIndicators: 75,
      overall: 75,
      dnaConsistent: true,
      issues: []
    }

    const approved = parsed.approved && !findings.some((f) => f.severity === 'critical')

    return {
      layer: 'selfCritique',
      status: approved ? 'passed' : findings.some((f) => f.severity === 'critical') ? 'failed' : 'warned',
      score: scorecard.overall,
      findings,
      durationMs: Date.now() - start,
      timestamp: Date.now(),
      scorecard
    }
  } catch {
    return {
      layer: 'selfCritique',
      status: 'warned',
      score: 70,
      findings: [
        {
          id: 'critique-failed',
          layer: 'selfCritique',
          severity: 'low',
          category: 'Self-Critique',
          message: 'Self-critique could not complete — proceed with manual review',
          autoFixable: false
        }
      ],
      durationMs: Date.now() - start,
      timestamp: Date.now()
    }
  }
}

function extractJSON(text: string): string {
  const match = text.match(/\{[\s\S]*\}/)
  return match ? match[0] : '{}'
}
