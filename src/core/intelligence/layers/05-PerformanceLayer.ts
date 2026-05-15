import { orchestrator } from '../../providers/AIOrchestrator'
import type { Finding, LayerResult, PerformanceFinding, PipelineContext } from '../../../types'

const STATIC_CHECKS: Array<{ pattern: RegExp; message: string; severity: 'high' | 'medium' | 'low'; impact: PerformanceFinding['impact'] }> = [
  { pattern: /useEffect\([^,]+\)(?!\s*,\s*\[)/, message: 'useEffect missing dependency array — causes infinite rerender loop', severity: 'high', impact: 'runtime' },
  { pattern: /setInterval|setTimeout.*\d{2,}/, message: 'Polling detected — prefer event-driven or websocket patterns', severity: 'medium', impact: 'runtime' },
  { pattern: /new THREE\.(Geometry|BufferGeometry).*\n.*(?!\.dispose\(\))/, message: 'Three.js geometry not disposed — GPU memory leak risk', severity: 'high', impact: 'gpu' },
  { pattern: /new THREE\.TextureLoader.*\n.*(?!\.dispose\(\))/, message: 'Three.js texture not disposed — GPU memory leak', severity: 'high', impact: 'gpu' },
  { pattern: /JSON\.parse.*JSON\.stringify/, message: 'Expensive deep clone in hot path', severity: 'medium', impact: 'runtime' },
  { pattern: /\.forEach.*\.push/, message: 'forEach+push anti-pattern — use map instead', severity: 'low', impact: 'runtime' }
]

export async function runPerformanceLayer(context: PipelineContext): Promise<LayerResult> {
  const start = Date.now()
  const findings: Finding[] = []
  const hasCode = Boolean(context.selectedCode?.trim())

  // Static pattern scan — only on real code
  if (hasCode) {
    for (const check of STATIC_CHECKS) {
      if (check.pattern.test(context.selectedCode!)) {
        findings.push({
          id: `perf-static-${Date.now()}-${Math.random()}`,
          layer: 'performance',
          severity: check.severity,
          category: 'Performance',
          message: check.message,
          autoFixable: false,
          metric: check.impact ?? 'runtime',
          impact: check.impact
        } as PerformanceFinding)
      }
    }
  }

  // No code → nothing meaningful to analyze, return advisory pass
  if (!hasCode) {
    return {
      layer: 'performance',
      status: 'passed',
      score: 90,
      findings: [{
        id: 'perf-intent-pass',
        layer: 'performance',
        severity: 'low',
        category: 'Performance',
        message: 'No existing code to analyze — performance will be validated after generation.',
        autoFixable: false
      }],
      durationMs: Date.now() - start,
      timestamp: Date.now()
    }
  }

  const prompt = `You are the Performance Layer of the PLATPHORM engineering OS.

Analyze this EXISTING CODE for performance issues. Only report problems visible in the code.

\`\`\`
${context.selectedCode}
\`\`\`

Request context: "${context.userPrompt}"

Check for:
- Rerender loops and render thrashing (React)
- Memory leaks (closures, subscriptions, timers not cleaned up)
- Blocking operations on main thread
- GPU memory leaks (Three.js/WebGL)
- N+1 query patterns visible in code
- Missing memoization on clearly expensive calculations

Do NOT report theoretical risks. Only report what you can actually see in the code above.

Severity rules:
- high: visible performance bug that will cause real problems
- medium: pattern that could be a problem under load
- low: optimization opportunity

Respond ONLY with JSON:
{
  "findings": [
    {
      "severity": "high|medium|low",
      "category": "...",
      "message": "...",
      "metric": "bundle|runtime|memory|gpu|network",
      "suggestedFix": "..."
    }
  ],
  "score": 85
}`

  try {
    const result = await orchestrator.orchestrate({ prompt, role: 'performance' })
    const parsed = JSON.parse(extractJSON(result.result.content))

    for (const f of parsed.findings ?? []) {
      findings.push({
        id: `perf-ai-${Date.now()}-${Math.random()}`,
        layer: 'performance',
        severity: f.severity ?? 'medium',
        category: f.category ?? 'Performance',
        message: f.message,
        suggestedFix: f.suggestedFix,
        autoFixable: false,
        metric: f.metric,
        impact: f.metric
      } as PerformanceFinding)
    }

    return {
      layer: 'performance',
      status: findings.some(f => f.severity === 'high') ? 'warned' : 'passed',
      score: parsed.score ?? 85,
      findings,
      durationMs: Date.now() - start,
      timestamp: Date.now()
    }
  } catch {
    // AI failure → pass with any static findings
    return {
      layer: 'performance',
      status: findings.length > 0 ? 'warned' : 'passed',
      score: 80,
      findings,
      durationMs: Date.now() - start,
      timestamp: Date.now()
    }
  }
}

function extractJSON(text: string): string {
  const match = text.match(/\{[\s\S]*\}/)
  return match ? match[0] : '{}'
}
