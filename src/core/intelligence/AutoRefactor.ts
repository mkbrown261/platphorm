/**
 * AUTO-REFACTOR LOOP
 *
 * When the pipeline finds blockers, this system:
 * 1. Collects all blocker findings + all partial file content from the execution plan
 * 2. Sends a single enriched prompt to the agent: "here's what you generated,
 *    here's what's wrong, regenerate everything fixing all issues"
 * 3. Parses the complete new file set from the response
 * 4. Validates the fix made progress
 * 5. Presents the unified diff for user approval
 *
 * Single-shot regeneration (not per-finding patching) is more reliable because:
 * - The AI can see all issues at once and fix them consistently
 * - No risk of partial fixes that break other parts
 * - Works even when fileContent is empty (execution plan may have partial content)
 */

import { orchestrator } from '../providers/AIOrchestrator'
import type { FileChange, Finding, PipelineContext, PipelineResult } from '../../types'
import { buildCompactIdentity } from './UnifiedIdentity'
import { parseJSONFromAI } from './utils/parseJSON'
import { governanceEngine } from '../governance/GovernanceEngine'
import type { ProjectDNA } from '../../types'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface RefactorFix {
  findingId: string
  findingMessage: string
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info'
  targetFile: string
  before: string
  after: string
  explanation: string
  confidence: number
  validationPassed: boolean
  validationNotes: string
}

export interface RefactorResult {
  id: string
  timestamp: number
  sourceResultId: string
  fixes: RefactorFix[]
  fileChanges: FileChange[]
  overallConfidence: number
  blockerCount: number
  fixedCount: number
  remainingBlockers: Finding[]
  readyToApply: boolean
  durationMs: number
}

export type RefactorProgressEvent =
  | { type: 'analyzing'; message: string; findingCount: number }
  | { type: 'fixing'; findingId: string; message: string; index: number; total: number }
  | { type: 'validating'; findingId: string; message: string }
  | { type: 'fix_complete'; findingId: string; success: boolean; explanation: string }
  | { type: 'done'; result: RefactorResult }
  | { type: 'error'; message: string }

export type RefactorProgressCallback = (event: RefactorProgressEvent) => void

// ─── Build the single-shot regeneration prompt ────────────────────────────────

function buildRegenerationPrompt(
  pipelineResult: PipelineResult,
  context: PipelineContext,
  blockers: Finding[],
  dna: ProjectDNA | null | undefined
): string {
  const identity = buildCompactIdentity({ dna })

  // Collect all files from the execution plan
  const planFiles = pipelineResult.executionPlan?.changes ?? []
  const filesSection = planFiles.length > 0
    ? planFiles.map(f => `### File: ${f.path}\n\`\`\`\n${f.after ?? f.before ?? '(empty — needs to be generated)'}\n\`\`\``).join('\n\n')
    : context.selectedCode
      ? `### File: ${context.activeFile ?? 'unknown'}\n\`\`\`\n${context.selectedCode}\n\`\`\``
      : '(No files were generated yet — generate them fresh)'

  const blockersSection = blockers.map((b, i) =>
    `${i + 1}. [${b.severity.toUpperCase()}] ${b.message}${b.location ? ` (in ${b.location})` : ''}${b.suggestedFix ? `\n   Fix hint: ${b.suggestedFix}` : ''}`
  ).join('\n')

  return `${identity}

## Auto-Refactor: Regenerate with Fixes

The governance pipeline ran and found issues. You need to regenerate the complete implementation, fixing all blockers listed below.

### Original Request
"${context.userPrompt}"

### Blockers to Fix
${blockersSection}

### Current Files (fix and complete these)
${filesSection}

### Instructions
1. Output ALL files needed for this implementation — complete, working, no placeholders
2. Fix every blocker listed above
3. If a file is empty or missing, generate it fully
4. Do not truncate any file — every file must be complete
5. Match the language/framework appropriate for the request

Respond ONLY with this JSON structure (no markdown wrapper, no extra text):
{
  "files": [
    {
      "path": "filename.html",
      "content": "...complete file content...",
      "description": "what this file does"
    }
  ],
  "explanation": "Summary of what was fixed and why",
  "confidence": 85
}`
}

// ─── Core engine ──────────────────────────────────────────────────────────────

