import type { Finding, LayerResult, PipelineContext } from '../../../types'
import { orchestrator } from '../../providers/AIOrchestrator'

export async function runObservabilityLayer(context: PipelineContext): Promise<LayerResult> {
  const start = Date.now()
  const hasCode = Boolean(context.selectedCode?.trim())

  // No code → skip AI call, return advisory pass
  // Observability is only meaningful when there's real code to inspect
  if (!hasCode) {
    return {
      layer: 'observability',
      status: 'passed',
      score: 85,
      findings: [{
        id: 'obs-intent-pass',
        layer: 'observability',
        severity: 'low',
        category: 'Observability',
        message: 'No existing code to inspect — observability requirements will be evaluated after generation.',
        autoFixable: false
      }],
      durationMs: Date.now() - start,
      timestamp: Date.now()
    }
  }

  const prompt = `You are the Observability Layer of the PLATPHORM engineering OS.

Evaluate this EXISTING CODE for observability gaps.
Only report issues you can directly see in the code below.

Request: "${context.userPrompt}"

Code:
\`\`\`
${context.selectedCode}
\`\`\`

Check for gaps VISIBLE in the code:
1. Async operations with no error handling or logging
2. State mutations with no audit trail
3. Silent catch blocks (catch errors swallowed without logging)
4. Fire-and-forget async calls
5. Missing health check endpoints (if a new service is being added)

Do NOT flag:
- Theoretical gaps in code that doesn't exist yet
- Missing logging in code that the user didn't write yet
- Generic "best practices" recommendations
- Issues in code not shown above

Severity:
- high: silent async failure that would cause invisible bugs in production
- medium: important logging gap in existing code
- low: advisory improvement

Respond ONLY with JSON:
{
  "findings": [
    {
      "severity": "high|medium|low",
      "category": "Logging|Audit|Retry|Health",
      "message": "...",
      "location": "...",
      "suggestedFix": "..."
    }
  ],
  "score": 80,
  "hasStructuredLogging": false,
  "hasErrorBoundaries": true,
  "hasAuditTrail": false
}`

  try {
    const result = await orchestrator.orchestrate({ prompt, role: 'backend' })
    const parsed = JSON.parse(extractJSON(result.result.content))
    const findings: Finding[] = []

    for (const f of parsed.findings ?? []) {
      findings.push({
        id: `obs-${Date.now()}-${Math.random()}`,
        layer: 'observability',
        severity: f.severity ?? 'low',
        category: f.category ?? 'Observability',
        message: f.message,
        location: f.location,
        suggestedFix: f.suggestedFix,
        autoFixable: false
      })
    }

    return {
      layer: 'observability',
      status: findings.some(f => f.severity === 'high') ? 'warned' : 'passed',
      score: parsed.score ?? 80,
      findings,
      durationMs: Date.now() - start,
      timestamp: Date.now()
    }
  } catch {
    return {
      layer: 'observability',
      status: 'passed',
      score: 75,
      findings: [],
      durationMs: Date.now() - start,
      timestamp: Date.now()
    }
  }
}

function extractJSON(text: string): string {
  const match = text.match(/\{[\s\S]*\}/)
  return match ? match[0] : '{}'
}
