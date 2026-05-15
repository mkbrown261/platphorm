/**
 * SPRINT SYSTEM
 *
 * Multi-agent parallel execution engine for complex feature sprints.
 *
 * Flow:
 *   1. User states a goal (e.g. "Add authentication with JWT + protected routes")
 *   2. Planner agent breaks it into N parallel tasks, each with a folder scope
 *   3. N sprint agents execute in parallel via OpenRouter — each with full DNA
 *   4. Coordinator agent reconciles all outputs into a conflict-free unified diff
 *   5. Result is presented as a unified FileChange[] ready for ApplyChangesModal
 *
 * Architecture: Uses AIOrchestrator for all AI calls. Never calls OpenRouter SDK directly.
 * Each agent gets the full UnifiedIdentity as its system prompt.
 */

import { orchestrator } from '../providers/AIOrchestrator'
import { buildSprintAgentIdentity, buildCoordinatorIdentity } from './UnifiedIdentity'
import type { FileChange, ProjectDNA } from '../../types'
import type { IdentityContext } from './UnifiedIdentity'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SprintTask {
  id: string
  title: string
  description: string
  scopedFolders: string[]
  estimatedFiles: string[]
  dependsOn: string[] // task IDs this task depends on
  role: 'backend' | 'frontend' | 'architect' | 'security' | 'general'
}

export interface SprintPlan {
  id: string
  goal: string
  tasks: SprintTask[]
  estimatedDuration: string
  riskLevel: 'low' | 'medium' | 'high'
  planNotes: string
}

export interface AgentOutput {
  taskId: string
  taskTitle: string
  agentIndex: number
  status: 'pending' | 'running' | 'done' | 'failed'
  filesWritten: string[]
  rawContent: string
  parsedFiles: Array<{ path: string; content: string; action: 'create' | 'modify' }>
  dependenciesAdded: string[]
  breakingChanges: string[]
  notes: string
  error?: string
  durationMs: number
}

export interface CoordinatorOutput {
  unifiedChanges: Array<{ path: string; content: string; action: 'create' | 'modify' }>
  conflicts: Array<{ file: string; agents: number[]; resolution: string }>
  blockers: Array<{ issue: string; agent: string; recommendation: string }>
  coordinatorNotes: string
  readyToApply: boolean
}

export interface SprintResult {
  id: string
  timestamp: number
  plan: SprintPlan
  agentOutputs: AgentOutput[]
  coordinatorOutput: CoordinatorOutput | null
  fileChanges: FileChange[]
  readyToApply: boolean
  blockers: string[]
  durationMs: number
}

export type SprintProgressEvent =
  | { type: 'planning'; message: string }
  | { type: 'plan_ready'; plan: SprintPlan }
  | { type: 'agents_starting'; count: number }
  | { type: 'agent_start'; taskId: string; title: string; index: number }
  | { type: 'agent_done'; taskId: string; title: string; index: number; filesWritten: number; success: boolean }
  | { type: 'coordinating'; message: string; agentCount: number }
  | { type: 'done'; result: SprintResult }
  | { type: 'error'; message: string }

export type SprintProgressCallback = (event: SprintProgressEvent) => void

// ─── Planner ──────────────────────────────────────────────────────────────────

