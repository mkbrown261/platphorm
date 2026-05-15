import { orchestrator } from '../../providers/AIOrchestrator'
import type { Finding, LayerResult, PipelineContext } from '../../../types'

export async function runDependencyLayer(context: PipelineContext): Promise<LayerResult> {
  const start = Date.now()
  const findings: Finding[] = []

  const importMatches = (context.selectedCode ?? '').match(
    /import\s+.*?from\s+['"]([^'"]+)['"]/g
  ) ?? []
  const imports = importMatches.map((m) => m.match(/from\s+['"]([^'"]+)['"]/)?.[1]).filter(Boolean)

  if (imports.length === 0 && !context.selectedCode) {
    return {
      layer: 'dependency',
      status: 'skipped',
      score: 100,
      findings: [],
      durationMs: Date.now() - start,
      timestamp: Date.now()
    }
  }

  const prompt = `You are the Dependency Layer of the PLATPHORM engineering OS.

Analyze these dependencies for risk:
${imports.map((i) => `- ${i}`).join('\n')}

Developer request: "${context.userPrompt}"

Check for:
1. Fake/nonexistent package names (hallucinated imports)
2. Known vulnerable packages (general knowledge)
3. Packages not in provider abstraction registry (direct provider calls)
4. Ecosystem risk (unmaintained, deprecated, low quality)
5. Supply chain risk
6. Unnecessary dependencies (can native APIs solve this?)
7. License conflicts

Respond in JSON:
{
  "findings": [
    {
      "severity": "critical|high|medium|low",
      "category": "Hallucination|Vulnerability|Supply Chain|Ecosystem|Abstraction Violation",
      "package": "...",
      "message": "...",
      "suggestedFix": "..."
    }
  ],
  "score": 90
}`

  try {
    const result = await orchestrator.orchestrate({ prompt, role: 'backend' })
    const parsed = JSON.parse(extractJSON(result.result.content))

    for (const f of parsed.findings ?? []) {
      findings.push({
        id: `dep-${f.package ?? 'unknown'}-${Date.now()}`,
        layer: 'dependency',
        severity: f.severity ?? 'medium',
        category: f.category ?? 'Dependency',
        message: f.message,
        suggestedFix: f.suggestedFix,
        autoFixable: false
      })
    }

    const hasBlocker = findings.some((f) => f.severity === 'critical')

    return {
      layer: 'dependency',
      status: hasBlocker ? 'failed' : findings.length > 0 ? 'warned' : 'passed',
      score: parsed.score ?? 90,
      findings,
      durationMs: Date.now() - start,
      timestamp: Date.now()
    }
  } catch {
    return {
      layer: 'dependency',
      status: 'skipped',
      score: 80,
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
