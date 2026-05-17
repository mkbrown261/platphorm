import { orchestrator } from '../../providers/AIOrchestrator'
import type { Finding, LayerResult, PipelineContext, SecurityFinding } from '../../../types'
import { extractJSON, safeParseJSON, clampScore } from '../utils'

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

export async function runSecurityLayer(context: PipelineContext): Promise<LayerResult> {
  const start = Date.now()
  const findings: Finding[] = []

  // Static pattern scan
  const codeToScan = context.selectedCode ?? ''
  for (const { pattern, label } of SECURITY_PATTERNS) {
    if (pattern.test(codeToScan)) {
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

  const prompt = `You are the Security Layer of the PLATPHORM engineering OS.

Security Philosophy: Assume breach. Zero trust. Least privilege. Compartmentalization.

Analyze this request and any code for security vulnerabilities:

Request: "${context.userPrompt}"
${codeToScan ? `\nCode:\n\`\`\`\n${codeToScan}\n\`\`\`` : ''}

Check for ALL of:
- Hardcoded secrets, keys, passwords
- Missing authorization checks
- Prompt injection vulnerabilities (if AI-related)
- SQL injection, XSS, CSRF risks
- Insecure JWT handling
- Missing input validation
- Privilege escalation risks
- Insecure file handling
- Unsafe AI output execution
- Dependency vulnerabilities (if imports visible)
- Missing rate limiting
- Exposed internal infrastructure
- Insecure CORS
- Service role leakage

Respond in JSON:
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

  try {
    const result = await orchestrator.orchestrate({ prompt, role: 'security' })
    const parsed = safeParseJSON(result.result.content, {})

    for (const f of parsed.findings ?? []) {
      findings.push({
        id: `sec-ai-${Date.now()}-${Math.random()}`,
        layer: 'security',
        severity: f.severity ?? 'medium',
        category: f.category ?? 'Security',
        message: f.message,
        location: f.location,
        suggestedFix: f.suggestedFix,
        autoFixable: false,
        owasp: f.owasp,
        attackVector: f.attackVector
      } as SecurityFinding)
    }

    const hasBlocker = findings.some((f) => f.severity === 'critical')

    return {
      layer: 'security',
      status: hasBlocker ? 'failed' : findings.some((f) => f.severity === 'high') ? 'warned' : 'passed',
      score: parsed.score ?? 85,
      findings,
      durationMs: Date.now() - start,
      timestamp: Date.now()
    }
  } catch {
    return {
      layer: 'security',
      status: findings.length > 0 ? 'warned' : 'passed',
      score: 75,
      findings,
      durationMs: Date.now() - start,
      timestamp: Date.now()
    }
  }
}
