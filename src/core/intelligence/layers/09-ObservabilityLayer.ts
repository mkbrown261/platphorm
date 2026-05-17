import type { Finding, LayerResult, PipelineContext } from '../../../types'
import { orchestrator } from '../../providers/AIOrchestrator'
import { extractJSON, safeParseJSON, clampScore } from '../utils'

export async function runObservabilityLayer(context: PipelineContext): Promise<LayerResult> {
  const start = Date.now()
  const findings: Finding[] = []

  const prompt = `You are the Observability Layer of the PLATPHORM engineering OS.

Ensure all implementations are observable, traceable, and monitorable.

Request: "${context.userPrompt}"
${context.selectedCode ? `\nCode:\n\`\`\`\n${context.selectedCode}\n\`\`\`` : ''}

Check for:
1. Missing structured logging (request ID, user ID, action, outcome)
2. Missing error state types (no generic 500s)
3. Missing metrics (latency, throughput, error rate)
4. Missing trace IDs across service boundaries
5. Silent async failures (fire-and-forget without logging)
6. Missing health endpoints (if adding a service)
7. Missing retry visibility
8. AI-specific: missing behavioral monitoring for AI outputs
9. Missing audit trail for state mutations
10. No rollback capability defined

Respond in JSON:
{
  "findings": [
    {
      "severity": "high|medium|low",
      "category": "Logging|Metrics|Tracing|Health|Audit|Retry|Behavioral",
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
    const parsed = safeParseJSON(result.result.content, {})

    if (!parsed.hasStructuredLogging) {
      findings.push({
        id: 'obs-no-logging',
        layer: 'observability',
        severity: 'medium',
        category: 'Logging',
        message: 'No structured logging detected — add request ID, action, and outcome logging',
        autoFixable: false
      })
    }

    if (!parsed.hasAuditTrail) {
      findings.push({
        id: 'obs-no-audit',
        layer: 'observability',
        severity: 'low',
        category: 'Audit',
        message: 'No audit trail — state mutations should be traceable',
        autoFixable: false
      })
    }

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
      status: findings.some((f) => f.severity === 'high') ? 'warned' : 'passed',
      score: parsed.score ?? 80,
      findings,
      durationMs: Date.now() - start,
      timestamp: Date.now()
    }
  } catch {
    return {
      layer: 'observability',
      status: 'skipped',
      score: 70,
      findings,
      durationMs: Date.now() - start,
      timestamp: Date.now()
    }
  }
}
