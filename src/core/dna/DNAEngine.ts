import type { ADR, IntentContract, ProjectDNA } from '../../types'
import { orchestrator } from '../providers/AIOrchestrator'
import { extractJSON, safeParseJSON } from '../intelligence/utils'

const EMPTY_DNA: ProjectDNA = {
  identity: {
    systemName: '',
    corePurpose: '',
    alwaysDoes: [],
    neverDoes: [],
    governanceRules: [],
    stateOwnership: '',
    contractStability: '',
    dependencyDirection: '',
    onProviderFailure: 'degrade gracefully',
    onDataCorruption: 'isolate and alert',
    onUnexpectedState: 'log and halt',
    rollbackCapability: true,
    rollbackMechanism: 'git revert',
    hardBoundaries: []
  },
  systemLaws: [],
  lockedSystems: [],
  forbiddenPatterns: [],
  serviceRegistry: [],
  domainRegistry: [],
  componentRegistry: [],
  apiContractRegistry: [],
  providerRegistry: [],
  adrs: [],
  folderStructure: {},
  namingConventions: {},
  stateManagement: '',
  securityRequirements: '',
  performanceBudgets: {},
  lastUpdated: Date.now(),
  version: '1.0.0'
}

export class DNAEngine {
  private dna: ProjectDNA | null = null
  private projectPath: string | null = null

  async initialize(projectPath: string): Promise<ProjectDNA> {
    this.projectPath = projectPath

    const existingDoc = await this.readArchitectureMd(projectPath)

    if (existingDoc) {
      this.dna = await this.parseFromMarkdown(existingDoc)
    } else {
      this.dna = await this.generateFromProject(projectPath)
    }

    return this.dna
  }

  async generateFromProject(projectPath: string): Promise<ProjectDNA> {
    const fileList = await this.scanProjectFiles(projectPath)
    const packageJson = await this.readFile(`${projectPath}/package.json`)
    const readmeContent = await this.readFile(`${projectPath}/README.md`)

    const prompt = `You are the Architect AI of the PLATPHORM engineering OS.

A developer has opened this project. Generate its Software DNA — the architectural identity that will govern all future AI assistance.

Project path: ${projectPath}
Files found: ${fileList.slice(0, 50).join(', ')}
${packageJson ? `\npackage.json:\n${packageJson.slice(0, 1000)}` : ''}
${readmeContent ? `\nREADME:\n${readmeContent.slice(0, 1000)}` : ''}

Generate the project's DNA in JSON, including:
1. Architectural Identity (what this system is)
2. 17 System Laws (use the standard set, adapt to this project)
3. Inferred locked systems (auth, billing, DB schema, etc.)
4. Common forbidden patterns for this stack
5. Inferred service registry (from file structure)
6. Inferred domain registry
7. Naming conventions (from file/folder names)
8. State management philosophy (from dependencies)
9. Security requirements
10. Provider abstraction map (from dependencies)

Respond in JSON matching this structure exactly (no extra fields):
{
  "identity": {
    "systemName": "...",
    "corePurpose": "...",
    "alwaysDoes": [],
    "neverDoes": [],
    "governanceRules": [],
    "stateOwnership": "...",
    "contractStability": "...",
    "dependencyDirection": "...",
    "onProviderFailure": "...",
    "onDataCorruption": "...",
    "onUnexpectedState": "...",
    "rollbackCapability": true,
    "rollbackMechanism": "...",
    "hardBoundaries": []
  },
  "systemLaws": [{"id": 1, "rule": "...", "locked": true}],
  "lockedSystems": [{"name": "...", "status": "LOCKED", "description": "..."}],
  "forbiddenPatterns": ["..."],
  "serviceRegistry": [],
  "domainRegistry": [],
  "componentRegistry": [],
  "apiContractRegistry": [],
  "providerRegistry": [],
  "adrs": [],
  "folderStructure": {},
  "namingConventions": {},
  "stateManagement": "...",
  "securityRequirements": "...",
  "performanceBudgets": {}
}`

    try {
      const result = await orchestrator.orchestrate({ prompt, role: 'architect' })
      const parsed = safeParseJSON(result.result.content, {})
      this.dna = {
        ...EMPTY_DNA,
        ...(parsed as Partial<ProjectDNA>),
        lastUpdated: Date.now(),
        version: '1.0.0'
      }
    } catch {
      this.dna = {
        ...EMPTY_DNA,
        identity: {
          ...EMPTY_DNA.identity,
          systemName: projectPath.split('/').pop() ?? 'Unknown Project',
          corePurpose: 'Awaiting DNA initialization'
        }
      }
    }

    await this.persist()
    return this.dna
  }

