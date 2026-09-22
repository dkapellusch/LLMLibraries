import type { ReactNode } from 'react'

export type IconName = 'archive' | 'arrow-left' | 'arrow-right' | 'bookmark' | 'calendar' | 'check' | 'chevron-down' | 'chevron-right' | 'clock' | 'filter' | 'globe' | 'info' | 'library' | 'loader' | 'lock' | 'logout' | 'menu' | 'pin' | 'refresh' | 'search' | 'settings' | 'star' | 'x'

interface IconProps {
  name: IconName
  size?: number
  strokeWidth?: number
  className?: string
}

export function Icon({ name, size = 20, strokeWidth = 1.7, className }: IconProps) {
  const common = { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, className, 'aria-hidden': true }
  const paths: Record<IconName, ReactNode> = {
    archive: <><path d="M4 6.5h16v13H4z" /><path d="M3 3.5h18v3H3zM9 10.5h6M8 14h8" /></>,
    'arrow-left': <><path d="m14.5 5-7 7 7 7" /><path d="M8 12h12" /></>,
    'arrow-right': <><path d="m9.5 5 7 7-7 7" /><path d="M4 12h12" /></>,
    bookmark: <path d="M6 4.5A1.5 1.5 0 0 1 7.5 3h9A1.5 1.5 0 0 1 18 4.5V21l-6-3.5L6 21z" />,
    calendar: <><rect x="3.5" y="5" width="17" height="16" rx="2" /><path d="M7.5 3v4M16.5 3v4M3.5 9h17" /></>,
    check: <path d="m5 12 4.5 4.5L19 7" />,
    'chevron-down': <path d="m6 9 6 6 6-6" />,
    'chevron-right': <path d="m9 5 7 7-7 7" />,
    clock: <><circle cx="12" cy="12" r="8.5" /><path d="M12 7v5l3.5 2" /></>,
    filter: <><path d="M4 6h16M7 12h10M10 18h4" /></>,
    globe: <><circle cx="12" cy="12" r="8.5" /><path d="M3.7 9h16.6M3.7 15h16.6M12 3.5c2.1 2.3 3.1 5.1 3.1 8.5s-1 6.2-3.1 8.5c-2.1-2.3-3.1-5.1-3.1-8.5S9.9 5.8 12 3.5z" /></>,
    info: <><circle cx="12" cy="12" r="8.5" /><path d="M12 10.5v5M12 7.5h.01" /></>,
    library: <><path d="M4 20V5.5L12 3l8 2.5V20" /><path d="M4 8.5 12 6l8 2.5M8 9v7M12 8v7M16 9v7" /></>,
    loader: <path d="M12 3a9 9 0 1 0 9 9" />,
    lock: <><rect x="5" y="10" width="14" height="10" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></>,
    logout: <><path d="M10 4H5.5A1.5 1.5 0 0 0 4 5.5v13A1.5 1.5 0 0 0 5.5 20H10M15 16l4-4-4-4M19 12H9" /></>,
    menu: <><path d="M4 7h16M4 12h16M4 17h16" /></>,
    pin: <><path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0Z" /><circle cx="12" cy="10" r="2.3" /></>,
    refresh: <><path d="M20 11a8 8 0 0 0-14.9-3.9L4 9" /><path d="M4 5v4h4M4 13a8 8 0 0 0 14.9 3.9L20 15" /><path d="M20 19v-4h-4" /></>,
    search: <><circle cx="10.8" cy="10.8" r="6.7" /><path d="m16 16 4.5 4.5" /></>,
    settings: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-1.7 1.7-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-2.4v-.2a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L8 17l.1-.1A1.7 1.7 0 0 0 8.4 15a1.7 1.7 0 0 0-1.6-1H6.6v-2.4h.2a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L8 8.6l1.7-1.7.1.1a1.7 1.7 0 0 0 1.9.3 1.7 1.7 0 0 0 1-1.6v-.2h2.4v.2a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1 1.7 1.7-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2V14h-.2a1.7 1.7 0 0 0-1.6 1Z" /></>,
    star: <path d="m12 3.8 2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z" />,
    x: <><path d="m6 6 12 12M18 6 6 18" /></>,
  }

  return <svg {...common}>{paths[name]}</svg>
}
