export interface ArchitecturalIdentity {
  systemName: string
  corePurpose: string
  alwaysDoes: string[]
  neverDoes: string[]
  governanceRules: string[]
  stateOwnership: string
  contractStability: string
  dependencyDirection: string
  onProviderFailure: string
  onDataCorruption: string
  onUnexpectedState: string
  rollbackCapability: boolean
  rollbackMechanism?: string
  hardBoundaries: string[]
}

export interface SystemLaw {
  id: number
  rule: string
  locked: boolean
}

export type LockStatus = 'LOCKED' | 'SELF_MODIFIABLE' | 'CONTEXT_LOCKED'

export interface LockedSystem {
  name: string
  status: LockStatus
  description: string
}

export interface ServiceRegistryEntry {
  name: string
  purpose: string
  allowedDependencies: string[]
  forbidden: string[]
  recoveryBehavior: string
}

export interface DomainRegistryEntry {
  name: string
  owns: string[]
  forbidden: string[]
}

export interface ComponentRegistryEntry {
  name: string
  variants: string[]
  importFrom: string
  doNotRecreate: boolean
}

export interface APIContractEntry {
  endpoint: string
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  input: Record<string, string>
  output: Record<string, string>
  errors: number[]
  auth: boolean
  status: 'ACTIVE' | 'LOCKED' | 'DEPRECATED'
}

export interface ProviderAbstractionEntry {
  name: string
  interfaceName: string
  methods: Array<{ signature: string; returns: string }>
  currentImplementation: string
  swappableWith: string[]
  neverCallDirectly: boolean
}

export interface ADR {
  id: string
  decision: string
  reason: string
  tradeoffs: string
  status: 'ACTIVE' | 'LOCKED' | 'SUPERSEDED'
  supersededBy?: string
}

export interface IntentContract {
  id: string
  intent: string
  inputs: string
  outputs: string
  stateImpact: string
  dependencies: string[]
  security: string
  failure: string
  observability: string
  createdAt: number
}

export interface ProjectDNA {
  identity: ArchitecturalIdentity
  systemLaws: SystemLaw[]
  lockedSystems: LockedSystem[]
  forbiddenPatterns: string[]
  serviceRegistry: ServiceRegistryEntry[]
  domainRegistry: DomainRegistryEntry[]
  componentRegistry: ComponentRegistryEntry[]
  apiContractRegistry: APIContractEntry[]
  providerRegistry: ProviderAbstractionEntry[]
  adrs: ADR[]
  folderStructure: Record<string, string>
  namingConventions: Record<string, string>
  stateManagement: string
  securityRequirements: string
  performanceBudgets: Record<string, string | number>
  lastUpdated: number
  version: string
}

export interface DNAViolation {
  lawId?: number
  pattern: string
  description: string
  severity: 'critical' | 'high' | 'medium' | 'low'
  location?: string
  suggestedFix?: string
}