  async parseFromMarkdown(content: string): Promise<ProjectDNA> {
    try {
      const jsonMatch = content.match(/```json\n([\s\S]*?)\n```/)
      if (jsonMatch) {
        return { ...EMPTY_DNA, ...(JSON.parse(jsonMatch[1]) as Partial<ProjectDNA>), lastUpdated: Date.now() }
      }
    } catch {}
    return { ...EMPTY_DNA }
  }

  async persist(): Promise<void> {
    if (!this.dna || !this.projectPath) return

    const content = this.toMarkdown(this.dna)
    const path = `${this.projectPath}/ARCHITECTURE.md`

    try {
      await window.api.fs.writeFile(path, content)
    } catch {}
  }

  toMarkdown(dna: ProjectDNA): string {
    return `# ARCHITECTURE.md — ${dna.identity.systemName}

*Generated and maintained by PLATPHORM. Do not edit manually — update via the DNA panel.*

## Architectural Identity (Software DNA)

**System:** ${dna.identity.systemName}
**Purpose:** ${dna.identity.corePurpose}

**Always does:**
${dna.identity.alwaysDoes.map((a) => `- ${a}`).join('\n')}

**Never does:**
${dna.identity.neverDoes.map((n) => `- ${n}`).join('\n')}

**Hard boundaries:**
${dna.identity.hardBoundaries.map((b) => `- ${b}`).join('\n')}

## System Laws

${dna.systemLaws.map((l) => `${l.id}. ${l.rule}${l.locked ? ' *(LOCKED)*' : ''}`).join('\n')}

## Locked Systems

${dna.lockedSystems.map((s) => `- **${s.name}** [${s.status}]: ${s.description}`).join('\n')}

## Forbidden Patterns

${dna.forbiddenPatterns.map((p) => `- ${p}`).join('\n')}

## State Management

${dna.stateManagement}

## Security Requirements

${dna.securityRequirements}

## Architecture Decision Records

${dna.adrs.map((a) => `### ${a.id}: ${a.decision}\n**Reason:** ${a.reason}\n**Status:** ${a.status}`).join('\n\n')}

---

\`\`\`json
${JSON.stringify(dna, null, 2)}
\`\`\`
`
  }

  getDNA(): ProjectDNA | null {
    return this.dna
  }

  updateDNA(partial: Partial<ProjectDNA>): void {
    if (!this.dna) return
    this.dna = { ...this.dna, ...partial, lastUpdated: Date.now() }
    this.persist()
  }

  addADR(adr: Omit<ADR, 'id'>): void {
    if (!this.dna) return
    const id = `ADR-${String(this.dna.adrs.length + 1).padStart(3, '0')}`
    this.dna.adrs.push({ ...adr, id })
    this.persist()
  }

  addIntentContract(contract: Omit<IntentContract, 'id' | 'createdAt'>): IntentContract {
    const full: IntentContract = {
      ...contract,
      id: `IC-${Date.now()}`,
      createdAt: Date.now()
    }
    return full
  }

  private async scanProjectFiles(projectPath: string): Promise<string[]> {
    // Dirs to skip regardless of nesting depth
    const SKIP_DIRS = new Set([
      'node_modules', '.git', 'dist', 'build', 'out', '.next', '.nuxt',
      '.turbo', '.cache', 'coverage', '__pycache__', '.venv', 'vendor'
    ])
    const MAX_FILES = 500   // safety cap — enough for AI context
    const MAX_DEPTH = 10    // fully recursive up to 10 levels

    const files: string[] = []

    const walk = async (dir: string, depth: number): Promise<void> => {
      if (depth > MAX_DEPTH || files.length >= MAX_FILES) return
      let entries: { name: string; path: string; isDirectory: boolean }[]
      try {
        entries = await window.api.fs.readDir(dir)
      } catch {
        return
      }
      for (const entry of entries) {
        if (files.length >= MAX_FILES) break
        if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) continue
        files.push(entry.path)
        if (entry.isDirectory) {
          await walk(entry.path, depth + 1)
        }
      }
    }

    await walk(projectPath, 0)
    return files
  }

  private async readFile(filePath: string): Promise<string | null> {
    try {
      return await window.api.fs.readFile(filePath)
    } catch {
      return null
    }
  }

  private async readArchitectureMd(projectPath: string): Promise<string | null> {
    return this.readFile(`${projectPath}/ARCHITECTURE.md`)
  }
}

export const dnaEngine = new DNAEngine()
