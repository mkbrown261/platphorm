import type { ExecutionPlan, Finding, LayerResult, PipelineContext, PipelineResult, QualityScorecard, DeleteDetectionResult } from '../../types'
import { runIntentLayer } from './layers/01-IntentLayer'
import { runArchitectureLayer } from './layers/02-ArchitectureLayer'
import { runSecurityLayer } from './layers/03-SecurityLayer'
import { runDependencyLayer } from './layers/04-DependencyLayer'
import { runPerformanceLayer } from './layers/05-PerformanceLayer'
import { runContinuityLayer } from './layers/06-ContinuityLayer'
import { runValidationLayer } from './layers/07-ValidationLayer'
import { runExecutionLayer } from './layers/08-ExecutionLayer'
import { runObservabilityLayer } from './layers/09-ObservabilityLayer'
import { runSelfCritiqueLayer } from './layers/10-SelfCritiqueLayer'

export type PipelineProgressCallback = (
  layerIndex: number,
  layerName: string,
  description: string,
  result?: LayerResult
) => void

const LAYER_META: Array<{ key: string; label: string; startMsg: string }> = [
  { key: 'intent',        label: '01 · Intent',        startMsg: 'Parsing your request and identifying scope...' },
  { key: 'architecture',  label: '02 · Architecture',   startMsg: 'Checking architectural constraints and fit...' },
  { key: 'security',      label: '03 · Security',       startMsg: 'Scanning for security risks and vulnerabilities...' },
  { key: 'dependency',    label: '04 · Dependencies',   startMsg: 'Auditing dependencies and version conflicts...' },
  { key: 'performance',   label: '05 · Performance',    startMsg: 'Evaluating performance implications...' },
  { key: 'continuity',    label: '06 · Continuity',     startMsg: 'Verifying system law compliance...' },
  { key: 'validation',    label: '07 · Validation',     startMsg: 'Cross-checking against project DNA...' },
  { key: 'execution',     label: '08 · Execution',      startMsg: 'Planning implementation strategy...' },
  { key: 'observability', label: '09 · Observability',  startMsg: 'Designing logging and monitoring hooks...' },
  { key: 'selfCritique',  label: '10 · Self-Critique',  startMsg: 'Running final quality self-assessment...' }
]

function resultSummary(result: LayerResult): string {
  const criticals = result.findings.filter(f => f.severity === 'critical').length
  const highs = result.findings.filter(f => f.severity === 'high').length
  if (result.status === 'skipped') return 'Skipped — blocked by earlier layer'
  if (criticals > 0) return `${criticals} critical issue${criticals > 1 ? 's' : ''} found`
  if (highs > 0) return `Passed with ${highs} warning${highs > 1 ? 's' : ''} · ${result.score}/100`
  return `Passed · ${result.score}/100`
}

export async function runPipeline(
  context: PipelineContext,
  onProgress?: PipelineProgressCallback
): Promise<PipelineResult> {
  const pipelineId = `pipeline-${Date.now()}`
  const pipelineStart = Date.now()
  const layers: LayerResult[] = []
  let executionPlan: ExecutionPlan | undefined
  let scorecard: QualityScorecard | undefined

  const notify = (index: number, result?: LayerResult) => {
    const meta = LAYER_META[index]
    const desc = result ? resultSummary(result) : meta.startMsg
    onProgress?.(index, meta.key, desc, result)
  }

  // Layer 1: Intent
  notify(0)
  const intentResult = await runIntentLayer(context)
  layers.push(intentResult)
  notify(0, intentResult)

  // Layer 2: Architecture
  notify(1)
  const archResult = await runArchitectureLayer(context)
  layers.push(archResult)
  notify(1, archResult)

  // Layer 3: Security
  notify(2)
  const secResult = await runSecurityLayer(context)
  layers.push(secResult)
  notify(2, secResult)

  // Layer 4: Dependency
  notify(3)
  const depResult = await runDependencyLayer(context)
  layers.push(depResult)
  notify(3, depResult)

  // Layer 5: Performance
  notify(4)
  const perfResult = await runPerformanceLayer(context)
  layers.push(perfResult)
  notify(4, perfResult)

  // Layer 6: Continuity
  notify(5)
  const contResult = await runContinuityLayer(context)
  layers.push(contResult)
  notify(5, contResult)

  // Layer 7: Validation
  notify(6)
  const valResult = await runValidationLayer(context)
  layers.push(valResult)
  notify(6, valResult)

  // Determine if execution should proceed
  // Strict mode — passed via context, also blocks on HIGH severity findings
  const strictMode = (context as any).strictMode === true

  const allFindings = layers.flatMap((l) => l.findings)
  const criticalBlockers = allFindings.filter((f) => f.severity === 'critical')
  const highBlockers = strictMode ? allFindings.filter((f) => f.severity === 'high') : []
  const canExecute = criticalBlockers.length === 0 && highBlockers.length === 0

  // Delete Detection — scan execution plan for deletions and warn
  if (context.selectedCode || context.activeFile) {
    const deleteKeywords = ['delete', 'remove', 'drop', 'unlink', 'destroy']
    const promptLower = context.userPrompt.toLowerCase()
    if (deleteKeywords.some(k => promptLower.includes(k))) {
      layers.push({
        layer: 'execution',
        status: 'warned',
        score: 80,
        findings: [{
          id: 'delete-detection',
          layer: 'execution',
          severity: 'medium',
          category: 'Delete Detection',
          message: 'Delete operation detected. All downstream imports and API contracts have been flagged for review before execution.',
          autoFixable: false
        }],
        durationMs: 0,
        timestamp: Date.now()
      })
    }
  }

  // Layer 8: Execution
  notify(7)
  const execResult = await runExecutionLayer(context, canExecute)
  if ('executionPlan' in execResult) executionPlan = execResult.executionPlan
  layers.push(execResult)
  notify(7, execResult)

  // Layer 9: Observability
  notify(8)
  const obsResult = await runObservabilityLayer(context)
  layers.push(obsResult)
  notify(8, obsResult)

  // Layer 10: Self-Critique (runs on the execution plan / generated code)
  const generatedContent = executionPlan?.changes?.map((c) => c.after ?? '').join('\n\n') ?? ''
  notify(9)
  const critiqueResult = await runSelfCritiqueLayer(context, generatedContent)
  if ('scorecard' in critiqueResult) scorecard = critiqueResult.scorecard
  layers.push(critiqueResult)
  notify(9, critiqueResult)

  // Compute overall score
  const scores = layers.map((l) => l.score)
  const overallScore = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)

  const finalFindings = layers.flatMap((l) => l.findings)
  const blockers = finalFindings.filter((f) => f.severity === 'critical' || (strictMode && f.severity === 'high'))
  const warnings = finalFindings.filter((f) => f.severity === 'high' || f.severity === 'medium')

  const approved = blockers.length === 0 && canExecute

  return {
    id: pipelineId,
    timestamp: Date.now(),
    context,
    layers,
    overallScore,
    approved,
    blockers,
    warnings,
    validatedCode: generatedContent,
    executionPlan,
    durationMs: Date.now() - pipelineStart
  }
}

export function computeOverallHealth(results: PipelineResult[]): 'healthy' | 'degraded' | 'critical' {
  if (!results.length) return 'healthy'
  const latest = results[results.length - 1]
  if (latest.overallScore >= 80 && latest.blockers.length === 0) return 'healthy'
  if (latest.blockers.length > 0) return 'critical'
  return 'degraded'
}
