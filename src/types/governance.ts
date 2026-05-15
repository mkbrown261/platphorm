export interface GovernanceEvent {
  id: string
  timestamp: number
  type: GovernanceEventType
  actor: 'ai' | 'user' | 'system'
  description: string
  target?: string
  approved: boolean
  approvedBy?: string
  metadata?: Record<string, unknown>
}

export type GovernanceEventType =
  | 'locked_system_access'
  | 'forbidden_pattern_detected'
  | 'law_violation'
  | 'architecture_drift'
  | 'security_risk'
  | 'dependency_risk'
  | 'hallucination_detected'
  | 'provider_abstraction_violated'
  | 'scope_expansion_detected'
  | 'context_lock_violated'

export interface AuditLog {
  id: string
  timestamp: number
  action: string
  actor: 'ai' | 'user' | 'system'
  target: string
  before?: string
  after?: string
  approved: boolean
  pipelineResultId?: string
  immutable: true
}

export interface GovernanceReport {
  timestamp: number
  projectPath: string
  overallHealth: 'healthy' | 'degraded' | 'critical'
  architecturalCoherence: number
  securityPosture: number
  driftIndicators: string[]
  activeViolations: number
  resolvedViolations: number
  lockedSystemsIntact: boolean
  forbiddenPatternsFound: string[]
  recommendations: string[]
}

export interface DeleteDetectionResult {
  safe: boolean
  affectedModules: string[]
  affectedContracts: string[]
  lockedSystemsAffected: string[]
  forbiddenPatternsIntroduced: string[]
  regressionRisk: 'none' | 'low' | 'medium' | 'high'
  recommendation: string
}
