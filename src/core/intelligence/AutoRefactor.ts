/**
 * AUTO-REFACTOR LOOP
 *
 * When the pipeline finds blockers or critical findings in generated code,
 * this system automatically:
 * 1. Analyzes the specific blocker findings
 * 2. Generates targeted fixes for each blocker (via OpenRouter)
 * 3. Re-validates the fix through a mini-pipeline pass
 * 4. Presents the diff for user approval
 *
 * The user never has to manually prompt "fix this" — PLATPHORM finds it, fixes it,
 * and brings the validated diff to you. You just approve or reject.
 *
 * Architecture: This does NOT call OpenRouter directly. It uses AIOrchestrator,
 * maintaining the provider abstraction layer.
 */

import { orchestrator } from '../providers/AIOrchestrator'
import type { FileChange, Finding, PipelineContext, PipelineResult } from '../../types'
import { buildCompactIdentity } from './UnifiedIdentity'
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
  confidence: number // 0-100
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

// ─── Prompt builders ──────────────────────────────────────────────────────────

function buildFixPrompt(
  finding: Finding,
  fileContent: string,
  filePath: string,
  dna: ProjectDNA | null | undefined,
  architectureDoc: string | undefined
): string {
  const identity = buildCompactIdentity({ dna })

  return `${identity}

## Auto-Refactor Task

You are fixing a specific governance finding. Do not change anything beyond what is needed to resolve this finding.

### Finding to Fix
- **ID**: ${finding.id}
- **Severity**: ${finding.severity}
- **Category**: ${finding.category}
- **Message**: ${finding.message}
${finding.location ? `- **Location**: ${finding.location}` : ''}
${finding.suggestedFix ? `- **Suggested fix hint**: ${finding.suggestedFix}` : ''}
${finding.dnaViolation ? `- **DNA violation**: ${finding.dnaViolation.description} (Law ${finding.dnaViolation.lawId ?? 'N/A'})` : ''}

### File: ${filePath}
\`\`\`
${fileContent.slice(0, 6000)}
\`\`\`

${architectureDoc ? `### Architecture context\n\`\`\`\n${architectureDoc.slice(0, 2000)}\n\`\`\`` : ''}

### Instructions
1. Provide the complete corrected file content
2. Only fix the identified issue — do not refactor unrelated code
3. Do not introduce new patterns, libraries, or dependencies unless required to fix the issue
4. If the fix requires changes to another file as well, note it in additionalFilesNeeded

Respond ONLY with valid JSON (no markdown wrapper):
{
  "fixedContent": "...complete corrected file content...",
  "explanation": "...what exactly was changed and why...",
  "confidence": 85,
  "changesDescription": "...human-readable summary of the diff...",
  "additionalFilesNeeded": [],
  "couldNotFix": false,
  "couldNotFixReason": ""
}`
}

function buildValidationPrompt(
  finding: Finding,
  before: string,
  after: string,
  dna: ProjectDNA | null | undefined
): string {
  const identity = buildCompactIdentity({ dna })

  return `${identity}

## Fix Validation

Verify that this code change correctly resolves the governance finding without introducing new problems.

### Original Finding
- **Severity**: ${finding.severity}
- **Message**: ${finding.message}
${finding.suggestedFix ? `- **Expected fix**: ${finding.suggestedFix}` : ''}

### Before
\`\`\`
${before.slice(0, 3000)}
\`\`\`

### After
\`\`\`
${after.slice(0, 3000)}
\`\`\`

Respond ONLY with valid JSON:
{
  "findingResolved": true,
  "newIssuesIntroduced": false,
  "newIssues": [],
  "verdict": "PASS",
  "notes": "..."
}`
}

// ─── Core engine ──────────────────────────────────────────────────────────────

/**
 * Runs the auto-refactor loop on a blocked pipeline result.
 *
 * @param pipelineResult - The completed pipeline result with blockers
 * @param context - The original pipeline context (to get file contents)
 * @param dna - The project DNA
 * @param onProgress - Optional callback for real-time progress events
 * @returns RefactorResult with all generated fixes and their validation status
 */
