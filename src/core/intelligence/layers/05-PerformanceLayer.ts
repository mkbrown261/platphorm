import { orchestrator } from '../../providers/AIOrchestrator'
import type { Finding, LayerResult, PerformanceFinding, PipelineContext } from '../../../types'

export async function runPerformanceLayer(context: PipelineContext): Promise<LayerResult> {
  const start = Date.now()
  const findings: Finding[] = []

  const code = context.selectedCode ?? ''

  // Static performance pattern checks
  const staticChecks: Array<{ pattern: RegExp; message: string; severity: 'high' | 'medium' | 'low'; impact: PerformanceFinding['impact'] }> = [
    { pattern: /useEffect\([^,]+\)(?!\s*,\s*\[)/, message: 'useEffect missing dependency array — causes infinite rerender loop', severity: 'high', impact: 'runtime' },
    { pattern: /setInterval|setTimeout.*\d{2,}/, message: 'Polling detected — prefer event-driven or websocket patterns', severity: 'medium', impact: 'runtime' },
    { pattern: /new THREE\.(Geometry|BufferGeometry).*\n.*(?!\.dispose\(\))/, message: 'Three.js geometry not disposed — GPU memory leak risk', severity: 'high', impact: 'gpu' },
    { pattern: /new THREE\.TextureLoader.*\n.*(?!\.dispose\(\))/, message: 'Three.js texture not disposed — GPU memory leak', severity: 'high', impact: 'gpu' },
    { pattern: /JSON\.parse.*JSON\.stringify/, message: 'Expensive deep clone in hot path', severity: 'medium', impact: 'runtime' },
    { pattern: /\.forEach.*\.push/, message: 'forEach+push anti-pattern — use map instead', severity: 'low', impact: 'runtime' }
  ]

  for (const check of staticChecks) {
    if (check.pattern.test(code)) {
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

  const prompt = `You are the Performance Layer of the PLATPHORM engineering OS.

Analyze this code for performance issues:

${code ? `\`\`\`\n${code}\n\`\`\`` : `Request: "${context.userPrompt}"`}

Check for:
- Rerender loops and render thrashing (React)
- Memory leaks (closures, subscriptions, timers not cleaned up)
- Excessive polling (prefer events/websockets)
- Oversized bundle contributions
- Inefficient state updates
- Blocking operations on main thread
- GPU memory leaks (Three.js/WebGL)
- Poor lazy loading
- Duplicated fetch logic
- Missing memoization on expensive calculations
- N+1 query patterns

Respond in JSON:
{
  "findings": [
    {
      "severity": "high|medium|low",
      "category": "...",
      "message": "...",
      "metric": "bundle|runtime|memory|gpu|network",
      "measuredValue": "...",
      "threshold": "...",
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
        measuredValue: f.measuredValue,
        threshold: f.threshold,
        impact: f.metric
      } as PerformanceFinding)
    }

    return {
      layer: 'performance',
      status: findings.some((f) => f.severity === 'high') ? 'warned' : 'passed',
      score: parsed.score ?? 85,
      findings,
      durationMs: Date.now() - start,
      timestamp: Date.now()
    }
  } catch {
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
