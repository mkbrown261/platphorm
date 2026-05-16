import type { AuditLog, DNAViolation, GovernanceEvent, GovernanceEventType, GovernanceReport, ProjectDNA } from '../../types'

// Forward declarations — set by wiring in App.tsx to avoid circular deps
type StoreAppender = (entry: AuditLog) => void
type StoreEventLogger = (event: GovernanceEvent) => void
let _storeAppender: StoreAppender | null = null
let _storeEventLogger: StoreEventLogger | null = null

export function wireGovernanceStore(appender: StoreAppender, eventLogger: StoreEventLogger) {
  _storeAppender = appender
  _storeEventLogger = eventLogger
}

class GovernanceEngine {
  private auditLog: AuditLog[] = []
  private governanceEvents: GovernanceEvent[] = []
  private projectPath: string | null = null

  setProjectPath(path: string) { this.projectPath = path }

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
      const r = law.rule.toLowerCase()

      // Match by rule TEXT, not by ID — works for any AI-generated law
      const checks = this._lawChecks(code, r)
      for (const v of checks) {
        violations.push({ lawId: law.id, pattern: v.pattern, description: `System Law ${law.id} violated: ${law.rule} — ${v.detail}`, severity: v.severity })
      }
    }

    return violations
  }

  private _lawChecks(code: string, rule: string): Array<{ pattern: string; detail: string; severity: DNAViolation['severity'] }> {
    const hits: Array<{ pattern: string; detail: string; severity: DNAViolation['severity'] }> = []

    // Hardcoded secrets / credentials
    if (/secret|credential|password|hardcod|api.?key/i.test(rule)) {
      if (/(?:secret|password|api[_-]?key|token|auth)\s*[:=]\s*["'][^"']{6,}/i.test(code)) {
        hits.push({ pattern: 'hardcoded-secret', detail: 'hardcoded credential detected', severity: 'critical' })
      }
    }

    // Business logic in UI / component separation
    if (/ui|component|presentation|business.?logic|separation/i.test(rule)) {
      if (/\.tsx?/.test(code) && /\bfetch\(|axios\.|supabase\.|prisma\.|mongoose\./i.test(code)) {
        hits.push({ pattern: 'business-logic-in-ui', detail: 'direct API/DB call inside UI component', severity: 'high' })
      }
    }

    // No placeholders / stubs in production
    if (/placeholder|stub|todo|fixme|incomplete|not.?implemented/i.test(rule)) {
      if (/\b(?:TODO|FIXME|HACK|XXX)\b|placeholder|not\s+implemented|coming\s+soon/i.test(code)) {
        hits.push({ pattern: 'placeholder-logic', detail: 'placeholder or stub code present', severity: 'high' })
      }
    }

    // No console.log / debug output in production
    if (/console|debug|logging|production.?log/i.test(rule)) {
      if (/console\.(log|debug|info)\s*\(/i.test(code)) {
        hits.push({ pattern: 'console-in-production', detail: 'console.log/debug in production code', severity: 'medium' })
      }
    }

    // No `any` type / type safety
    if (/type.?safe|no.?any|strict.?type|typescript/i.test(rule)) {
      if (/:\s*any\b|as\s+any\b/i.test(code)) {
        hits.push({ pattern: 'unsafe-any-type', detail: 'explicit `any` type undermines type safety', severity: 'medium' })
      }
    }

    // No direct DOM manipulation
    if (/dom|document\.|direct.?manip|react/i.test(rule)) {
      if (/document\.(getElementById|querySelector|createElement|body)\b/i.test(code)) {
        hits.push({ pattern: 'direct-dom-manipulation', detail: 'direct DOM manipulation bypasses React', severity: 'medium' })
      }
    }

    // No mutating shared/global state directly
    if (/global.?state|shared.?state|immutab|mutation/i.test(rule)) {
      if (/\bglobal\b\s*\.\s*\w+\s*=|window\.\w+\s*=/i.test(code)) {
        hits.push({ pattern: 'global-mutation', detail: 'direct mutation of global/window state', severity: 'high' })
      }
    }

    // Error handling required
    if (/error.?handl|catch|unhandled|async/i.test(rule)) {
      if (/catch\s*\([^)]*\)\s*\{\s*\}/i.test(code)) {
        hits.push({ pattern: 'empty-catch', detail: 'empty catch block swallows errors silently', severity: 'high' })
      }
    }

    return hits
  }

  logGovernanceEvent(event: Omit<GovernanceEvent, 'id' | 'timestamp'>): void {
    const full: GovernanceEvent = {
      ...event,
      id: `event-${Date.now()}-${Math.random()}`,
      timestamp: Date.now()
    }
    this.governanceEvents.push(full)
    // Wire to store
    _storeEventLogger?.(full)
  }

  appendAuditLog(entry: Omit<AuditLog, 'id' | 'timestamp' | 'immutable'>): void {
    const full: AuditLog = {
      ...entry,
      id: `audit-${Date.now()}-${Math.random()}`,
      timestamp: Date.now(),
      immutable: true
    }
    this.auditLog.push(full)
    // Wire to store
    _storeAppender?.(full)
    // Persist to disk if project path set
    if (this.projectPath) {
      const line = JSON.stringify(full)
      window.api.fs.appendAuditLog(this.projectPath, line).catch(() => {})
    }
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
