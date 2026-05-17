import type { AuditLog, DNAViolation, GovernanceEvent, GovernanceEventType, GovernanceReport, ProjectDNA } from '../../types'

class GovernanceEngine {
  private auditLog: AuditLog[] = []
  private governanceEvents: GovernanceEvent[] = []

  checkLockedSystem(systemName: string, dna: ProjectDNA): boolean {
    const locked = dna.lockedSystems.find(
      (s) => s.name.toLowerCase() === systemName.toLowerCase()
    )
    return locked?.status === 'LOCKED'
  }

  detectForbiddenPatterns(code: string, dna: ProjectDNA): DNAViolation[] {
    const violations: DNAViolation[] = []

    for (const pattern of dna.forbiddenPatterns) {
      const lower = pattern.toLowerCase()
      if (code.toLowerCase().includes(lower.split(' ')[0])) {
        violations.push({
          pattern,
          description: `Forbidden pattern detected: ${pattern}`,
          severity: 'high'
        })
      }
    }

    return violations
  }

  validateSystemLaws(code: string, dna: ProjectDNA): DNAViolation[] {
    const violations: DNAViolation[] = []

    for (const law of dna.systemLaws) {
      if (!law.locked) continue

      // Law 4: No hardcoded secrets
      if (law.id === 4 && /(?:secret|password|api[_-]?key)\s*=\s*["'][^"']{8,}["']/i.test(code)) {
        violations.push({
          lawId: 4,
          pattern: 'hardcoded-secret',
          description: 'System Law 4 violated: No hardcoded secrets or API keys',
          severity: 'critical'
        })
      }

      // Law 5: No business logic inside UI components.
      // FIX: was too broad — `/\.tsx/.test(code)` matched the word ".tsx" anywhere,
      // and `fetch\(` matched legitimate hook files. Now we check for direct HTTP
      // calls at the top level of a component function body (heuristic: not inside
      // a custom hook file, i.e. filename doesn't start with "use").
      // We also exclude legitimate patterns like useFetch, useQuery, etc.
      if (law.id === 5) {
        const hasDirectFetch = /\bfetch\s*\(|axios\.(get|post|put|patch|delete)\s*\(/i.test(code)
        const isCustomHook   = /^(export\s+)?(?:default\s+)?function\s+use[A-Z]/m.test(code)
        const isInsideEffect = /useEffect\s*\(\s*\(\s*\)\s*=>\s*\{[\s\S]{0,500}\bfetch\b/m.test(code)

        if (hasDirectFetch && !isCustomHook && !isInsideEffect) {
          violations.push({
            lawId: 5,
            pattern: 'business-logic-in-ui',
            description:
              'System Law 5 violated: Direct HTTP call in UI component — move to a service/hook',
            severity: 'high'
          })
        }
      }

      // Law 10: No placeholder logic
      if (law.id === 10 && /\b(TODO|FIXME|placeholder|not implemented|coming soon)\b/i.test(code)) {
        violations.push({
          lawId: 10,
          pattern: 'placeholder-logic',
          description: 'System Law 10 violated: Placeholder logic in production code',
          severity: 'high'
        })
      }
    }

    return violations
  }

  logGovernanceEvent(event: Omit<GovernanceEvent, 'id' | 'timestamp'>): void {
    this.governanceEvents.push({
      ...event,
      id: `event-${Date.now()}-${Math.random()}`,
      timestamp: Date.now()
    })
  }

  appendAuditLog(entry: Omit<AuditLog, 'id' | 'timestamp' | 'immutable'>): void {
    this.auditLog.push({
      ...entry,
      id: `audit-${Date.now()}-${Math.random()}`,
      timestamp: Date.now(),
      immutable: true
    })
  }

  generateReport(dna: ProjectDNA): GovernanceReport {
    const recentEvents = this.governanceEvents.slice(-50)
    const violations = recentEvents.filter((e) => !e.approved)
    const forbiddenFound = recentEvents
      .filter((e) => e.type === 'forbidden_pattern_detected')
      .map((e) => e.description)

    const securityEvents = recentEvents.filter(
      (e) => e.type === 'security_risk' || e.type === 'locked_system_access'
    )

    const coherenceScore = Math.max(0, 100 - violations.length * 5)
    const securityPosture = Math.max(0, 100 - securityEvents.length * 10)

    return {
      timestamp: Date.now(),
      projectPath: '',
      overallHealth:
        coherenceScore >= 80 && securityPosture >= 80
          ? 'healthy'
          : coherenceScore < 50 || securityPosture < 50
            ? 'critical'
            : 'degraded',
      architecturalCoherence: coherenceScore,
      securityPosture,
      driftIndicators: violations.map((v) => v.description),
      activeViolations: violations.length,
      resolvedViolations: recentEvents.filter((e) => e.approved).length,
      lockedSystemsIntact: !recentEvents.some(
        (e) => e.type === 'locked_system_access' && !e.approved
      ),
      forbiddenPatternsFound: forbiddenFound,
      recommendations: this.buildRecommendations(dna, violations)
    }
  }

  private buildRecommendations(
    dna: ProjectDNA,
    violations: GovernanceEvent[]
  ): string[] {
    const recs: string[] = []
    if (!dna.identity.systemName) recs.push('Initialize project DNA to enable full governance')
    if (violations.length > 5) recs.push('High violation rate — review System Laws with the team')
    if (dna.adrs.length === 0) recs.push('No ADRs recorded — document key architectural decisions')
    if (dna.lockedSystems.length === 0) recs.push('Define Locked Systems to prevent unsafe mutations')
    return recs
  }

  getAuditLog(): AuditLog[] {
    return [...this.auditLog]
  }

  getGovernanceEvents(): GovernanceEvent[] {
    return [...this.governanceEvents]
  }
}

export const governanceEngine = new GovernanceEngine()
