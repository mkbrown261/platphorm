/**
 * SPRINT PANEL
 *
 * UI for the Sprint System — multi-agent parallel execution.
 * User states a goal, PLATPHORM breaks it into tasks, spawns agents,
 * coordinates outputs, and presents a unified diff for approval.
 */

import { useState, useRef, useCallback } from 'react'
import { useDNAStore } from '../../store/dnaStore'
import { useProjectStore } from '../../store/projectStore'
import { useGovernanceStore } from '../../store/governanceStore'
import { runSprint, type SprintPlan, type SprintResult, type SprintProgressEvent, type AgentOutput } from '../../core/intelligence/SprintSystem'
import { ApplyChangesModal } from '../pipeline/ApplyChangesModal'
import type { ExecutionPlan } from '../../types'

// ─── Sub-components ───────────────────────────────────────────────────────────

function PlanPreview({ plan }: { plan: SprintPlan }) {
  const riskColor = plan.riskLevel === 'low' ? '#22c55e' : plan.riskLevel === 'medium' ? '#f59e0b' : '#ef4444'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', display: 'flex', alignItems: 'center', gap: 4 }}>
          <span>⏱</span>
          <span>{plan.estimatedDuration}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '2px 8px', borderRadius: 99, background: `rgba(${riskColor === '#22c55e' ? '34,197,94' : riskColor === '#f59e0b' ? '245,158,11' : '239,68,68'},0.1)`, border: `1px solid ${riskColor}30` }}>
          <span style={{ fontSize: 10, color: riskColor, fontFamily: 'monospace' }}>{plan.riskLevel.toUpperCase()} RISK</span>
        </div>
        <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', fontFamily: 'monospace' }}>{plan.tasks.length} task{plan.tasks.length !== 1 ? 's' : ''}</div>
      </div>

      {plan.tasks.map((task, i) => (
        <div key={task.id} style={{
          padding: '10px 12px', borderRadius: 8,
          background: 'rgba(255,255,255,0.03)',
          border: '1px solid rgba(255,255,255,0.07)'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <div style={{
              width: 20, height: 20, borderRadius: 6, flexShrink: 0,
              background: 'rgba(124,58,237,0.2)', border: '1px solid rgba(124,58,237,0.3)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 9, color: '#a78bfa', fontFamily: 'monospace', fontWeight: 700
            }}>
              {i + 1}
            </div>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'rgba(255,255,255,0.8)' }}>{task.title}</div>
            <div style={{ marginLeft: 'auto', padding: '1px 6px', borderRadius: 4, background: 'rgba(124,58,237,0.1)', fontSize: 9, color: '#a78bfa', fontFamily: 'monospace' }}>
              {task.role}
            </div>
          </div>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', lineHeight: 1.5, marginBottom: 6 }}>{task.description.slice(0, 120)}{task.description.length > 120 ? '...' : ''}</div>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {task.scopedFolders.map(f => (
              <span key={f} style={{ fontSize: 9, color: 'rgba(167,139,250,0.6)', background: 'rgba(124,58,237,0.07)', padding: '2px 6px', borderRadius: 4, fontFamily: 'monospace' }}>
                {f}
              </span>
            ))}
          </div>
          {task.dependsOn.length > 0 && (
            <div style={{ marginTop: 4, fontSize: 9, color: 'rgba(255,255,255,0.25)' }}>
              depends on: {task.dependsOn.join(', ')}
            </div>
          )}
        </div>
      ))}

      {plan.planNotes && (
        <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', fontStyle: 'italic', padding: '6px 10px', background: 'rgba(255,255,255,0.02)', borderRadius: 6, borderLeft: '2px solid rgba(124,58,237,0.3)' }}>
          {plan.planNotes}
        </div>
      )}
    </div>
  )
}

