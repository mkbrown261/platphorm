import type { DNAViolation } from './dna'

export type LayerName =
  | 'intent'
  | 'architecture'
  | 'security'
  | 'dependency'
  | 'performance'
  | 'continuity'
  | 'validation'
  | 'execution'
  | 'observability'
  | 'selfCritique'

export type LayerStatus = 'idle' | 'running' | 'passed' | 'failed' | 'warned' | 'skipped'

export interface LayerResult {
  layer: LayerName
  status: LayerStatus
  score: number // 0-100
  findings: Finding[]
  durationMs: number
  timestamp: number
}

export interface Finding {
  id: string
  layer: LayerName
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info'
  category: string
  message: string
  location?: string
  suggestedFix?: string
  autoFixable: boolean
  dnaViolation?: DNAViolation
}

export interface PipelineContext {
  projectPath: string
  userPrompt: string
  selectedCode?: string
  activeFile?: string
  projectDNAAvailable: boolean
  architectureDoc?: string
  systemLaws: string[]
  forbiddenPatterns: string[]
  lockedSystems: string[]
  relevantRegistries: string
  intentContract?: string
}

export interface PipelineResult {
  id: string
  timestamp: number
  context: PipelineContext
  layers: LayerResult[]
  overallScore: number
  approved: boolean
  blockers: Finding[]
  warnings: Finding[]
  generatedCode?: string
  validatedCode?: string
  executionPlan?: ExecutionPlan
  durationMs: number
}

export interface ExecutionPlan {
  changes: FileChange[]
  estimatedRisk: 'low' | 'medium' | 'high' | 'critical'
  reversible: boolean
  rollbackPlan: string
  affectedServices: string[]
  requiresApproval: boolean
}

export interface FileChange {
  path: string
  type: 'create' | 'modify' | 'delete' | 'rename'
  before?: string
  after?: string
  reason: string
}

export interface SecurityFinding extends Finding {
  owasp?: string
  cve?: string
  attackVector?: string
  exploitability?: 'low' | 'medium' | 'high' | 'critical'
}

export interface PerformanceFinding extends Finding {
  metric: string
  measuredValue?: number | string
  threshold?: number | string
  impact?: 'bundle' | 'runtime' | 'memory' | 'gpu' | 'network'
}

export interface QualityScorecard {
  hallucinationRisk: number
  architecturalCoherence: number
  securityConfidence: number
  maintainability: number
  driftIndicators: number
  overall: number
  dnaConsistent: boolean
  issues: string[]
}