function buildPlannerPrompt(goal: string, context: IdentityContext): string {
  const dna = context.dna
  const folderHints = dna?.folderStructure
    ? Object.entries(dna.folderStructure).map(([k, v]) => `  ${k}/: ${v}`).join('\n')
    : '  src/: source code\n  src/components/: React components\n  src/core/: business logic\n  src/store/: state management'

  return `You are PLATPHORM's Sprint Planner.

## Goal
${goal}

## Project Context
${dna?.identity?.systemName ? `Project: ${dna.identity.systemName}` : ''}
${dna?.identity?.corePurpose ? `Purpose: ${dna.identity.corePurpose}` : ''}

## Folder Structure
${folderHints}

## Architecture Document
${context.architectureDoc ? context.architectureDoc.slice(0, 3000) : 'Not provided'}

## Task
Break this goal into 2-6 parallel tasks that can be executed simultaneously by independent agents.

Rules:
- Each task must have a clear folder scope so agents don't conflict
- Tasks that share a file must be merged into one task
- Each task must be completable without needing output from sibling tasks (unless dependency is declared)
- If one task logically must come first (e.g. types/interfaces before implementations), mark it as a dependency
- Keep tasks focused — one task per concern area (e.g. "backend service", "UI components", "routing", "tests")

Respond ONLY with valid JSON (no markdown wrapper):
{
  "tasks": [
    {
      "id": "task-1",
      "title": "...",
      "description": "...detailed implementation instructions...",
      "scopedFolders": ["src/core/auth/", "src/store/"],
      "estimatedFiles": ["src/core/auth/AuthService.ts", "src/store/authStore.ts"],
      "dependsOn": [],
      "role": "backend"
    }
  ],
  "estimatedDuration": "~15 minutes",
  "riskLevel": "medium",
  "planNotes": "..."
}`
}

// ─── Agent executor ───────────────────────────────────────────────────────────

function buildAgentPrompt(
  task: SprintTask,
  allTasks: SprintTask[],
  completedOutputs: AgentOutput[],
  context: IdentityContext,
  agentIndex: number,
  totalAgents: number
): string {
  const identity = buildSprintAgentIdentity(
    context,
    task.description,
    task.scopedFolders,
    agentIndex,
    totalAgents
  )

  // Include outputs from dependencies
  const depOutputs = completedOutputs.filter(o =>
    task.dependsOn.includes(o.taskId)
  )
  const depContext = depOutputs.length > 0
    ? `\n## Dependency Outputs (files written by tasks you depend on)\n${
        depOutputs.flatMap(o =>
          o.parsedFiles.map(f => `### ${f.path}\n\`\`\`\n${f.content.slice(0, 2000)}\n\`\`\``)
        ).join('\n\n')
      }`
    : ''

  return `${identity}${depContext}

## Your Task
**Title**: ${task.title}

${task.description}

**Expected files to create/modify**:
${task.estimatedFiles.map(f => `  - ${f}`).join('\n')}

## Output Format
For each file, output in this exact format:

FILE: src/path/to/file.ts
\`\`\`typescript
...complete file content...
\`\`\`

After ALL files, output a JSON summary block:
\`\`\`json
{
  "filesWritten": ["src/path/to/file.ts"],
  "dependenciesAdded": [],
  "breakingChanges": [],
  "notes": "Brief summary of what was built"
}
\`\`\`

IMPORTANT: Output complete file contents. No partial edits. No TODOs.`
}

function parseAgentOutput(rawContent: string): {
  parsedFiles: Array<{ path: string; content: string; action: 'create' | 'modify' }>
  filesWritten: string[]
  dependenciesAdded: string[]
  breakingChanges: string[]
  notes: string
} {
  const parsedFiles: Array<{ path: string; content: string; action: 'create' | 'modify' }> = []

  // Parse FILE: path blocks
  const fileBlockRegex = /FILE:\s*([^\n]+)\n```(?:\w+)?\n([\s\S]*?)```/g
  let match: RegExpExecArray | null
  while ((match = fileBlockRegex.exec(rawContent)) !== null) {
    const path = match[1].trim()
    const content = match[2].trim()
    if (path && content) {
      parsedFiles.push({ path, content, action: 'create' })
    }
  }

  // Parse JSON summary
  let filesWritten: string[] = parsedFiles.map(f => f.path)
  let dependenciesAdded: string[] = []
  let breakingChanges: string[] = []
  let notes = ''

  const jsonMatch = rawContent.match(/```json\s*(\{[\s\S]*?\})\s*```/)
  if (jsonMatch) {
    try {
      const summary = JSON.parse(jsonMatch[1])
      if (Array.isArray(summary.filesWritten)) filesWritten = summary.filesWritten
      if (Array.isArray(summary.dependenciesAdded)) dependenciesAdded = summary.dependenciesAdded
      if (Array.isArray(summary.breakingChanges)) breakingChanges = summary.breakingChanges
      if (summary.notes) notes = summary.notes
    } catch {
      notes = 'Could not parse agent summary JSON'
    }
  }

  return { parsedFiles, filesWritten, dependenciesAdded, breakingChanges, notes }
}

