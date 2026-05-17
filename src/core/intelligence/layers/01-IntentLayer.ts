import { orchestrator } from '../../providers/AIOrchestrator'
import type { Finding, LayerResult, PipelineContext } from '../../../types'
import { extractJSON, safeParseJSON, clampScore } from '../utils'

export async function runIntentLayer(context: PipelineContext): Promise<LayerResult> {
  const start = Date.now()
  const findings: Finding[] = []

  const prompt = `You are the Intent Layer of the PLATPHORM engineering OS.

Analyze this developer request and determine:
1. The actual underlying intent (what they truly want)
2. Whether the request is clear and unambiguous
3. Any scope expansion risks (is the request trying to do too much?)
4. Whether this touches any locked systems: ${context.lockedSystems.join(', ')}

Developer request: "${context.userPrompt}"
${context.selectedCode ? `\nSelected code:\n\`\`\`\n${context.selectedCode}\n\`\`\`` : ''}
${context.activeFile ? `\nActive file: ${context.activeFile}` : ''}

Respond in JSON:
{
  "clarifiedIntent": "...",
  "isAmbiguous": false,
  "scopeExpansionRisk": false,
  "touchesLockedSystems": [],
  "riskFlags": [],
  "score": 95
}`

  try {
    const result = await orchestrator.orchestrate({ prompt, role: 'architect' })
    const parsed = safeParseJSON(result.result.content, {})

    if (parsed.isAmbiguous) {
      findings.push({
        id: 'intent-ambiguous',
        layer: 'intent',
        severity: 'medium',
        category: 'Clarity',
        message: 'Request is ambiguous — intent could not be confidently determined',
        autoFixable: false
      })
    }

    if (parsed.scopeExpansionRisk) {
      findings.push({
        id: 'intent-scope-expansion',
        layer: 'intent',
        severity: 'high',
        category: 'Scope',
        message: 'Potential scope expansion detected — request may go beyond stated intent',
        autoFixable: false
      })
    }

    for (const system of parsed.touchesLockedSystems ?? []) {
      findings.push({
        id: `intent-locked-${system}`,
        layer: 'intent',
        severity: 'critical',
        category: 'Locked System',
        message: `Request touches locked system: ${system} — explicit approval required`,
        autoFixable: false
      })
    }

    return {
      layer: 'intent',
      status: findings.some((f) => f.severity === 'critical') ? 'failed' : 'passed',
      score: parsed.score ?? 90,
      findings,
      durationMs: Date.now() - start,
      timestamp: Date.now()
    }
  } catch {
    return {
      layer: 'intent',
      status: 'warned',
      score: 70,
      findings: [
        {
          id: 'intent-analysis-failed',
          layer: 'intent',
          severity: 'low',
          category: 'Analysis',
          message: 'Intent analysis could not complete — proceeding with caution',
          autoFixable: false
        }
      ],
      durationMs: Date.now() - start,
      timestamp: Date.now()
    }
  }
}
/)
  return match ? match[0] : '{}'
}