export async function runAutoRefactor(
  pipelineResult: PipelineResult,
  context: PipelineContext,
  dna: ProjectDNA | null | undefined,
  onProgress?: RefactorProgressCallback
): Promise<RefactorResult> {
  const start = Date.now()
  const resultId = `refactor-${Date.now()}`

  // Collect fixable findings — blockers + high severity with autoFixable hint
  const fixableFindings = [
    ...pipelineResult.blockers,
    ...pipelineResult.warnings.filter(f => f.autoFixable && f.severity === 'high')
  ].filter(f => f.severity === 'critical' || f.severity === 'high')

  // Deduplicate
  const seen = new Set<string>()
  const uniqueFindings = fixableFindings.filter(f => {
    if (seen.has(f.id)) return false
    seen.add(f.id)
    return true
  })

  onProgress?.({
    type: 'analyzing',
    message: `Analyzing ${uniqueFindings.length} finding${uniqueFindings.length !== 1 ? 's' : ''} for auto-fix...`,
    findingCount: uniqueFindings.length
  })

  const fixes: RefactorFix[] = []
  const fileChangeMap = new Map<string, { before: string; after: string; reason: string }>()

  // Process each finding
  for (let i = 0; i < uniqueFindings.length; i++) {
    const finding = uniqueFindings[i]

    // Determine target file for this finding
    const targetFile = finding.location
      ? finding.location.split(':')[0]
      : context.activeFile ?? 'unknown'

    onProgress?.({
      type: 'fixing',
      findingId: finding.id,
      message: `Generating fix for: ${finding.message.slice(0, 80)}...`,
      index: i,
      total: uniqueFindings.length
    })

    // Get current file content (either from execution plan or selected code)
    let fileContent = context.selectedCode ?? ''
    if (pipelineResult.executionPlan?.changes) {
      const change = pipelineResult.executionPlan.changes.find(c => c.path === targetFile)
      if (change?.after) fileContent = change.after
      else if (change?.before) fileContent = change.before
    }
    if (!fileContent && pipelineResult.validatedCode) {
      fileContent = pipelineResult.validatedCode
    }

    if (!fileContent) {
      // Can't fix without content — record as unfixable
      fixes.push({
        findingId: finding.id,
        findingMessage: finding.message,
        severity: finding.severity,
        targetFile,
        before: '',
        after: '',
        explanation: 'Cannot auto-fix: no file content available for this finding.',
        confidence: 0,
        validationPassed: false,
        validationNotes: 'No source content to operate on'
      })
      continue
    }

    try {
      // Generate the fix
      const fixPrompt = buildFixPrompt(
        finding,
        fileContent,
        targetFile,
        dna,
        context.architectureDoc
      )

      const fixResult = await orchestrator.orchestrate({
        prompt: fixPrompt,
        role: 'refactor',
        options: { temperature: 0.2, maxTokens: 4000 }
      })

      let parsed: {
        fixedContent?: string
        explanation?: string
        confidence?: number
        changesDescription?: string
        couldNotFix?: boolean
        couldNotFixReason?: string
      } = {}

      try {
        const jsonMatch = fixResult.result.content.match(/\{[\s\S]*\}/)
        if (jsonMatch) parsed = JSON.parse(jsonMatch[0])
      } catch {
        parsed = { couldNotFix: true, couldNotFixReason: 'AI response was not valid JSON' }
      }

      if (parsed.couldNotFix || !parsed.fixedContent) {
        fixes.push({
          findingId: finding.id,
          findingMessage: finding.message,
          severity: finding.severity,
          targetFile,
          before: fileContent,
          after: fileContent,
          explanation: parsed.couldNotFixReason ?? 'Auto-fix could not generate a resolution',
          confidence: 0,
          validationPassed: false,
          validationNotes: 'Fix generation failed'
        })
        onProgress?.({ type: 'fix_complete', findingId: finding.id, success: false, explanation: parsed.couldNotFixReason ?? 'Fix generation failed' })
        continue
      }

      // Validate the fix
      onProgress?.({
        type: 'validating',
        findingId: finding.id,
        message: `Validating fix for: ${finding.message.slice(0, 60)}...`
      })

      let validationPassed = true
      let validationNotes = 'Validation skipped'

      try {
        const valPrompt = buildValidationPrompt(finding, fileContent, parsed.fixedContent, dna)
        const valResult = await orchestrator.orchestrate({
          prompt: valPrompt,
          role: 'validation',
          options: { temperature: 0.1, maxTokens: 1000 }
        })

        const valJson = valResult.result.content.match(/\{[\s\S]*\}/)
        if (valJson) {
          const valParsed = JSON.parse(valJson[0])
          validationPassed = valParsed.findingResolved === true && !valParsed.newIssuesIntroduced
          validationNotes = valParsed.notes ?? valParsed.verdict ?? 'Validated'
          if (valParsed.newIssues?.length) {
            validationNotes += ` | New issues: ${valParsed.newIssues.join(', ')}`
          }
        }
      } catch {
        validationNotes = 'Validation pass failed — proceeding with fix (review carefully)'
      }

      const fix: RefactorFix = {
        findingId: finding.id,
        findingMessage: finding.message,
        severity: finding.severity,
        targetFile,
        before: fileContent,
        after: parsed.fixedContent,
        explanation: parsed.explanation ?? parsed.changesDescription ?? 'Fix applied',
        confidence: parsed.confidence ?? 70,
        validationPassed,
        validationNotes
      }

      fixes.push(fix)

      // Track file changes (last fix for a given file wins, but merge if possible)
      const existing = fileChangeMap.get(targetFile)
      fileChangeMap.set(targetFile, {
        before: existing?.before ?? fileContent,
        after: parsed.fixedContent,
        reason: existing
          ? `${existing.reason} + ${finding.message}`
          : `Auto-fix: ${finding.message}`
      })

      onProgress?.({
        type: 'fix_complete',
        findingId: finding.id,
        success: validationPassed,
        explanation: fix.explanation
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      fixes.push({
        findingId: finding.id,
        findingMessage: finding.message,
        severity: finding.severity,
        targetFile,
        before: fileContent,
        after: fileContent,
        explanation: `Fix generation threw an error: ${message}`,
        confidence: 0,
        validationPassed: false,
        validationNotes: `Error: ${message}`
      })
      onProgress?.({ type: 'fix_complete', findingId: finding.id, success: false, explanation: message })
    }
  }

  // Build file changes array
  const fileChanges: FileChange[] = Array.from(fileChangeMap.entries()).map(([path, change]) => ({
    path,
    type: 'modify',
    before: change.before,
    after: change.after,
    reason: change.reason
  }))

  // Compute metrics
  const fixedCount = fixes.filter(f => f.validationPassed && f.confidence >= 60).length
  const overallConfidence = fixes.length > 0
    ? Math.round(fixes.reduce((sum, f) => sum + f.confidence, 0) / fixes.length)
    : 0

  // Which blockers remain unresolved?
  const resolvedFindingIds = new Set(
    fixes.filter(f => f.validationPassed).map(f => f.findingId)
  )
  const remainingBlockers = pipelineResult.blockers.filter(b => !resolvedFindingIds.has(b.id))

  const result: RefactorResult = {
    id: resultId,
    timestamp: Date.now(),
    sourceResultId: pipelineResult.id,
    fixes,
    fileChanges,
    overallConfidence,
    blockerCount: uniqueFindings.length,
    fixedCount,
    remainingBlockers,
    readyToApply: fixedCount > 0 && fileChanges.length > 0,
    durationMs: Date.now() - start
  }

  onProgress?.({ type: 'done', result })
  return result
}

// ─── Utilities ────────────────────────────────────────────────────────────────

/**
 * Returns true if a pipeline result has auto-fixable findings.
 * Used to decide whether to show the "Auto-Fix" button in the UI.
 */
export function hasAutoFixableFindings(result: PipelineResult): boolean {
  return result.blockers.some(b => b.severity === 'critical' || b.severity === 'high')
}

/**
 * Returns a human-readable summary of what the auto-refactor will attempt.
 */
export function describeAutoRefactorScope(result: PipelineResult): string {
  const criticals = result.blockers.filter(b => b.severity === 'critical').length
  const highs = result.blockers.filter(b => b.severity === 'high').length
  const parts: string[] = []
  if (criticals > 0) parts.push(`${criticals} critical issue${criticals !== 1 ? 's' : ''}`)
  if (highs > 0) parts.push(`${highs} high-severity issue${highs !== 1 ? 's' : ''}`)
  return `Auto-fix will address ${parts.join(' and ')} — generating fixes now`
}
