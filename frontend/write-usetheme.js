const fs = require('fs'), path = require('path');
const lines = [], p = s => lines.push(s);

p(`// src/hooks/useTheme.ts`);
p(`export interface ThemeDef {`);
p(`  id: string; label: string; desc: string; icon: string;`);
p(`  preview: string[]; vars: Record<string, string>;`);
p(`}`);
p(``);
p(`export const THEMES: ThemeDef[] = [`);

// ── Midnight Dark ──
p(`  {`);
p(`    id: 'dark', label: 'Midnight Dark', desc: 'Pure black — easy on eyes during night sessions', icon: '🌑',`);
p(`    preview: ['#060606', '#0d0d0d', '#f97316'],`);
p(`    vars: {`);
p(`      '--bg-base': '#060606', '--bg-card': '#0a0a0a', '--bg-nav': '#040404',`);
p(`      '--bg-topbar': '#111111', '--border': '#1a1a1a', '--border-sub': '#111111',`);
p(`      '--text-pri': '#f3f4f6', '--text-sec': '#9ca3af', '--text-muted': '#4b5563',`);
p(`      '--accent': '#f97316', '--accent2': '#dc2626', '--tab-active': '#3b82f6',`);
p(`    },`);
p(`  },`);

// ── Crimson ──
p(`  {`);
p(`    id: 'crimson', label: 'Crimson', desc: 'Deep red terminal — high intensity trading mode', icon: '🔴',`);
p(`    preview: ['#0d0005', '#130008', '#f43f5e'],`);
p(`    vars: {`);
p(`      '--bg-base': '#0d0005', '--bg-card': '#130008', '--bg-nav': '#0a0003',`);
p(`      '--bg-topbar': '#170009', '--border': '#3f0015', '--border-sub': '#2a000e',`);
p(`      '--text-pri': '#ffe4e6', '--text-sec': '#fda4af', '--text-muted': '#881337',`);
p(`      '--accent': '#f43f5e', '--accent2': '#e11d48', '--tab-active': '#f43f5e',`);
p(`    },`);
p(`  },`);

// ── Matrix Green ──
p(`  {`);
p(`    id: 'matrix', label: 'Matrix Green', desc: 'Terminal green — hardcore algo trader', icon: '💚',`);
p(`    preview: ['#001100', '#002200', '#00ff41'],`);
p(`    vars: {`);
p(`      '--bg-base': '#000d00', '--bg-card': '#001200', '--bg-nav': '#000a00',`);
p(`      '--bg-topbar': '#001500', '--border': '#003300', '--border-sub': '#002200',`);
p(`      '--text-pri': '#00ff41', '--text-sec': '#00cc33', '--text-muted': '#006618',`);
p(`      '--accent': '#00ff41', '--accent2': '#00cc33', '--tab-active': '#00ff41',`);
p(`    },`);
p(`  },`);

// ── Ocean Blue ──
p(`  {`);
p(`    id: 'ocean', label: 'Ocean Blue', desc: 'Deep blue tones — calm focus for long sessions', icon: '🌊',`);
p(`    preview: ['#0a1628', '#0d2240', '#38bdf8'],`);
p(`    vars: {`);
p(`      '--bg-base': '#0a1628', '--bg-card': '#0d1f3c', '--bg-nav': '#081220',`);
p(`      '--bg-topbar': '#0d1f3c', '--border': '#1e3a5f', '--border-sub': '#152d4a',`);
p(`      '--text-pri': '#e0f2fe', '--text-sec': '#7dd3fc', '--text-muted': '#334e68',`);
p(`      '--accent': '#38bdf8', '--accent2': '#0ea5e9', '--tab-active': '#38bdf8',`);
p(`    },`);
p(`  },`);

// ── Nord ──
p(`  {`);
p(`    id: 'nord', label: 'Nord', desc: 'Cool arctic grey-blue — focused and calm', icon: '🧊',`);
p(`    preview: ['#191d2b', '#232938', '#88c0d0'],`);
p(`    vars: {`);
p(`      '--bg-base': '#191d2b', '--bg-card': '#232938', '--bg-nav': '#141820',`);
p(`      '--bg-topbar': '#1e2333', '--border': '#2e3548', '--border-sub': '#252b3b',`);
p(`      '--text-pri': '#d8dee9', '--text-sec': '#81a1c1', '--text-muted': '#4c566a',`);
p(`      '--accent': '#88c0d0', '--accent2': '#5e81ac', '--tab-active': '#88c0d0',`);
p(`    },`);
p(`  },`);

