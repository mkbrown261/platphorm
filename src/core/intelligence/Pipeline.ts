import type { ExecutionPlan, Finding, LayerResult, PipelineContext, PipelineResult, QualityScorecard } from '../../types'
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
  result?: LayerResult
) => void

export async function runPipeline(
  context: PipelineContext,
  onProgress?: PipelineProgressCallback
): Promise<PipelineResult> {
  const pipelineId = `pipeline-${Date.now()}`
  const pipelineStart = Date.now()
  const layers: LayerResult[] = []
  let executionPlan: ExecutionPlan | undefined
  let scorecard: QualityScorecard | undefined

  const notify = (index: number, name: string, result?: LayerResult) => {
    onProgress?.(index, name, result)
  }

  // Layer 1: Intent
  notify(0, 'intent')
  const intentResult = await runIntentLayer(context)
  layers.push(intentResult)
  notify(0, 'intent', intentResult)

  // Layer 2: Architecture
  notify(1, 'architecture')
  const archResult = await runArchitectureLayer(context)
  layers.push(archResult)
  notify(1, 'architecture', archResult)

  // Layer 3: Security
  notify(2, 'security')
  const secResult = await runSecurityLayer(context)
  layers.push(secResult)
  notify(2, 'security', secResult)

  // Layer 4: Dependency
  notify(3, 'dependency')
  const depResult = await runDependencyLayer(context)
  layers.push(depResult)
  notify(3, 'dependency', depResult)

  // Layer 5: Performance
  notify(4, 'performance')
  const perfResult = await runPerformanceLayer(context)
  layers.push(perfResult)
  notify(4, 'performance', perfResult)

  // Layer 6: Continuity
  notify(5, 'continuity')
  const contResult = await runContinuityLayer(context)
  layers.push(contResult)
  notify(5, 'continuity', contResult)

  // Layer 7: Validation
  notify(6, 'validation')
  const valResult = await runValidationLayer(context)
  layers.push(valResult)
  notify(6, 'validation', valResult)

  // Determine if execution should proceed (no critical blockers in layers 1-7)
  const criticalBlockers = layers.flatMap((l) => l.findings).filter((f) => f.severity === 'critical')
  const canExecute = criticalBlockers.length === 0

  // Layer 8: Execution
  notify(7, 'execution')
  const execResult = await runExecutionLayer(context, canExecute)
  if ('executionPlan' in execResult) executionPlan = execResult.executionPlan
  layers.push(execResult)
  notify(7, 'execution', execResult)

  // Layer 9: Observability
  notify(8, 'observability')
  const obsResult = await runObservabilityLayer(context)
  layers.push(obsResult)
  notify(8, 'observability', obsResult)

  // Layer 10: Self-Critique (runs on the execution plan / generated code)
  const generatedContent = executionPlan?.changes?.map((c) => c.after ?? '').join('\n\n') ?? ''
  notify(9, 'selfCritique')
  const critiqueResult = await runSelfCritiqueLayer(context, generatedContent)
  if ('scorecard' in critiqueResult) scorecard = critiqueResult.scorecard
  layers.push(critiqueResult)
  notify(9, 'selfCritique', critiqueResult)

  // Compute overall score
  const scores = layers.map((l) => l.score)
  const overallScore = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)

  const allFindings = layers.flatMap((l) => l.findings)
  const blockers = allFindings.filter((f) => f.severity === 'critical')
  const warnings = allFindings.filter((f) => f.severity === 'high' || f.severity === 'medium')

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
