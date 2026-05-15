const ICON_FILES = (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 7a2 2 0 012-2h3.17a2 2 0 011.42.59l1.82 1.82A2 2 0 0012.83 8H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V7z"/>
  </svg>
)
const ICON_SEARCH = (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
    <circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/>
  </svg>
)
const ICON_GIT = (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
    <circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/>
    <path d="M6 9v6"/><path d="M15.7 6.7l-8.4 10.6"/>
  </svg>
)
const ICON_DNA = (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
    <path d="M12 3c-1.5 1.5-3 3-3 5s1.5 3.5 3 5 3 3.5 3 5-1.5 3.5-3 5"/>
    <path d="M12 3c1.5 1.5 3 3 3 5s-1.5 3.5-3 5-3 3.5-3 5 1.5 3.5 3 5"/>
    <path d="M9.5 8h5M9 12h6M9.5 16h5"/>
  </svg>
)
const ICON_SETTINGS = (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
    <circle cx="12" cy="12" r="3"/>
    <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/>
  </svg>
)

const TOP = [
  { id: 'files',  icon: ICON_FILES,    label: 'Explorer' },
  { id: 'search', icon: ICON_SEARCH,   label: 'Search' },
  { id: 'git',    icon: ICON_GIT,      label: 'Source Control' },
  { id: 'dna',    icon: ICON_DNA,      label: 'Project DNA' }
]

interface Props { active: string; onChange: (id: string) => void }

export function ActivityBar({ active, onChange }: Props) {
  return (
    <div style={{
      width: 48, flexShrink: 0,
      background: '#06070d',
      borderRight: '1px solid rgba(255,255,255,0.06)',
      display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
      alignItems: 'center', paddingTop: 8, paddingBottom: 8
    }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
        {TOP.map(item => {
          const isActive = active === item.id
          return (
            <button
              key={item.id}
              title={item.label}
              onClick={() => onChange(item.id)}
              style={{
                position: 'relative',
                width: 36, height: 36,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: isActive ? 'rgba(124,58,237,0.12)' : 'transparent',
                border: 'none', borderRadius: 8, cursor: 'pointer',
                color: isActive ? '#a78bfa' : 'rgba(255,255,255,0.3)',
                transition: 'all 0.15s ease'
              }}
              onMouseEnter={e => { if (!isActive) (e.currentTarget as HTMLElement).style.color = 'rgba(255,255,255,0.65)' }}
              onMouseLeave={e => { if (!isActive) (e.currentTarget as HTMLElement).style.color = 'rgba(255,255,255,0.3)' }}
            >
              {isActive && (
                <span style={{
                  position: 'absolute', left: -1, top: 8, bottom: 8,
                  width: 2, borderRadius: '0 2px 2px 0',
                  background: 'linear-gradient(to bottom, #a78bfa, #7c3aed)',
                  boxShadow: '0 0 8px rgba(167,139,250,0.6)'
                }} />
              )}
              {item.icon}
            </button>
          )
        })}
      </div>

      <button
        title="Settings"
        onClick={() => onChange('settings')}
        style={{
          width: 36, height: 36,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'transparent', border: 'none', borderRadius: 8, cursor: 'pointer',
          color: 'rgba(255,255,255,0.25)', transition: 'all 0.15s ease'
        }}
        onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = 'rgba(255,255,255,0.6)'}
        onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = 'rgba(255,255,255,0.25)'}
      >
        {ICON_SETTINGS}
      </button>
    </div>
  )
}