// ── Dusk ──
p(`  {`);
p(`    id: 'dusk', label: 'Dusk', desc: 'Purple twilight — transition from day to night', icon: '🌆',`);
p(`    preview: ['#1a0a2e', '#2d1b69', '#a78bfa'],`);
p(`    vars: {`);
p(`      '--bg-base': '#1a0a2e', '--bg-card': '#1e1040', '--bg-nav': '#150825',`);
p(`      '--bg-topbar': '#1e1040', '--border': '#3b2070', '--border-sub': '#2d1b69',`);
p(`      '--text-pri': '#f5f3ff', '--text-sec': '#c4b5fd', '--text-muted': '#6d28d9',`);
p(`      '--accent': '#a78bfa', '--accent2': '#7c3aed', '--tab-active': '#a78bfa',`);
p(`    },`);
p(`  },`);

p(`];`);
p(``);
p(`const STYLE_ID = 'jp-theme-override';`);
p(``);
p(`export function applyTheme(id: string) {`);
p(`  const theme = THEMES.find(t => t.id === id) ?? THEMES[0];`);
p(`  const root = document.documentElement;`);
p(`  Object.entries(theme.vars).forEach(([k, v]) => root.style.setProperty(k, v));`);
p(`  const bg   = theme.vars['--bg-base'];`);
p(`  const card = theme.vars['--bg-card'];`);
p(`  const topb = theme.vars['--bg-topbar'];`);
p(`  const bdr  = theme.vars['--border'];`);
p(`  const bdrs = theme.vars['--border-sub'];`);
p(`  const tpri = theme.vars['--text-pri'];`);
p(`  const tsec = theme.vars['--text-sec'];`);
p(`  const tmut = theme.vars['--text-muted'];`);
p(`  const css = [`);
p(`    'html, body, #root { background: ' + bg + ' !important; color: ' + tpri + ' !important; }',`);
p(`    '[style*="background: #050505"],[style*="background:#050505"],',`);
p(`    '[style*="background: #060606"],[style*="background:#060606"],',`);
p(`    '[style*="background: #0a0a0a"],[style*="background:#0a0a0a"],',`);
p(`    '[style*="background: #0d0d0d"],[style*="background:#0d0d0d"],',`);
p(`    '[style*="background: #111"],[style*="background:#111"],',`);
p(`    '[style*="background: #111111"],[style*="background:#111111"],',`);
p(`    '[style*="background: #161616"],[style*="background:#161616"],',`);
p(`    '[style*="background: #1a1a1a"],[style*="background:#1a1a1a"]',`);
p(`    '{ background: ' + card + ' !important; }',`);
p(`    '[style*="border: 1px solid #1a1a1a"],[style*="border:1px solid #1a1a1a"],',`);
p(`    '[style*="border: 1px solid #222"],[style*="border:1px solid #222"],',`);
p(`    '[style*="border: 1px solid #111"]',`);
p(`    '{ border-color: ' + bdr + ' !important; }',`);
p(`    '[style*="color: #f1f5f9"],[style*="color:#f1f5f9"],',`);
p(`    '[style*="color: #f3f4f6"],[style*="color:#f3f4f6"]',`);
p(`    '{ color: ' + tpri + ' !important; }',`);
p(`    '[style*="color: #9ca3af"],[style*="color:#9ca3af"],',`);
p(`    '[style*="color: #6b7280"],[style*="color:#6b7280"]',`);
p(`    '{ color: ' + tsec + ' !important; }',`);
p(`    '[style*="color: #4b5563"],[style*="color:#4b5563"]',`);
p(`    '{ color: ' + tmut + ' !important; }',`);
p(`    '.bg-gray-950 { background-color: ' + bg   + ' !important; }',`);
p(`    '.bg-gray-900 { background-color: ' + topb + ' !important; }',`);
p(`    '.bg-gray-800 { background-color: ' + card + ' !important; }',`);
p(`    '.border-gray-800 { border-color: ' + bdr  + ' !important; }',`);
p(`    '.border-gray-700 { border-color: ' + bdrs + ' !important; }',`);
p(`    '.text-gray-100 { color: ' + tpri + ' !important; }',`);
p(`    '.text-gray-300 { color: ' + tsec + ' !important; }',`);
p(`    '.text-gray-500 { color: ' + tmut + ' !important; }',`);
p(`  ].join(' ');`);
p(`  let el = document.getElementById(STYLE_ID);`);
p(`  if (!el) { el = document.createElement('style'); el.id = STYLE_ID; document.head.appendChild(el); }`);
p(`  el.textContent = css;`);
p(`  localStorage.setItem('jp_theme', id);`);
p(`}`);
p(``);
p(`export function initTheme() {`);
p(`  const saved = localStorage.getItem('jp_theme') ?? 'dark';`);
p(`  applyTheme(saved);`);
p(`  return saved;`);
p(`}`);

const content = lines.join('\n');
const dest = path.join(__dirname, 'src', 'hooks', 'useTheme.ts');
fs.writeFileSync(dest, content, 'utf8');
console.log('useTheme.ts written — ' + lines.length + ' lines -> ' + dest);