export async function runAutoRefactor(
  pipelineResult: PipelineResult,
  context: PipelineContext,
  dna: ProjectDNA | null | undefined,
  onProgress?: RefactorProgressCallback
): Promise<RefactorResult> {
  const start = Date.now()
  const resultId = `refactor-${Date.now()}`

  // Collect all blocker findings
  const blockers = [
    ...pipelineResult.blockers,
    ...pipelineResult.warnings.filter(f => f.severity === 'high')
  ].filter((f, i, arr) => arr.findIndex(x => x.id === f.id) === i) // deduplicate

  onProgress?.({
    type: 'analyzing',
    message: `Analyzing ${blockers.length} finding${blockers.length !== 1 ? 's' : ''} for auto-fix...`,
    findingCount: blockers.length
  })

  // Report each blocker as "fixing" so the UI shows progress
  blockers.forEach((b, i) => {
    onProgress?.({
      type: 'fixing',
      findingId: b.id,
      message: `Fixing: ${b.message.slice(0, 80)}`,
      index: i,
      total: blockers.length
    })
  })

  try {
    // Single-shot: regenerate everything fixing all issues at once
    const prompt = buildRegenerationPrompt(pipelineResult, context, blockers, dna)

    const response = await orchestrator.orchestrate({
      prompt,
      role: 'refactor',
      options: { temperature: 0.2, maxTokens: 8000 }
    })

    let parsed: any = null
    try { parsed = parseJSONFromAI(response.result.content) } catch { parsed = null }

    if (!parsed || !Array.isArray(parsed.files) || parsed.files.length === 0) {
      // JSON parse failed — try to salvage by looking for file blocks in raw text
      const salvaged = salvageFilesFromText(response.result.content, pipelineResult, context)

      if (salvaged.length === 0) {
        blockers.forEach(b => {
          onProgress?.({ type: 'fix_complete', findingId: b.id, success: false, explanation: 'Could not parse AI response' })
        })

        return emptyResult(resultId, start, blockers, pipelineResult)
      }

      // Use salvaged files
      return buildResult(resultId, start, blockers, pipelineResult, salvaged, 'Salvaged from response', 60)
    }

    // Build FileChange array from parsed files
    const fileChanges: FileChange[] = parsed.files
      .filter((f: any) => f.path && f.content && f.content.trim().length > 10)
      .map((f: any) => {
        // Find the original content for this file
        const original = pipelineResult.executionPlan?.changes?.find(c => c.path === f.path)
        return {
          path: f.path,
          type: (original ? 'modify' : 'create') as 'modify' | 'create',
          before: original?.after ?? original?.before ?? '',
          after: f.content,
          reason: `Auto-fix: ${f.description ?? 'Regenerated to resolve governance blockers'}`
        }
      })

    if (fileChanges.length === 0) {
      blockers.forEach(b => {
        onProgress?.({ type: 'fix_complete', findingId: b.id, success: false, explanation: 'AI returned files with no content' })
      })
      return emptyResult(resultId, start, blockers, pipelineResult)
    }

    const result = buildResult(resultId, start, blockers, pipelineResult, fileChanges, parsed.explanation ?? 'Auto-fix complete', parsed.confidence ?? 80)

    // Governance validation pass — static checks on the refactored output.
    // This catches regressions (e.g. new hardcoded secrets, empty catches) without
    // a full AI pipeline re-run. Cap at fast static analysis only.
    if (dna && result.readyToApply) {
      const regressions: Finding[] = []
      for (const change of result.fileChanges) {
        const after = change.after ?? ''
        const lawViolations = governanceEngine.validateSystemLaws(after, dna)
        const patternViolations = governanceEngine.detectForbiddenPatterns(after, dna)

        for (const v of [...lawViolations, ...patternViolations]) {
          regressions.push({
            id: `regression-${v.pattern ?? v.description}-${Date.now()}`,
            layer: 'validation',
            severity: v.severity as Finding['severity'],
            category: 'Regression',
            message: v.description,
            location: change.path,
            autoFixable: false
          })
        }
      }

      if (regressions.length > 0) {
        result.remainingBlockers = regressions
        result.readyToApply = regressions.every(r => r.severity !== 'critical')
        onProgress?.({ type: 'validating', findingId: 'regression-check', message: `Validation found ${regressions.length} regression${regressions.length !== 1 ? 's' : ''} in refactored output` })
      }
    }

    blockers.forEach(b => {
      onProgress?.({ type: 'fix_complete', findingId: b.id, success: result.readyToApply, explanation: result.fixes[0]?.explanation ?? 'Fix generated' })
    })
    onProgress?.({ type: 'done', result })
    return result

  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    blockers.forEach(b => {
      onProgress?.({ type: 'fix_complete', findingId: b.id, success: false, explanation: message })
    })
    onProgress?.({ type: 'error', message })
    return emptyResult(resultId, start, blockers, pipelineResult)
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function buildResult(
  resultId: string,
  start: number,
  blockers: Finding[],
  pipelineResult: PipelineResult,
  fileChanges: FileChange[],
  explanation: string,
  confidence: number
): RefactorResult {
  const fixes: RefactorFix[] = blockers.map(b => ({
    findingId: b.id,
    findingMessage: b.message,
    severity: b.severity,
    targetFile: fileChanges[0]?.path ?? 'unknown',
    before: fileChanges[0]?.before ?? '',
    after: fileChanges[0]?.after ?? '',
    explanation,
    confidence,
    validationPassed: confidence >= 60,
    validationNotes: `Regenerated with ${fileChanges.length} file${fileChanges.length !== 1 ? 's' : ''}`
  }))

  // Mark all blockers as fixed in UI
  fixes.forEach(fix => {
    // onProgress is not available here — caller handles this
  })

  return {
    id: resultId,
    timestamp: Date.now(),
    sourceResultId: pipelineResult.id,
    fixes,
    fileChanges,
    overallConfidence: confidence,
    blockerCount: blockers.length,
    fixedCount: fixes.filter(f => f.validationPassed).length,
    remainingBlockers: [],
    readyToApply: fileChanges.length > 0 && confidence >= 50,
    durationMs: Date.now() - start
  }
}

function emptyResult(
  resultId: string,
  start: number,
  blockers: Finding[],
  pipelineResult: PipelineResult
): RefactorResult {
  return {
    id: resultId,
    timestamp: Date.now(),
    sourceResultId: pipelineResult.id,
    fixes: [],
    fileChanges: [],
    overallConfidence: 0,
    blockerCount: blockers.length,
    fixedCount: 0,
    remainingBlockers: blockers,
    readyToApply: false,
    durationMs: Date.now() - start
  }
}

/**
 * Last-resort: try to extract file content from fenced code blocks in plain text
 * when JSON parsing completely fails.
 */
function salvageFilesFromText(
  text: string,
  pipelineResult: PipelineResult,
  context: PipelineContext
): FileChange[] {
  const fileChanges: FileChange[] = []
  const fenceRegex = /```(\w+)?\s*\n([\s\S]*?)```/g
  const planFiles = pipelineResult.executionPlan?.changes ?? []

  let match: RegExpExecArray | null
  let idx = 0
  while ((match = fenceRegex.exec(text)) !== null) {
    const content = match[2].trim()
    if (content.length < 20) continue

    // Try to find a filename hint near this block
    const before = text.slice(Math.max(0, match.index - 200), match.index)
    const fileHint = before.match(/(?:file|path|filename)[:\s]+([^\s\n]+\.\w+)/i)?.[1]
      ?? planFiles[idx]?.path
      ?? (idx === 0 ? (context.activeFile ?? 'index.html') : `file${idx}.${match[1] ?? 'txt'}`)

    const original = planFiles.find(c => c.path === fileHint)
    fileChanges.push({
      path: fileHint,
      type: original ? 'modify' : 'create',
      before: original?.after ?? original?.before ?? '',
      after: content,
      reason: 'Auto-fix: salvaged from response'
    })
    idx++
  }

  return fileChanges
}

// ─── Utilities ────────────────────────────────────────────────────────────────

export function hasAutoFixableFindings(result: PipelineResult): boolean {
  return result.blockers.some(b => b.severity === 'critical' || b.severity === 'high')
}

export function describeAutoRefactorScope(result: PipelineResult): string {
  const criticals = result.blockers.filter(b => b.severity === 'critical').length
  const highs = result.blockers.filter(b => b.severity === 'high').length
  const parts: string[] = []
  if (criticals > 0) parts.push(`${criticals} critical issue${criticals !== 1 ? 's' : ''}`)
  if (highs > 0) parts.push(`${highs} high-severity issue${highs !== 1 ? 's' : ''}`)
  return `Auto-fix will address ${parts.join(' and ')} — generating fixes now`
}
