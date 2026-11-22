// Small hand-drawn icon set (24px grid, 1.6 stroke) so the UI does not depend on emoji.
const PATHS = {
  menu: 'M4 7h16M4 12h16M4 17h10',
  plus: 'M12 5v14M5 12h14',
  chat: 'M5 6.5A2.5 2.5 0 0 1 7.5 4h9A2.5 2.5 0 0 1 19 6.5v6a2.5 2.5 0 0 1-2.5 2.5H11l-4 4v-4h0A2 2 0 0 1 5 13z',
  memory: 'M9 4.5a3 3 0 0 0-3 3v.2A3 3 0 0 0 4.5 13a3 3 0 0 0 2 2.8V16a3 3 0 0 0 5.5 1.7M15 4.5a3 3 0 0 1 3 3v.2a3 3 0 0 1 1.5 5.3 3 3 0 0 1-2 2.8V16a3 3 0 0 1-5.5 1.7M12 6v12',
  activity: 'M3 12h4l2.5-6 5 12 2.5-6h4',
  cpu: 'M8 8h8v8H8zM10 3v3M14 3v3M10 18v3M14 18v3M3 10h3M3 14h3M18 10h3M18 14h3',
  sun: 'M12 4v1.5M12 18.5V20M4 12h1.5M18.5 12H20M6.3 6.3l1 1M16.7 16.7l1 1M6.3 17.7l1-1M16.7 7.3l1-1M12 8.5a3.5 3.5 0 1 1 0 7 3.5 3.5 0 0 1 0-7z',
  moon: 'M19 14.5A7.5 7.5 0 0 1 9.5 5a7.5 7.5 0 1 0 9.5 9.5z',
  logout: 'M14 5h3.5A1.5 1.5 0 0 1 19 6.5v11a1.5 1.5 0 0 1-1.5 1.5H14M10 8l-4 4 4 4M6 12h9',
  arrowUp: 'M12 19V6M6.5 11.5 12 6l5.5 5.5',
  mic: 'M12 4a2.5 2.5 0 0 1 2.5 2.5v5a2.5 2.5 0 0 1-5 0v-5A2.5 2.5 0 0 1 12 4zM7 11.5a5 5 0 0 0 10 0M12 16.5V20',
  stop: 'M8.5 8.5h7v7h-7z',
  x: 'M6 6l12 12M18 6 6 18',
  pin: 'M12 20s-6-5.5-6-10a6 6 0 0 1 12 0c0 4.5-6 10-6 10zM12 8a2 2 0 1 1 0 4 2 2 0 0 1 0-4z',
  external: 'M14 5h5v5M19 5l-8 8M17 14v4a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1h4',
  bell: 'M6.5 16.5h11l-1.5-2v-4a4 4 0 0 0-8 0v4zM10.5 19a1.5 1.5 0 0 0 3 0',
  trash: 'M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12',
  edit: 'M5 19h3.5L18 9.5 14.5 6 5 15.5zM13 7.5l3.5 3.5',
  search: 'M11 5a6 6 0 1 1 0 12 6 6 0 0 1 0-12zM15.5 15.5 19 19',
  check: 'M5.5 12.5 10 17l8.5-9.5',
  speaker: 'M5 10h3l4-3.5v11L8 14H5zM15.5 9.5a3.5 3.5 0 0 1 0 5M17.8 7.2a7 7 0 0 1 0 9.6',
  expand: 'M14 5h5v5M10 19H5v-5M19 5l-5.5 5.5M5 19l5.5-5.5',
  back: 'M19 12H6M11 6.5 5.5 12l5.5 5.5',
  core: 'M12 9.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5zM12 4a8 8 0 0 1 8 8M12 20a8 8 0 0 1-8-8M17.2 17.6A8 8 0 0 1 12 20M6.8 6.4A8 8 0 0 1 12 4',
  history: 'M12 8v4.5l3 2M4.6 13a7.5 7.5 0 1 0 1.9-6.3M4.5 4v3.5H8',
  warn: 'M12 4.5 20.5 19h-17zM12 10v4M12 16.8v.2',
}

export default function Icon({ name, size = 20, className = '' }) {
  return (
    <svg className={`icon ${className}`} width={size} height={size} viewBox="0 0 24 24" fill="none"
         stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={PATHS[name]} />
    </svg>
  )
}
