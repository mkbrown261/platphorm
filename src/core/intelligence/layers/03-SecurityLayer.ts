import { orchestrator } from '../../providers/AIOrchestrator'
import type { Finding, LayerResult, PipelineContext, SecurityFinding } from '../../../types'

const SECURITY_PATTERNS = [
  { pattern: /hardcoded.*key|api[_-]?key\s*=\s*["'][^"']+["']/i, label: 'Hardcoded API key' },
  { pattern: /password\s*=\s*["'][^"']+["']/i, label: 'Hardcoded password' },
  { pattern: /secret\s*=\s*["'][^"']+["']/i, label: 'Hardcoded secret' },
  { pattern: /eval\s*\(/i, label: 'Unsafe eval()' },
  { pattern: /innerHTML\s*=/i, label: 'XSS risk via innerHTML' },
  { pattern: /dangerouslySetInnerHTML/i, label: 'XSS risk via dangerouslySetInnerHTML' },
  { pattern: /sql\s+.*\+.*input|query\s*\+\s*req/i, label: 'Potential SQL injection' },
  { pattern: /process\.env\.[A-Z_]+\s*\|\|\s*["']/i, label: 'Insecure env fallback' },
  { pattern: /cors\(\)/i, label: 'Permissive CORS — wildcard origin risk' },
  { pattern: /jwt\.sign.*\{\s*\}/i, label: 'JWT signed with empty options' }
]

// Phrases the AI produces when there's no code to audit — these are false positives
const FALSE_POSITIVE_PHRASES = [
  'no code provided', 'no implementation', 'cannot assess without code',
  'missing implementation', 'not yet implemented', 'needs implementation',
  'no authentication mechanism', 'no input validation', 'no authorization',
  'no rate limiting', 'no logging', 'missing security controls',
  'security controls not visible', 'unable to assess', 'code not provided',
  'no code to review', 'implementation not shown', 'no code snippet',
  'without seeing the code', 'general security', 'theoretical risk',
]

function isFalsePositive(message: string): boolean {
  const lower = message.toLowerCase()
  return FALSE_POSITIVE_PHRASES.some(p => lower.includes(p))
}

export async function runSecurityLayer(context: PipelineContext): Promise<LayerResult> {
  const start = Date.now()
  const findings: Finding[] = []
  const hasCode = Boolean(context.selectedCode?.trim())

  // Static pattern scan — only runs when there's real code
  if (hasCode) {
    for (const { pattern, label } of SECURITY_PATTERNS) {
      if (pattern.test(context.selectedCode!)) {
        findings.push({
          id: `sec-static-${label.replace(/\s/g, '-').toLowerCase()}`,
          layer: 'security',
          severity: 'high',
          category: 'Static Security Scan',
          message: label,
          autoFixable: false
        } as SecurityFinding)
      }
    }
  }

  const prompt = hasCode
    ? `You are the Security Layer of the PLATPHORM engineering OS.

Security Philosophy: Assume breach. Zero trust. Least privilege. Compartmentalization.

Analyze this EXISTING CODE for security vulnerabilities.
Only report issues you can directly observe in the code below.

Request: "${context.userPrompt}"

Code:
\`\`\`
${context.selectedCode}
\`\`\`

Report only REAL findings visible in this code. Do not flag theoretical risks.
Severity rules:
- critical: active exploit possible right now (hardcoded secret, SQL injection, RCE)
- high: serious vulnerability present in code (missing auth on exposed route)
- medium: vulnerability possible but requires specific conditions
- low: best-practice improvement

Respond ONLY with JSON:
{
  "findings": [
    {
      "severity": "critical|high|medium|low",
      "category": "...",
      "message": "...",
      "location": "...",
      "owasp": "A01:2021-...",
      "attackVector": "...",
      "suggestedFix": "..."
    }
  ],
  "score": 90,
  "threatModelNotes": "..."
}`
    : `You are the Security Layer of the PLATPHORM engineering OS.

A developer wants to: "${context.userPrompt}"

No code exists yet — this is a PRE-GENERATION intent check.
Your job: identify if the intent itself requests something inherently dangerous.

Examples of genuinely dangerous intents:
- "store passwords in plaintext"
- "disable all authentication"
- "execute user input as code"
- "expose all database records publicly"

Severity rules for intent-only mode:
- critical: the intent itself is inherently dangerous (e.g., "store plaintext passwords")
- high: NEVER — code doesn't exist yet, cannot flag implementation issues
- medium: NEVER — code doesn't exist yet
- low: advisory note about security considerations for this feature area

If the intent is a normal feature request (build API, create component, add auth, etc.):
return empty findings and a high score.

Respond ONLY with JSON:
{
  "findings": [],
  "score": 88,
  "threatModelNotes": "Normal request, standard security practices apply during implementation."
}`

  try {
    const result = await orchestrator.orchestrate({ prompt, role: 'security' })
    const parsed = JSON.parse(extractJSON(result.result.content))

    for (const f of parsed.findings ?? []) {
      // Strip false positives about absent code
      if (!hasCode && isFalsePositive(f.message ?? '')) continue

      // In intent-only mode: cap at low severity
      const rawSeverity = f.severity ?? 'medium'
      const severity = hasCode ? rawSeverity : capSeverity(rawSeverity, 'low')

      findings.push({
        id: `sec-ai-${Date.now()}-${Math.random()}`,
        layer: 'security',
        severity,
        category: f.category ?? 'Security',
        message: f.message,
        location: f.location,
        suggestedFix: f.suggestedFix,
        autoFixable: false,
        owasp: f.owasp,
        attackVector: f.attackVector
      } as SecurityFinding)
    }

    const hasBlocker = findings.some(f => f.severity === 'critical')

    return {
      layer: 'security',
      status: hasBlocker ? 'failed' : findings.some(f => f.severity === 'high') ? 'warned' : 'passed',
      score: parsed.score ?? 85,
      findings,
      durationMs: Date.now() - start,
      timestamp: Date.now()
    }
  } catch {
    // AI failure → keep any static findings, never block
    return {
      layer: 'security',
      status: findings.length > 0 ? 'warned' : 'passed',
      score: 80,
      findings,
      durationMs: Date.now() - start,
      timestamp: Date.now()
    }
  }
}

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