// ─── Coordinator ──────────────────────────────────────────────────────────────

function buildCoordinatorPrompt(
  plan: SprintPlan,
  agentOutputs: AgentOutput[],
  context: IdentityContext
): string {
  const identity = buildCoordinatorIdentity(context, plan.goal)

  const agentSections = agentOutputs.map((output, i) => {
    const files = output.parsedFiles.map(f =>
      `### FILE: ${f.path}\n\`\`\`\n${f.content.slice(0, 3000)}\n\`\`\``
    ).join('\n\n')

    return `## Agent ${i + 1}: ${output.taskTitle}
**Status**: ${output.status}
**Files produced**: ${output.filesWritten.join(', ') || 'none'}
**Notes**: ${output.notes}
${output.breakingChanges.length ? `**Breaking changes**: ${output.breakingChanges.join(', ')}` : ''}

${files}`
  }).join('\n\n---\n\n')

  return `${identity}

## Sprint Goal
${plan.goal}

## All Agent Outputs

${agentSections}

## Your Job
1. Reconcile all agent outputs into a single coherent implementation
2. Resolve any import conflicts, type conflicts, or duplicate exports
3. Ensure cross-agent dependencies are correctly satisfied
4. Output the final unified file set

Respond ONLY with valid JSON (no markdown wrapper):
{
  "unifiedChanges": [
    { "path": "src/...", "content": "...complete file content...", "action": "create" }
  ],
  "conflicts": [
    { "file": "src/...", "agents": [1, 2], "resolution": "Used agent 1's version with agent 2's imports merged" }
  ],
  "blockers": [
    { "issue": "...", "agent": "Agent 2", "recommendation": "..." }
  ],
  "coordinatorNotes": "...",
  "readyToApply": true
}`
}

function parseCoordinatorOutput(raw: string): CoordinatorOutput | null {
  try {
    const jsonMatch = raw.match(/\{[\s\S]*"unifiedChanges"[\s\S]*\}/)
    if (!jsonMatch) return null
    const parsed = JSON.parse(jsonMatch[0])
    return {
      unifiedChanges: Array.isArray(parsed.unifiedChanges) ? parsed.unifiedChanges : [],
      conflicts: Array.isArray(parsed.conflicts) ? parsed.conflicts : [],
      blockers: Array.isArray(parsed.blockers) ? parsed.blockers : [],
      coordinatorNotes: parsed.coordinatorNotes ?? '',
      readyToApply: parsed.readyToApply === true
    }
  } catch {
    return null
  }
}

// ─── Main entry point ─────────────────────────────────────────────────────────

/**
 * Runs the complete sprint system from goal to unified diff.
 *
 * @param goal - Natural language description of what to build
 * @param context - IdentityContext with DNA and architecture doc
 * @param projectPath - Root path of the project
 * @param onProgress - Real-time progress callback
 * @returns SprintResult with all file changes ready for apply
 */
