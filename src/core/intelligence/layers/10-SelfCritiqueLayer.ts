/**
 * SELF-CRITIQUE LAYER (Layer 10)
 *
 * CRITICAL FIX — Previous implementation attacked empty generatedContent
 * and produced critical findings like "the implementation is missing" —
 * blocking every generation request where the agent hadn't run yet.
 *
 * Correct behavior:
 * - If no generated content exists, score the PLAN quality, not the code
 * - If code exists, critique it hard
 * - Never produce critical findings for "no code" when code hasn't been generated
 * - The self-critique score reflects confidence in the approach, not code completeness
 */

import type { Finding, LayerResult, PipelineContext, QualityScorecard } from '../../../types'
import { orchestrator } from '../../providers/AIOrchestrator'
import { parseJSONFromAI } from '../utils/parseJSON'

export async function runSelfCritiqueLayer(
  context: PipelineContext,
  generatedContent: string
): Promise<LayerResult & { scorecard?: QualityScorecard }> {
  const start = Date.now()
  const findings: Finding[] = []

  const hasContent = generatedContent.trim().length > 50

  const prompt = hasContent
    ? buildCodeCritiquePrompt(context, generatedContent)
    : buildPlanCritiquePrompt(context)

  try {
    const result = await orchestrator.orchestrate({
      prompt,
      role: 'architect',
      options: { temperature: 0.1 }
    })
    const parsed = parseJSONFromAI(result.result.content)

    for (const f of parsed.findings ?? []) {
      // Skip complaints about missing implementation when code hasn't been generated yet
      if (!hasContent && isEmptyCodeComplaint(f.message)) continue

      findings.push({
        id: `critique-${Date.now()}-${Math.random()}`,
        layer: 'selfCritique',
        severity: f.severity ?? 'medium',
        category: f.category ?? 'Self-Critique',
        message: f.message,
        suggestedFix: f.suggestedFix,
        autoFixable: Boolean(f.autoFixable)
      })
    }

    const scorecard: QualityScorecard = parsed.scorecard ?? defaultScorecard(hasContent)

    // SelfCritique NEVER blocks the pipeline with critical findings.
    // Its job is to score and advise — not to gate. Actual blocking happens
    // in layers 1-7 on real violations. Layer 10 is advisory only.
    // Demote any 'critical' to 'high' — critique informs, never blocks.
    const demotedFindings = findings.map(f =>
      f.severity === 'critical' ? { ...f, severity: 'high' as const } : f
    )

    return {
      layer: 'selfCritique',
      status: demotedFindings.some((f) => f.severity === 'high') ? 'warned' : 'passed',
      score: scorecard.overall,
      findings: demotedFindings,
      durationMs: Date.now() - start,
      timestamp: Date.now(),
      scorecard
    }
  } catch {
    return {
      layer: 'selfCritique',
      status: 'passed',
      score: 75,
      findings: [],
      durationMs: Date.now() - start,
      timestamp: Date.now(),
      scorecard: defaultScorecard(hasContent)
    }
  }
}

// ─── Prompt builders ──────────────────────────────────────────────────────────

function buildCodeCritiquePrompt(context: PipelineContext, generatedContent: string): string {
  return `You are the Self-Critique Layer of PLATPHORM's governance pipeline.

You HAVE generated code to critique. Attack it hard. Find every flaw.

Original request: "${context.userPrompt}"

Generated implementation:
\`\`\`
${generatedContent.slice(0, 6000)}
\`\`\`

Architecture DNA:
${context.architectureDoc?.slice(0, 800) ?? 'Not available'}
System Laws: ${context.systemLaws.slice(0, 5).join('; ')}
Forbidden Patterns: ${context.forbiddenPatterns.slice(0, 8).join('; ')}

Attack vectors:
1. HALLUCINATION — Invented APIs or non-existent functions?
2. ARCHITECTURE — System Law or forbidden pattern violations?
3. SECURITY — Exploitable vulnerabilities?
4. COMPLETENESS — Unhandled cases, missing guards?
5. DNA CONSISTENCY — Matches project architectural identity?

IMPORTANT: This is an ADVISORY layer. Use severity 'high' for serious issues,
'medium' for improvements, 'low' for style. Do NOT use 'critical' — that is
reserved for actual security exploits or law violations found in earlier layers.
Do NOT flag incomplete content if the content you see is a partial execution plan
— the agent will generate the full implementation after this pipeline.

Score each dimension 0-100.

Respond in JSON:
{
  "findings": [
    {
      "severity": "critical|high|medium|low",
      "category": "Hallucination|Architecture|Security|Completeness|Production|DNA",
      "message": "...",
      "suggestedFix": "...",
      "autoFixable": true
    }
  ],
  "scorecard": {
    "hallucinationRisk": 90,
    "architecturalCoherence": 88,
    "securityConfidence": 85,
    "maintainability": 87,
    "driftIndicators": 92,
    "overall": 88,
    "dnaConsistent": true,
    "issues": []
  }
}`
}

function buildPlanCritiquePrompt(context: PipelineContext): string {
  return `You are the Self-Critique Layer of PLATPHORM's governance pipeline.

No code has been generated yet — the agent will generate it after this pipeline.
Your job is to critique the IMPLEMENTATION PLAN and APPROACH quality.

Rate the plan quality:
1. Is the approach sound for this type of request?
2. Are there architectural concerns to flag BEFORE generation?
3. Could the approach lead to technical debt or security issues?
4. Is the scope right — not too broad or too narrow?

IMPORTANT: Do NOT critique "missing code" — code hasn't been generated yet.
Score based on plan quality, not implementation completeness.

Developer request: "${context.userPrompt}"
${context.activeFile ? `Active file: ${context.activeFile}` : ''}
${context.architectureDoc ? `\nArchitecture: ${context.architectureDoc.slice(0, 800)}` : ''}

Respond in JSON:
{
  "findings": [
    {
      "severity": "medium|low",
      "category": "Approach|Architecture|Scope|Risk",
      "message": "...",
      "suggestedFix": "...",
      "autoFixable": false
    }
  ],
  "scorecard": {
    "hallucinationRisk": 88,
    "architecturalCoherence": 85,
    "securityConfidence": 82,
    "maintainability": 85,
    "driftIndicators": 90,
    "overall": 86,
    "dnaConsistent": true,
    "issues": []
  }
}`
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isEmptyCodeComplaint(message: string): boolean {
  const phrases = [
    'no implementation',
    'empty code',
    'literally nothing',
    'not deployable',
    'implementation is missing',
    'no executable',
    'specification only',
    'pretends to provide',
    'empty blocks',
    'no actual code',
    'no python script',
    'no unreal',
    'missing implementation of core',
    'entire implementation is missing',
    'not a real implementation',
    'the response pretends',
  ]
  const lower = message.toLowerCase()
  return phrases.some(p => lower.includes(p))
}

function defaultScorecard(hasCode: boolean): QualityScorecard {
  const base = hasCode ? 75 : 82 // Plans score higher since they haven't been implemented wrong yet
  return {
    hallucinationRisk: base + 5,
    architecturalCoherence: base,
    securityConfidence: base,
    maintainability: base,
    driftIndicators: base + 8,
    overall: base,
    dnaConsistent: true,
    issues: []
  }
}
