import { useDNAStore } from '../../store/dnaStore'

export function DNAPanel() {
  const { dna, isInitializing, isInitialized, initError } = useDNAStore()

  if (isInitializing) {
    return (
      <div className="p-4 font-mono">
        <div className="text-xs text-violet-400 animate-pulse mb-2">Analyzing project DNA...</div>
        <div className="text-xs text-slate-600">
          PLATPHORM is reading your codebase and generating the architectural identity.
        </div>
      </div>
    )
  }

  if (initError) {
    return (
      <div className="p-4 font-mono">
        <div className="text-xs text-red-400 mb-2">DNA initialization failed</div>
        <div className="text-xs text-slate-600">{initError}</div>
      </div>
    )
  }

  if (!dna) {
    return (
      <div className="p-4 font-mono text-center">
        <div className="text-slate-600 text-xs mb-3">No project open</div>
        <div className="text-xs text-slate-700">
          Open a folder to initialize project DNA
        </div>
      </div>
    )
  }

  return (
    <div className="p-3 font-mono text-xs space-y-4 overflow-y-auto">
      {/* Identity */}
      <section>
        <div className="text-violet-400 uppercase tracking-widest text-[10px] mb-2">
          Architectural Identity
        </div>
        <div className="text-slate-200 font-semibold mb-1">{dna.identity.systemName}</div>
        <div className="text-slate-500 leading-relaxed">{dna.identity.corePurpose}</div>
      </section>

      {/* Always/Never */}
      {dna.identity.alwaysDoes.length > 0 && (
        <section>
          <div className="text-emerald-500/60 uppercase tracking-widest text-[10px] mb-2">Always</div>
          {dna.identity.alwaysDoes.map((a, i) => (
            <div key={i} className="text-slate-500 flex gap-2 mb-1">
              <span className="text-emerald-600">+</span>
              <span>{a}</span>
            </div>
          ))}
        </section>
      )}

      {dna.identity.neverDoes.length > 0 && (
        <section>
          <div className="text-red-500/60 uppercase tracking-widest text-[10px] mb-2">Never</div>
          {dna.identity.neverDoes.map((n, i) => (
            <div key={i} className="text-slate-500 flex gap-2 mb-1">
              <span className="text-red-600">−</span>
              <span>{n}</span>
            </div>
          ))}
        </section>
      )}

      {/* System Laws */}
      {dna.systemLaws.length > 0 && (
        <section>
          <div className="text-violet-400 uppercase tracking-widest text-[10px] mb-2">
            System Laws ({dna.systemLaws.length})
          </div>
          {dna.systemLaws.slice(0, 10).map((law) => (
            <div key={law.id} className="flex gap-2 mb-1.5 items-start">
              <span className="text-slate-700 flex-shrink-0">
                {String(law.id).padStart(2, '0')}
              </span>
              <span className="text-slate-500">{law.rule}</span>
              {law.locked && (
                <span className="flex-shrink-0 text-amber-600 text-[9px]">LOCKED</span>
              )}
            </div>
          ))}
        </section>
      )}

      {/* Locked Systems */}
      {dna.lockedSystems.length > 0 && (
        <section>
          <div className="text-amber-500/60 uppercase tracking-widest text-[10px] mb-2">
            Locked Systems
          </div>
          {dna.lockedSystems.map((s, i) => (
            <div key={i} className="flex items-center gap-2 mb-1">
              <span
                className={`text-[9px] px-1 rounded ${
                  s.status === 'LOCKED'
                    ? 'bg-red-900/50 text-red-400'
                    : s.status === 'CONTEXT_LOCKED'
                      ? 'bg-amber-900/50 text-amber-400'
                      : 'bg-emerald-900/50 text-emerald-400'
                }`}
              >
                {s.status}
              </span>
              <span className="text-slate-400">{s.name}</span>
            </div>
          ))}
        </section>
      )}

      {/* ADRs */}
      {dna.adrs.length > 0 && (
        <section>
          <div className="text-blue-400/60 uppercase tracking-widest text-[10px] mb-2">
            ADRs ({dna.adrs.length})
          </div>
          {dna.adrs.map((adr) => (
            <div key={adr.id} className="mb-2 border border-[#1a1a2e] rounded p-2">
              <div className="text-slate-400 font-semibold">{adr.id}: {adr.decision}</div>
              <div className="text-slate-600 mt-0.5">{adr.reason}</div>
              <div className={`text-[9px] mt-1 ${adr.status === 'LOCKED' ? 'text-amber-500' : 'text-slate-600'}`}>
                {adr.status}
              </div>
            </div>
          ))}
        </section>
      )}

      <div className="text-[9px] text-slate-700 pt-2 border-t border-[#1a1a2e]">
        Last updated: {new Date(dna.lastUpdated).toLocaleString()} · v{dna.version}
      </div>
    </div>
  )
}
