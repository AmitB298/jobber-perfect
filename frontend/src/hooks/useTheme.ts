// src/hooks/useTheme.ts
export interface ThemeDef {
  id: string; label: string; desc: string; icon: string;
  preview: string[]; vars: Record<string, string>;
}

export const THEMES: ThemeDef[] = [
  {
    id: 'dark', label: 'Midnight Dark', desc: 'Pure black — easy on eyes during night sessions', icon: '🌑',
    preview: ['#060606', '#0d0d0d', '#f97316'],
    vars: {
      '--bg-base': '#060606', '--bg-card': '#0a0a0a', '--bg-nav': '#040404',
      '--bg-topbar': '#111111', '--border': '#1a1a1a', '--border-sub': '#111111',
      '--text-pri': '#f3f4f6', '--text-sec': '#9ca3af', '--text-muted': '#4b5563',
      '--accent': '#f97316', '--accent2': '#dc2626', '--tab-active': '#3b82f6',
    },
  },
  {
    id: 'crimson', label: 'Crimson', desc: 'Deep red terminal — high intensity trading mode', icon: '🔴',
    preview: ['#0d0005', '#130008', '#f43f5e'],
    vars: {
      '--bg-base': '#0d0005', '--bg-card': '#130008', '--bg-nav': '#0a0003',
      '--bg-topbar': '#170009', '--border': '#3f0015', '--border-sub': '#2a000e',
      '--text-pri': '#ffe4e6', '--text-sec': '#fda4af', '--text-muted': '#881337',
      '--accent': '#f43f5e', '--accent2': '#e11d48', '--tab-active': '#f43f5e',
    },
  },
  {
    id: 'matrix', label: 'Matrix Green', desc: 'Terminal green — hardcore algo trader', icon: '💚',
    preview: ['#001100', '#002200', '#00ff41'],
    vars: {
      '--bg-base': '#000d00', '--bg-card': '#001200', '--bg-nav': '#000a00',
      '--bg-topbar': '#001500', '--border': '#003300', '--border-sub': '#002200',
      '--text-pri': '#00ff41', '--text-sec': '#00cc33', '--text-muted': '#006618',
      '--accent': '#00ff41', '--accent2': '#00cc33', '--tab-active': '#00ff41',
    },
  },
  {
    id: 'ocean', label: 'Ocean Blue', desc: 'Deep blue tones — calm focus for long sessions', icon: '🌊',
    preview: ['#0a1628', '#0d2240', '#38bdf8'],
    vars: {
      '--bg-base': '#0a1628', '--bg-card': '#0d1f3c', '--bg-nav': '#081220',
      '--bg-topbar': '#0d1f3c', '--border': '#1e3a5f', '--border-sub': '#152d4a',
      '--text-pri': '#e0f2fe', '--text-sec': '#7dd3fc', '--text-muted': '#334e68',
      '--accent': '#38bdf8', '--accent2': '#0ea5e9', '--tab-active': '#38bdf8',
    },
  },
  {
    id: 'nord', label: 'Nord', desc: 'Cool arctic grey-blue — focused and calm', icon: '🧊',
    preview: ['#191d2b', '#232938', '#88c0d0'],
    vars: {
      '--bg-base': '#191d2b', '--bg-card': '#232938', '--bg-nav': '#141820',
      '--bg-topbar': '#1e2333', '--border': '#2e3548', '--border-sub': '#252b3b',
      '--text-pri': '#d8dee9', '--text-sec': '#81a1c1', '--text-muted': '#4c566a',
      '--accent': '#88c0d0', '--accent2': '#5e81ac', '--tab-active': '#88c0d0',
    },
  },
  {
    id: 'dusk', label: 'Dusk', desc: 'Purple twilight — transition from day to night', icon: '🌆',
    preview: ['#1a0a2e', '#2d1b69', '#a78bfa'],
    vars: {
      '--bg-base': '#1a0a2e', '--bg-card': '#1e1040', '--bg-nav': '#150825',
      '--bg-topbar': '#1e1040', '--border': '#3b2070', '--border-sub': '#2d1b69',
      '--text-pri': '#f5f3ff', '--text-sec': '#c4b5fd', '--text-muted': '#6d28d9',
      '--accent': '#a78bfa', '--accent2': '#7c3aed', '--tab-active': '#a78bfa',
    },
  },
];

const STYLE_ID = 'jp-theme-override';

export function applyTheme(id: string) {
  const theme = THEMES.find(t => t.id === id) ?? THEMES[0];
  const root = document.documentElement;
  Object.entries(theme.vars).forEach(([k, v]) => root.style.setProperty(k, v));
  const bg   = theme.vars['--bg-base'];
  const card = theme.vars['--bg-card'];
  const topb = theme.vars['--bg-topbar'];
  const bdr  = theme.vars['--border'];
  const bdrs = theme.vars['--border-sub'];
  const tpri = theme.vars['--text-pri'];
  const tsec = theme.vars['--text-sec'];
  const tmut = theme.vars['--text-muted'];
  const css = [
    'html, body, #root { background: ' + bg + ' !important; color: ' + tpri + ' !important; }',
    '[style*="background: #050505"],[style*="background:#050505"],',
    '[style*="background: #060606"],[style*="background:#060606"],',
    '[style*="background: #0a0a0a"],[style*="background:#0a0a0a"],',
    '[style*="background: #0d0d0d"],[style*="background:#0d0d0d"],',
    '[style*="background: #111"],[style*="background:#111"],',
    '[style*="background: #111111"],[style*="background:#111111"],',
    '[style*="background: #161616"],[style*="background:#161616"],',
    '[style*="background: #1a1a1a"],[style*="background:#1a1a1a"]',
    '{ background: ' + card + ' !important; }',
    '[style*="border: 1px solid #1a1a1a"],[style*="border:1px solid #1a1a1a"],',
    '[style*="border: 1px solid #222"],[style*="border:1px solid #222"],',
    '[style*="border: 1px solid #111"]',
    '{ border-color: ' + bdr + ' !important; }',
    '[style*="color: #f1f5f9"],[style*="color:#f1f5f9"],',
    '[style*="color: #f3f4f6"],[style*="color:#f3f4f6"]',
    '{ color: ' + tpri + ' !important; }',
    '[style*="color: #9ca3af"],[style*="color:#9ca3af"],',
    '[style*="color: #6b7280"],[style*="color:#6b7280"]',
    '{ color: ' + tsec + ' !important; }',
    '[style*="color: #4b5563"],[style*="color:#4b5563"]',
    '{ color: ' + tmut + ' !important; }',
    '.bg-gray-950 { background-color: ' + bg   + ' !important; }',
    '.bg-gray-900 { background-color: ' + topb + ' !important; }',
    '.bg-gray-800 { background-color: ' + card + ' !important; }',
    '.border-gray-800 { border-color: ' + bdr  + ' !important; }',
    '.border-gray-700 { border-color: ' + bdrs + ' !important; }',
    '.text-gray-100 { color: ' + tpri + ' !important; }',
    '.text-gray-300 { color: ' + tsec + ' !important; }',
    '.text-gray-500 { color: ' + tmut + ' !important; }',
  ].join(' ');
  let el = document.getElementById(STYLE_ID);
  if (!el) { el = document.createElement('style'); el.id = STYLE_ID; document.head.appendChild(el); }
  el.textContent = css;
  localStorage.setItem('jp_theme', id);
}

export function initTheme() {
  const saved = localStorage.getItem('jp_theme') ?? 'dark';
  applyTheme(saved);
  return saved;
}