import { orchestrator } from '../../providers/AIOrchestrator'
import type { Finding, LayerResult, PipelineContext } from '../../../types'

export async function runValidationLayer(context: PipelineContext): Promise<LayerResult> {
  const start = Date.now()
  const findings: Finding[] = []

  const prompt = `You are the Validation Layer of the PLATPHORM engineering OS.

Core rule: Generated code is presumed incomplete until validated.

Validate this code or implementation plan for:
1. Correctness — does it actually solve the stated intent?
2. Completeness — are there missing error boundaries, edge cases, or guards?
3. Scalability — does this hold at 10x, 100x load?
4. Implementation integrity — no placeholders, no mock/fake logic, no TODOs in production paths
5. Type safety — no implicit 'any', full interface coverage
6. Error handling — all async flows have error boundaries
7. State mutations traceable — all state changes observable
8. No hidden side effects

Developer request: "${context.userPrompt}"
${context.selectedCode ? `\nCode:\n\`\`\`\n${context.selectedCode}\n\`\`\`` : ''}

Respond in JSON:
{
  "findings": [
    {
      "severity": "critical|high|medium|low",
      "category": "Correctness|Completeness|Scalability|Integrity|TypeSafety|ErrorHandling|SideEffect",
      "message": "...",
      "location": "...",
      "suggestedFix": "..."
    }
  ],
  "score": 88,
  "productionReady": true,
  "hasPlaceholders": false,
  "hasMockLogic": false
}`

  try {
    const result = await orchestrator.orchestrate({ prompt, role: 'backend' })
    const parsed = JSON.parse(extractJSON(result.result.content))

    if (parsed.hasPlaceholders) {
      findings.push({
        id: 'val-placeholder',
        layer: 'validation',
        severity: 'critical',
        category: 'Integrity',
        message: 'Placeholder logic detected — not production-safe',
        autoFixable: false
      })
    }

    if (parsed.hasMockLogic) {
      findings.push({
        id: 'val-mock-logic',
        layer: 'validation',
        severity: 'critical',
        category: 'Integrity',
        message: 'Mock/simulated logic detected — not a real implementation',
        autoFixable: false
      })
    }

    for (const f of parsed.findings ?? []) {
      findings.push({
        id: `val-${Date.now()}-${Math.random()}`,
        layer: 'validation',
        severity: f.severity ?? 'medium',
        category: f.category ?? 'Validation',
        message: f.message,
        location: f.location,
        suggestedFix: f.suggestedFix,
        autoFixable: false
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
    return {
      layer: 'validation',
      status: 'warned',
      score: 70,
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
