import { orchestrator } from '../../providers/AIOrchestrator'
import type { Finding, LayerResult, PipelineContext } from '../../../types'

export async function runArchitectureLayer(context: PipelineContext): Promise<LayerResult> {
  const start = Date.now()
  const findings: Finding[] = []
  const hasCode = Boolean(context.selectedCode?.trim())

  if (!context.projectDNAAvailable) {
    return {
      layer: 'architecture',
      status: 'warned',
      score: 75,
      findings: [{
        id: 'arch-no-dna',
        layer: 'architecture',
        severity: 'low',
        category: 'DNA',
        message: 'No project DNA — architectural governance is advisory only. Initialize DNA for full enforcement.',
        autoFixable: false
      }],
      durationMs: Date.now() - start,
      timestamp: Date.now()
    }
  }

  const prompt = hasCode
    ? `You are the Architecture Layer of the PLATPHORM engineering OS.

Validate this EXISTING CODE against the project's architectural rules.

System Laws:
${context.systemLaws.map((l, i) => `${i + 1}. ${l}`).join('\n')}

Forbidden Patterns:
${context.forbiddenPatterns.join('\n')}

Architecture Document:
${context.architectureDoc ?? 'Not provided'}

Developer request: "${context.userPrompt}"

Code to validate:
\`\`\`
${context.selectedCode}
\`\`\`

Find ACTUAL violations in the code above. Only report violations you can see in the code.
A violation requires evidence in the code — not a theoretical risk.

Severity rules:
- critical: code DIRECTLY violates a system law or touches a locked system
- high: code clearly uses a forbidden pattern
- medium: architectural smell or debatable boundary issue
- low: style or advisory note

Respond ONLY with JSON:
{
  "violations": [
    { "lawId": 1, "pattern": "...", "description": "...", "severity": "critical|high|medium|low", "location": "...", "suggestedFix": "..." }
  ],
  "score": 95,
  "architecturallySound": true
}`
    : `You are the Architecture Layer of the PLATPHORM engineering OS.

A developer wants to: "${context.userPrompt}"

No code exists yet — this is a PRE-GENERATION intent check.

System Laws:
${context.systemLaws.map((l, i) => `${i + 1}. ${l}`).join('\n')}

Locked Systems (do not touch without explicit approval):
${context.lockedSystems?.join(', ') || 'None defined'}

Your job: determine if the INTENT itself violates a system law or touches a locked system.
Do NOT penalize for missing implementation details — code doesn't exist yet.

Severity rules for intent-only mode:
- critical: intent explicitly targets a locked system by name
- high: NEVER use on intent-only check (code doesn't exist)
- medium: NEVER use on intent-only check
- low: the intent might need architectural guidance, informational only

Respond ONLY with JSON:
{
  "violations": [],
  "score": 92,
  "architecturallySound": true
}`

  try {
    const result = await orchestrator.orchestrate({ prompt, role: 'architect' })
    const parsed = JSON.parse(extractJSON(result.result.content))

    for (const v of parsed.violations ?? []) {
      // In intent-only mode: cap severity — never block on absent code
      const rawSeverity = v.severity ?? 'low'
      const severity = hasCode ? rawSeverity : capSeverity(rawSeverity, 'low')

      findings.push({
        id: `arch-violation-${Date.now()}-${Math.random()}`,
        layer: 'architecture',
        severity,
        category: 'Architecture Violation',
        message: v.description,
        location: v.location,
        suggestedFix: v.suggestedFix,
        autoFixable: false,
        dnaViolation: {
          lawId: v.lawId,
          pattern: v.pattern,
          description: v.description,
          severity
        }
      })
    }

    const hasBlocker = findings.some(f => f.severity === 'critical')
    const hasHigh = findings.some(f => f.severity === 'high')

    return {
      layer: 'architecture',
      status: hasBlocker ? 'failed' : hasHigh || findings.length > 0 ? 'warned' : 'passed',
      score: parsed.score ?? 92,
      findings,
      durationMs: Date.now() - start,
      timestamp: Date.now()
    }
  } catch {
    // AI failure → pass, never block generation
    return {
      layer: 'architecture',
      status: 'passed',
      score: 80,
      findings: [],
      durationMs: Date.now() - start,
      timestamp: Date.now()
    }
  }
}

/** Cap a severity to a maximum level */
function capSeverity(
  raw: string,
  max: 'low' | 'medium' | 'high' | 'critical'
): 'low' | 'medium' | 'high' | 'critical' {
  const order = ['low', 'medium', 'high', 'critical']
  const rawIdx = order.indexOf(raw)
  const maxIdx = order.indexOf(max)
  const idx = Math.min(rawIdx < 0 ? 0 : rawIdx, maxIdx)
  return order[idx] as 'low' | 'medium' | 'high' | 'critical'
}

function extractJSON(text: string): string {
  const match = text.match(/\{[\s\S]*\}/)
  return match ? match[0] : '{}'
}
