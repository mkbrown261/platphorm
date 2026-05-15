interface ActivityBarProps {
  active: string
  onChange: (id: string) => void
}

const items = [
  {
    id: 'files',
    label: 'Explorer',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 7a2 2 0 012-2h3.172a2 2 0 011.414.586l1.828 1.828A2 2 0 0012.828 8H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V7z"/>
      </svg>
    )
  },
  {
    id: 'search',
    label: 'Search',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/>
      </svg>
    )
  },
  {
    id: 'git',
    label: 'Source Control',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/>
        <path d="M6 9v6M15.7 6.7l-8.4 10.6"/>
      </svg>
    )
  },
  {
    id: 'dna',
    label: 'Project DNA',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 3c-1.5 1.5-3 3-3 5s1.5 3.5 3 5 3 3.5 3 5-1.5 3.5-3 5"/>
        <path d="M12 3c1.5 1.5 3 3 3 5s-1.5 3.5-3 5-3 3.5-3 5 1.5 3.5 3 5"/>
        <path d="M9 7.5h6M9 12h6M9 16.5h6"/>
      </svg>
    )
  }
]

const bottomItems = [
  {
    id: 'settings',
    label: 'Settings',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="3"/>
        <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1z"/>
      </svg>
    )
  }
]

export function ActivityBar({ active, onChange }: ActivityBarProps) {
  return (
    <div className="flex flex-col justify-between w-12 flex-shrink-0 bg-base-950 border-r border-base-500/40 py-2">
      <div className="flex flex-col items-center gap-1">
        {/* Logo */}
        <div className="w-8 h-8 mb-3 flex items-center justify-center">
          <div className="w-5 h-5 rounded bg-violet-600 flex items-center justify-center">
            <span className="text-[9px] font-bold text-white tracking-tight">P</span>
          </div>
        </div>

        {items.map((item) => (
          <button
            key={item.id}
            title={item.label}
            onClick={() => onChange(item.id)}
            className={`
              relative w-9 h-9 flex items-center justify-center rounded-md transition-all duration-150
              ${active === item.id
                ? 'text-violet-400 bg-violet-500/10'
                : 'text-base-400 hover:text-slate-300 hover:bg-white/5'
              }
            `}
          >
            {active === item.id && (
              <span className="absolute left-0 top-2.5 bottom-2.5 w-0.5 rounded-r bg-violet-500 -ml-[1px]" />
            )}
            {item.icon}
          </button>
        ))}
      </div>

      <div className="flex flex-col items-center gap-1">
        {bottomItems.map((item) => (
          <button
            key={item.id}
            title={item.label}
            onClick={() => onChange(item.id)}
            className={`
              w-9 h-9 flex items-center justify-center rounded-md transition-all duration-150
              ${active === item.id
                ? 'text-violet-400 bg-violet-500/10'
                : 'text-base-400 hover:text-slate-300 hover:bg-white/5'
              }
            `}
          >
            {item.icon}
          </button>
        ))}
      </div>
    </div>
  )
}
