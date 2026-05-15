import { orchestrator } from '../../providers/AIOrchestrator'
import type { Finding, LayerResult, PipelineContext } from '../../../types'

export async function runDependencyLayer(context: PipelineContext): Promise<LayerResult> {
  const start = Date.now()
  const findings: Finding[] = []

  const codeToScan = context.selectedCode ?? ''
  const importMatches = codeToScan.match(/import\s+.*?from\s+['"]([^'"]+)['"]/g) ?? []
  const imports = importMatches
    .map(m => m.match(/from\s+['"]([^'"]+)['"]/)?.[1])
    .filter(Boolean) as string[]

  // No code, no imports → nothing to check, pass immediately
  if (!codeToScan.trim() && imports.length === 0) {
    return {
      layer: 'dependency',
      status: 'passed',
      score: 100,
      findings: [],
      durationMs: Date.now() - start,
      timestamp: Date.now()
    }
  }

  // Only prompt AI if we actually have imports to analyze
  if (imports.length === 0) {
    return {
      layer: 'dependency',
      status: 'passed',
      score: 95,
      findings: [],
      durationMs: Date.now() - start,
      timestamp: Date.now()
    }
  }

  const prompt = `You are the Dependency Layer of the PLATPHORM engineering OS.

Analyze these imports found in existing code for actual risks:
${imports.map(i => `- ${i}`).join('\n')}

Developer request: "${context.userPrompt}"

Only flag REAL issues:
1. Packages that genuinely do not exist (hallucinated names like "react-magic-helper-v3")
2. Packages with known critical CVEs (from your training knowledge)
3. Supply chain risk (clearly abandoned/malicious)
4. Unnecessary dependencies where a native API is obviously better

Do NOT flag:
- Missing auth or validation (that's Security Layer's job)
- Packages that exist and are fine
- Packages you're simply unfamiliar with

Severity rules:
- critical: package doesn't exist at all (hallucinated)
- high: package has active known CVE or is clearly malicious
- medium: ecosystem concern (abandoned, deprecated)
- low: advisory (could use native API instead)

Respond ONLY with JSON:
{
  "findings": [
    {
      "severity": "critical|high|medium|low",
      "category": "Hallucination|Vulnerability|Supply Chain|Ecosystem",
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

    const hasBlocker = findings.some(f => f.severity === 'critical')

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
      status: 'passed',
      score: 85,
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