export async function runSprint(
  goal: string,
  context: IdentityContext,
  projectPath: string,
  onProgress?: SprintProgressCallback
): Promise<SprintResult> {
  const start = Date.now()
  const sprintId = `sprint-${Date.now()}`

  // Phase 1: Planning
  onProgress?.({ type: 'planning', message: 'Breaking goal into parallel tasks...' })

  let plan: SprintPlan
  try {
    const plannerResult = await orchestrator.orchestrate({
      prompt: buildPlannerPrompt(goal, context),
      role: 'architect',
      options: { temperature: 0.3, maxTokens: 3000 }
    })

    const jsonMatch = plannerResult.result.content.match(/\{[\s\S]*"tasks"[\s\S]*\}/)
    if (!jsonMatch) throw new Error('Planner did not return valid JSON')

    const parsed = JSON.parse(jsonMatch[0])
    plan = {
      id: `plan-${Date.now()}`,
      goal,
      tasks: (parsed.tasks ?? []).map((t: SprintTask, i: number) => ({
        ...t,
        id: t.id ?? `task-${i + 1}`
      })),
      estimatedDuration: parsed.estimatedDuration ?? 'Unknown',
      riskLevel: parsed.riskLevel ?? 'medium',
      planNotes: parsed.planNotes ?? ''
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    onProgress?.({ type: 'error', message: `Sprint planning failed: ${message}` })
    return {
      id: sprintId,
      timestamp: Date.now(),
      plan: { id: 'failed', goal, tasks: [], estimatedDuration: '', riskLevel: 'high', planNotes: message },
      agentOutputs: [],
      coordinatorOutput: null,
      fileChanges: [],
      readyToApply: false,
      blockers: [`Planning failed: ${message}`],
      durationMs: Date.now() - start
    }
  }

  onProgress?.({ type: 'plan_ready', plan })

  // Phase 2: Parallel agent execution
  // Sort tasks by dependency order
  const independentTasks = plan.tasks.filter(t => t.dependsOn.length === 0)
  const dependentTasks = plan.tasks.filter(t => t.dependsOn.length > 0)

  const allAgentOutputs: AgentOutput[] = []
  const totalAgents = plan.tasks.length

  onProgress?.({ type: 'agents_starting', count: totalAgents })

  // Execute independent tasks in parallel
  if (independentTasks.length > 0) {
    const agentPromises = independentTasks.map((task, i) => {
      onProgress?.({ type: 'agent_start', taskId: task.id, title: task.title, index: i })

      const agentStart = Date.now()
      const agentPrompt = buildAgentPrompt(task, plan.tasks, [], context, i, totalAgents)

      return orchestrator.orchestrate({
        prompt: agentPrompt,
        role: task.role as any,
        options: { temperature: 0.25, maxTokens: 6000 }
      }).then(result => {
        const parsed = parseAgentOutput(result.result.content)
        const output: AgentOutput = {
          taskId: task.id,
          taskTitle: task.title,
          agentIndex: i,
          status: 'done',
          rawContent: result.result.content,
          ...parsed,
          durationMs: Date.now() - agentStart
        }
        allAgentOutputs.push(output)
        onProgress?.({
          type: 'agent_done',
          taskId: task.id,
          title: task.title,
          index: i,
          filesWritten: parsed.filesWritten.length,
          success: true
        })
        return output
      }).catch(err => {
        const message = err instanceof Error ? err.message : String(err)
        const output: AgentOutput = {
          taskId: task.id,
          taskTitle: task.title,
          agentIndex: i,
          status: 'failed',
          filesWritten: [],
          rawContent: '',
          parsedFiles: [],
          dependenciesAdded: [],
          breakingChanges: [],
          notes: '',
          error: message,
          durationMs: Date.now() - agentStart
        }
        allAgentOutputs.push(output)
        onProgress?.({ type: 'agent_done', taskId: task.id, title: task.title, index: i, filesWritten: 0, success: false })
        return output
      })
    })

    await Promise.all(agentPromises)
  }

  // Execute dependent tasks sequentially (after their dependencies are done)
  for (let i = 0; i < dependentTasks.length; i++) {
    const task = dependentTasks[i]
    const taskIndex = independentTasks.length + i

    onProgress?.({ type: 'agent_start', taskId: task.id, title: task.title, index: taskIndex })

    const agentStart = Date.now()
    const agentPrompt = buildAgentPrompt(task, plan.tasks, allAgentOutputs, context, taskIndex, totalAgents)

    try {
      const result = await orchestrator.orchestrate({
        prompt: agentPrompt,
        role: task.role as any,
        options: { temperature: 0.25, maxTokens: 6000 }
      })
      const parsed = parseAgentOutput(result.result.content)
      const output: AgentOutput = {
        taskId: task.id,
        taskTitle: task.title,
        agentIndex: taskIndex,
        status: 'done',
        rawContent: result.result.content,
        ...parsed,
        durationMs: Date.now() - agentStart
      }
      allAgentOutputs.push(output)
      onProgress?.({ type: 'agent_done', taskId: task.id, title: task.title, index: taskIndex, filesWritten: parsed.filesWritten.length, success: true })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      allAgentOutputs.push({
        taskId: task.id,
        taskTitle: task.title,
        agentIndex: taskIndex,
        status: 'failed',
        filesWritten: [],
        rawContent: '',
        parsedFiles: [],
        dependenciesAdded: [],
        breakingChanges: [],
        notes: '',
        error: message,
        durationMs: Date.now() - agentStart
      })
      onProgress?.({ type: 'agent_done', taskId: task.id, title: task.title, index: taskIndex, filesWritten: 0, success: false })
    }
  }

  // Phase 3: Coordinator reconciliation
  const successfulOutputs = allAgentOutputs.filter(o => o.status === 'done' && o.parsedFiles.length > 0)
  let coordinatorOutput: CoordinatorOutput | null = null
  let fileChanges: FileChange[] = []

  if (successfulOutputs.length > 0) {
    onProgress?.({ type: 'coordinating', message: 'Reconciling agent outputs into unified diff...', agentCount: successfulOutputs.length })

    try {
      const coordResult = await orchestrator.orchestrate({
        prompt: buildCoordinatorPrompt(plan, successfulOutputs, context),
        role: 'architect',
        options: { temperature: 0.15, maxTokens: 8000 }
      })

      coordinatorOutput = parseCoordinatorOutput(coordResult.result.content)

      if (coordinatorOutput?.unifiedChanges) {
        fileChanges = coordinatorOutput.unifiedChanges.map(change => ({
          path: change.path,
          type: change.action === 'modify' ? 'modify' : 'create',
          after: change.content,
          reason: `Sprint: ${goal}`
        }))
      }
    } catch (err) {
      // If coordinator fails, fall back to direct agent outputs
      const message = err instanceof Error ? err.message : String(err)
      coordinatorOutput = {
        unifiedChanges: [],
        conflicts: [],
        blockers: [{ issue: `Coordinator failed: ${message}`, agent: 'Coordinator', recommendation: 'Review agent outputs manually' }],
        coordinatorNotes: 'Coordinator failed — using direct agent outputs',
        readyToApply: false
      }

      // Fallback: collect all parsed files from agents (last writer wins)
      const fileMap = new Map<string, string>()
      for (const output of successfulOutputs) {
        for (const file of output.parsedFiles) {
          fileMap.set(file.path, file.content)
        }
      }
      fileChanges = Array.from(fileMap.entries()).map(([path, content]) => ({
        path,
        type: 'create' as const,
        after: content,
        reason: `Sprint fallback: ${goal}`
      }))
    }
  }

  // Collect sprint-level blockers
  const failedAgents = allAgentOutputs.filter(o => o.status === 'failed')
  const blockers: string[] = [
    ...failedAgents.map(a => `Agent "${a.taskTitle}" failed: ${a.error ?? 'Unknown error'}`),
    ...(coordinatorOutput?.blockers ?? []).map(b => `${b.issue} (${b.agent})`),
  ]

  const result: SprintResult = {
    id: sprintId,
    timestamp: Date.now(),
    plan,
    agentOutputs: allAgentOutputs,
    coordinatorOutput,
    fileChanges,
    readyToApply: fileChanges.length > 0 && blockers.length === 0,
    blockers,
    durationMs: Date.now() - start
  }

  onProgress?.({ type: 'done', result })
  return result
}
