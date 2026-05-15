import type { ExecutionPlan, FileChange, Finding, LayerResult, PipelineContext } from '../../../types'
import { orchestrator } from '../../providers/AIOrchestrator'

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

  const prompt = `You are the Execution Layer of the PLATPHORM engineering OS.

All previous governance layers have passed. Now produce a safe execution plan.

Developer request: "${context.userPrompt}"
${context.selectedCode ? `\nContext code:\n\`\`\`\n${context.selectedCode}\n\`\`\`` : ''}
${context.activeFile ? `\nActive file: ${context.activeFile}` : ''}
${context.architectureDoc ? `\nArchitecture:\n${context.architectureDoc.slice(0, 2000)}` : ''}

Produce:
1. Exact list of file changes (create/modify/delete)
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
      "reason": "...",
      "after": "... full file content or diff ..."
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
    const parsed = JSON.parse(extractJSON(result.result.content))

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
      status: 'passed',
      score: 100,
      findings: [],
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

function extractJSON(text: string): string {
  const match = text.match(/\{[\s\S]*\}/)
  return match ? match[0] : '{}'
}