function AgentTracker({ outputs }: { outputs: AgentOutput[] }) {
  if (!outputs.length) return null
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {outputs.map((o) => {
        const running = o.status === 'running'
        const failed = o.status === 'failed'
        const done = o.status === 'done'
        const dotColor = running ? '#a78bfa' : done ? '#22c55e' : failed ? '#ef4444' : 'rgba(255,255,255,0.2)'

        return (
          <div key={o.taskId} style={{
            display: 'flex', alignItems: 'flex-start', gap: 10,
            padding: '8px 12px', borderRadius: 8,
            background: running ? 'rgba(124,58,237,0.06)' : 'rgba(255,255,255,0.02)',
            border: `1px solid ${running ? 'rgba(124,58,237,0.2)' : 'rgba(255,255,255,0.06)'}`,
            borderLeft: `3px solid ${dotColor}`
          }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.3)', fontFamily: 'monospace' }}>Agent {o.agentIndex + 1}</span>
                <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.7)', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{o.taskTitle}</span>
              </div>
              {o.status === 'done' && o.filesWritten.length > 0 && (
                <div style={{ fontSize: 10, color: 'rgba(34,197,94,0.7)', marginTop: 2 }}>
                  ✓ {o.filesWritten.length} file{o.filesWritten.length !== 1 ? 's' : ''} written
                  {o.notes && <span style={{ color: 'rgba(255,255,255,0.3)', marginLeft: 6 }}>— {o.notes.slice(0, 60)}</span>}
                </div>
              )}
              {o.status === 'failed' && (
                <div style={{ fontSize: 10, color: 'rgba(239,68,68,0.7)', marginTop: 2 }}>
                  ✗ {o.error?.slice(0, 80) ?? 'Failed'}
                </div>
              )}
            </div>
            <div style={{ flexShrink: 0 }}>
              {running ? (
                <div style={{ width: 12, height: 12, border: '1.5px solid rgba(167,139,250,0.3)', borderTopColor: '#a78bfa', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
              ) : done ? (
                <span style={{ fontSize: 10, color: '#4ade80' }}>✓</span>
              ) : failed ? (
                <span style={{ fontSize: 10, color: '#f87171' }}>✗</span>
              ) : null}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ─── Status log ───────────────────────────────────────────────────────────────

interface LogEntry {
  message: string
  type: 'info' | 'success' | 'error' | 'agent'
  timestamp: number
}

// ─── Main component ───────────────────────────────────────────────────────────

export function SprintPanel() {
  const [goal, setGoal] = useState('')
  const [running, setRunning] = useState(false)
  const [phase, setPhase] = useState<'idle' | 'planning' | 'agents' | 'coordinating' | 'done' | 'error'>('idle')
  const [plan, setPlan] = useState<SprintPlan | null>(null)
  const [agentOutputs, setAgentOutputs] = useState<AgentOutput[]>([])
  const [sprintResult, setSprintResult] = useState<SprintResult | null>(null)
  const [log, setLog] = useState<LogEntry[]>([])
  const [pendingPlan, setPendingPlan] = useState<{ plan: ExecutionPlan; result: any } | null>(null)

  const { dna } = useDNAStore()
  const { activeProject } = useProjectStore()
  const { appendAudit } = useGovernanceStore()
  const taRef = useRef<HTMLTextAreaElement>(null)

  const addLog = useCallback((message: string, type: LogEntry['type'] = 'info') => {
    setLog(prev => [...prev.slice(-50), { message, type, timestamp: Date.now() }])
  }, [])

  const upsertAgent = useCallback((output: Partial<AgentOutput> & { taskId: string }) => {
    setAgentOutputs(prev => {
      const idx = prev.findIndex(o => o.taskId === output.taskId)
      if (idx >= 0) {
        const next = [...prev]
        next[idx] = { ...next[idx], ...output } as AgentOutput
        return next
      }
      return [...prev, output as AgentOutput]
    })
  }, [])

  const handleStart = useCallback(async () => {
    if (!goal.trim() || running) return
    if (!activeProject) {
      addLog('Open a project first to use Sprint mode', 'error')
      return
    }

    setRunning(true)
    setPhase('planning')
    setPlan(null)
    setAgentOutputs([])
    setSprintResult(null)
    setLog([])

    const context = { dna, architectureDoc: undefined, projectPath: activeProject.rootPath }

    // Try to read ARCHITECTURE.md
    try {
      const content = await (window as any).api?.fs?.readFile(`${activeProject.rootPath}/ARCHITECTURE.md`)
      if (content) (context as any).architectureDoc = content
    } catch { /* no-op */ }

    const onProgress = (event: SprintProgressEvent) => {
      switch (event.type) {
        case 'planning':
          addLog(event.message, 'info')
          break
        case 'plan_ready':
          setPlan(event.plan)
          setPhase('agents')
          addLog(`Plan ready — ${event.plan.tasks.length} tasks, ${event.plan.estimatedDuration}`, 'success')
          break
        case 'agents_starting':
          addLog(`Starting ${event.count} parallel agent${event.count !== 1 ? 's' : ''}...`, 'info')
          break
        case 'agent_start':
          upsertAgent({ taskId: event.taskId, taskTitle: event.title, agentIndex: event.index, status: 'running', filesWritten: [], rawContent: '', parsedFiles: [], dependenciesAdded: [], breakingChanges: [], notes: '', durationMs: 0 })
          addLog(`Agent ${event.index + 1}: ${event.title}`, 'agent')
          break
        case 'agent_done':
          upsertAgent({
            taskId: event.taskId,
            taskTitle: event.title,
            agentIndex: event.index,
            status: event.success ? 'done' : 'failed',
            filesWritten: []
          })
          addLog(`Agent ${event.index + 1} ${event.success ? `✓ (${event.filesWritten} files)` : '✗ failed'}`, event.success ? 'success' : 'error')
          break
        case 'coordinating':
          setPhase('coordinating')
          addLog(event.message, 'info')
          break
        case 'done':
          setSprintResult(event.result)
          setPhase('done')
          addLog(`Sprint complete — ${event.result.fileChanges.length} file${event.result.fileChanges.length !== 1 ? 's' : ''} ready`, 'success')
          appendAudit({
            id: `audit-sprint-${Date.now()}`,
            timestamp: Date.now(),
            action: 'sprint_run',
            actor: 'ai',
            target: goal.slice(0, 80),
            approved: event.result.readyToApply,
            pipelineResultId: event.result.id,
            immutable: true
          })
          break
        case 'error':
          setPhase('error')
          addLog(`Error: ${event.message}`, 'error')
          break
      }
    }

    try {
      const result = await runSprint(goal.trim(), context, activeProject.rootPath, onProgress)
      setSprintResult(result)
      setAgentOutputs(result.agentOutputs)

      if (result.readyToApply && result.fileChanges.length > 0) {
        // Auto-open apply modal
        const fakeExecutionPlan: ExecutionPlan = {
          changes: result.fileChanges,
          estimatedRisk: result.plan.riskLevel === 'low' ? 'low' : result.plan.riskLevel === 'high' ? 'high' : 'medium',
          reversible: true,
          rollbackPlan: 'git stash before apply, restore with git checkout',
          affectedServices: result.plan.tasks.map(t => t.title),
          requiresApproval: true
        }
        setPendingPlan({ plan: fakeExecutionPlan, result })
      }
    } catch (err) {
      setPhase('error')
      addLog(`Sprint error: ${String(err)}`, 'error')
    }

    setRunning(false)
  }, [goal, running, activeProject, dna, addLog, upsertAgent, appendAudit])

  const handleReset = () => {
    setGoal('')
    setPhase('idle')
    setPlan(null)
    setAgentOutputs([])
    setSprintResult(null)
    setLog([])
    setPendingPlan(null)
  }

  const canApply = sprintResult?.readyToApply && sprintResult.fileChanges.length > 0

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <>
      <div style={{
        height: '100%', display: 'flex', flexDirection: 'column',
        overflow: 'hidden', background: '#090a11'
      }}>
        {/* Header */}
        <div style={{ padding: '14px 16px', borderBottom: '1px solid rgba(255,255,255,0.06)', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <div style={{ width: 7, height: 7, borderRadius: '50%', background: running ? '#a78bfa' : phase === 'done' ? '#22c55e' : phase === 'error' ? '#ef4444' : 'rgba(255,255,255,0.2)', boxShadow: running ? '0 0 10px #a78bfa' : 'none', animation: running ? 'glow 1.5s ease-in-out infinite' : 'none' }} />
            <span style={{ fontSize: 13, fontWeight: 700, color: 'rgba(255,255,255,0.85)', letterSpacing: 0.3 }}>SPRINT</span>
            <span style={{ fontSize: 10, color: 'rgba(167,139,250,0.5)', fontFamily: 'monospace', letterSpacing: 0.5, marginLeft: 2 }}>MULTI-AGENT</span>
          </div>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', lineHeight: 1.4 }}>
            State a goal. PLATPHORM breaks it into parallel tasks and spawns agents with DNA truth.
          </div>
        </div>

        {/* Content */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 14 }}>

          {/* Goal input */}
          {phase === 'idle' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', marginBottom: 6, fontWeight: 500 }}>Sprint Goal</div>
                <textarea
                  ref={taRef}
                  value={goal}
                  onChange={e => setGoal(e.target.value)}
                  placeholder="Add JWT authentication with protected routes, user profiles, and role-based access control..."
                  rows={4}
                  style={{
                    width: '100%', resize: 'vertical',
                    background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)',
                    borderRadius: 8, padding: '10px 12px', fontSize: 13,
                    color: 'rgba(255,255,255,0.8)', fontFamily: 'inherit',
                    outline: 'none', lineHeight: 1.5, boxSizing: 'border-box'
                  }}
                  onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleStart() }}
                />
              </div>

              {/* Example goals */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.2)' }}>Examples:</div>
                {[
                  'Add JWT authentication with protected routes',
                  'Build a settings page with user preferences',
                  'Add a REST API layer with input validation',
                  'Create a notification system with real-time updates'
                ].map(ex => (
                  <button key={ex} onClick={() => { setGoal(ex); taRef.current?.focus() }}
                    style={{ textAlign: 'left', padding: '7px 10px', background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 7, cursor: 'pointer', fontSize: 11, color: 'rgba(255,255,255,0.35)', fontFamily: 'inherit', transition: 'all 0.15s' }}
                    onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(124,58,237,0.07)'; (e.currentTarget as HTMLElement).style.borderColor = 'rgba(124,58,237,0.2)'; (e.currentTarget as HTMLElement).style.color = 'rgba(255,255,255,0.6)' }}
                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.02)'; (e.currentTarget as HTMLElement).style.borderColor = 'rgba(255,255,255,0.06)'; (e.currentTarget as HTMLElement).style.color = 'rgba(255,255,255,0.35)' }}
                  >
                    {ex}
                  </button>
                ))}
              </div>

              {!activeProject && (
                <div style={{ padding: '8px 12px', background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.15)', borderRadius: 8, fontSize: 11, color: 'rgba(239,68,68,0.7)' }}>
                  Open a project first to use Sprint mode
                </div>
              )}
            </div>
          )}

          {/* Plan preview */}
          {plan && phase !== 'idle' && (
            <div>
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', marginBottom: 8, fontWeight: 500 }}>SPRINT PLAN</div>
              <PlanPreview plan={plan} />
            </div>
          )}

          {/* Agent tracker */}
          {agentOutputs.length > 0 && (
            <div>
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', marginBottom: 8, fontWeight: 500 }}>
                AGENTS
                {running && <span style={{ marginLeft: 8, fontSize: 10, color: '#a78bfa', fontFamily: 'monospace' }}>running in parallel</span>}
              </div>
              <AgentTracker outputs={agentOutputs} />
            </div>
          )}

          {/* Sprint result summary */}
          {sprintResult && phase === 'done' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', borderRadius: 8, background: canApply ? 'rgba(34,197,94,0.06)' : 'rgba(239,68,68,0.06)', border: `1px solid ${canApply ? 'rgba(34,197,94,0.2)' : 'rgba(239,68,68,0.2)'}` }}>
                <span style={{ fontSize: 12 }}>{canApply ? '✓' : '⚠'}</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: canApply ? '#86efac' : '#fca5a5' }}>
                    {canApply ? 'Sprint complete — ready to apply' : 'Sprint completed with issues'}
                  </div>
                  <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', marginTop: 2 }}>
                    {sprintResult.fileChanges.length} file{sprintResult.fileChanges.length !== 1 ? 's' : ''} •
                    {sprintResult.agentOutputs.filter(o => o.status === 'done').length}/{sprintResult.agentOutputs.length} agents succeeded •
                    {Math.round(sprintResult.durationMs / 1000)}s
                  </div>
                </div>
              </div>

              {sprintResult.blockers.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {sprintResult.blockers.map((b, i) => (
                    <div key={i} style={{ fontSize: 11, color: 'rgba(239,68,68,0.7)', padding: '5px 10px', background: 'rgba(239,68,68,0.05)', borderRadius: 6, borderLeft: '2px solid rgba(239,68,68,0.4)' }}>
                      {b}
                    </div>
                  ))}
                </div>
              )}

              {sprintResult.coordinatorOutput?.coordinatorNotes && (
                <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', padding: '6px 10px', background: 'rgba(255,255,255,0.02)', borderRadius: 6, borderLeft: '2px solid rgba(124,58,237,0.3)' }}>
                  {sprintResult.coordinatorOutput.coordinatorNotes}
                </div>
              )}
            </div>
          )}

          {/* Activity log */}
          {log.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.2)', marginBottom: 4 }}>LOG</div>
              {log.slice(-20).map((entry, i) => (
                <div key={i} style={{ fontSize: 10, fontFamily: 'monospace', color: entry.type === 'error' ? 'rgba(239,68,68,0.6)' : entry.type === 'success' ? 'rgba(34,197,94,0.6)' : entry.type === 'agent' ? 'rgba(167,139,250,0.6)' : 'rgba(255,255,255,0.25)', lineHeight: 1.5 }}>
                  {entry.message}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer actions */}
        <div style={{ padding: '10px 14px', borderTop: '1px solid rgba(255,255,255,0.06)', display: 'flex', gap: 8, flexShrink: 0 }}>
          {phase === 'idle' ? (
            <button
              onClick={handleStart}
              disabled={!goal.trim() || !activeProject || running}
              style={{
                flex: 1, height: 36, borderRadius: 8, border: 'none', cursor: goal.trim() && activeProject ? 'pointer' : 'not-allowed',
                background: goal.trim() && activeProject ? 'linear-gradient(135deg, #7c3aed, #4f46e5)' : 'rgba(255,255,255,0.05)',
                color: goal.trim() && activeProject ? 'white' : 'rgba(255,255,255,0.2)',
                fontSize: 13, fontWeight: 600, transition: 'all 0.2s',
                boxShadow: goal.trim() && activeProject ? '0 0 20px rgba(124,58,237,0.3)' : 'none'
              }}
            >
              ⚡ Start Sprint
            </button>
          ) : (
            <>
              {canApply && (
                <button
                  onClick={() => {
                    if (!sprintResult) return
                    const ep: ExecutionPlan = {
                      changes: sprintResult.fileChanges,
                      estimatedRisk: sprintResult.plan.riskLevel === 'low' ? 'low' : sprintResult.plan.riskLevel === 'high' ? 'high' : 'medium',
                      reversible: true,
                      rollbackPlan: 'git stash before apply',
                      affectedServices: sprintResult.plan.tasks.map(t => t.title),
                      requiresApproval: true
                    }
                    setPendingPlan({ plan: ep, result: sprintResult })
                  }}
                  style={{
                    flex: 1, height: 36, borderRadius: 8, border: 'none', cursor: 'pointer',
                    background: 'linear-gradient(135deg, #059669, #047857)',
                    color: 'white', fontSize: 13, fontWeight: 600,
                    boxShadow: '0 0 16px rgba(5,150,105,0.3)'
                  }}
                >
                  Apply {sprintResult?.fileChanges.length} files ↗
                </button>
              )}
              <button
                onClick={handleReset}
                disabled={running}
                style={{
                  height: 36, padding: '0 14px', borderRadius: 8,
                  background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)',
                  color: 'rgba(255,255,255,0.4)', fontSize: 12, cursor: 'pointer'
                }}
              >
                New Sprint
              </button>
            </>
          )}
        </div>
      </div>

      {/* Apply modal */}
      {pendingPlan && (
        <ApplyChangesModal
          plan={pendingPlan.plan}
          projectPath={activeProject?.rootPath ?? ''}
          onApply={(results) => {
            setPendingPlan(null)
            const successCount = results.filter(r => r.success).length
            addLog(`Applied ${successCount}/${results.length} files ✓`, 'success')
          }}
          onReject={() => {
            setPendingPlan(null)
            addLog('Sprint changes rejected — no files modified', 'info')
          }}
        />
      )}
    </>
  )
}
