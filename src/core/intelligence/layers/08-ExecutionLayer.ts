import type { ExecutionPlan, FileChange, Finding, LayerResult, PipelineContext } from '../../../types'
import { orchestrator } from '../../providers/AIOrchestrator'
import { clampScore, parseLayerJSON, unparseableFinding } from '../utils'

export async function runExecutionLayer(
  context: PipelineContext,
  previousLayersPassed: boolean
): Promise<LayerResult & { executionPlan?: ExecutionPlan }> {
  const start = Date.now()

  if (!previousLayersPassed) {
    return {
      layer: 'execution',
      status: 'skipped',
      score: 0,
      findings: [
        {
          id: 'exec-blocked',
          layer: 'execution',
          severity: 'critical',
          category: 'Blocked',
          message: 'Execution blocked — previous layers have critical violations that must be resolved first',
          autoFixable: false
        } as Finding
      ],
      durationMs: Date.now() - start,
      timestamp: Date.now()
    }
  }

  // PLAN-ONLY: this layer previously asked the model to generate FULL FILE
  // CONTENTS inside a JSON field ("after"). That output was thrown away — the
  // agent does the real file work after governance approval — so it burned a
  // large, slow LLM call producing code nobody used, and large files routinely
  // truncated the JSON. The plan is what governance needs: which files, what
  // kind of change, why, and how risky.
  const prompt = `You are the Execution Layer of the PLATPHORM engineering OS.

All previous governance layers have passed. Produce a safe execution PLAN — do NOT generate file contents. Describe the changes; the agent implements them after approval.

Developer request: "${context.userPrompt}"
${context.selectedCode ? `\nContext code:\n\`\`\`\n${context.selectedCode}\n\`\`\`` : ''}
${context.activeFile ? `\nActive file: ${context.activeFile}` : ''}
${context.architectureDoc ? `\nArchitecture:\n${context.architectureDoc.slice(0, 2000)}` : ''}

Produce:
1. Exact list of file changes (create/modify/delete) — path, type, and reason only
2. Risk assessment (low/medium/high/critical)
3. Whether changes are reversible
4. Rollback plan
5. Affected services

Respond in JSON:
{
  "changes": [
    {
      "path": "src/...",
      "type": "create|modify|delete|rename",
      "reason": "one sentence describing the intended change"
    }
  ],
  "estimatedRisk": "low|medium|high|critical",
  "reversible": true,
  "rollbackPlan": "...",
  "affectedServices": [],
  "requiresApproval": false
}`

  try {
    const result = await orchestrator.orchestrate({ prompt, role: 'backend' })
    const { parsed, ok } = parseLayerJSON<any>(result.result.content)

    const executionPlan: ExecutionPlan = {
      changes: (parsed.changes ?? []) as FileChange[],
      estimatedRisk: parsed.estimatedRisk ?? 'medium',
      reversible: parsed.reversible ?? true,
      rollbackPlan: parsed.rollbackPlan ?? 'Revert file changes via git',
      affectedServices: parsed.affectedServices ?? [],
      requiresApproval: parsed.requiresApproval || parsed.estimatedRisk === 'critical'
    }

    return {
      layer: 'execution',
      status: ok ? 'passed' : 'warned',
      score: ok ? 100 : 60,
      findings: ok ? [] : [unparseableFinding('execution') as Finding],
      durationMs: Date.now() - start,
      timestamp: Date.now(),
      executionPlan
    }
  } catch {
    return {
      layer: 'execution',
      status: 'warned',
      score: 60,
      findings: [
        {
          id: 'exec-plan-failed',
          layer: 'execution',
          severity: 'medium',
          category: 'Execution',
          message: 'Could not generate execution plan — review manually',
          autoFixable: false
        } as Finding
      ],
      durationMs: Date.now() - start,
      timestamp: Date.now()
    }
  }
}
