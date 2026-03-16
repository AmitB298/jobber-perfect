const fs = require('fs');

const file = 'D:\\jobber-perfect\\frontend\\src\\pages\\Dashboard.tsx';
let content = fs.readFileSync(file, 'utf8');
const lines = content.split('\n');

// ── Find the oiscanner block boundaries ──────────────────────────────────────
let startLine = -1, endLine = -1;
for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes("activeTab === 'oiscanner'") && startLine === -1) {
    startLine = i;
  }
  if (startLine !== -1 && lines[i].includes("OI Pulse tab") && endLine === -1) {
    endLine = i;
    break;
  }
}

if (startLine === -1) { console.error('❌ Cannot find oiscanner block'); process.exit(1); }
if (endLine   === -1) { console.error('❌ Cannot find OI Pulse marker'); process.exit(1); }

console.log('Found oiscanner block: lines ' + (startLine+1) + ' to ' + endLine);
console.log('--- CURRENT BLOCK ---');
lines.slice(startLine, endLine).forEach((l,i) => console.log((startLine+i+1) + ': ' + l));
console.log('--- END ---');

// ── Replace block with wrapper call ─────────────────────────────────────────
const indent = '        ';
const newLines = [
  indent + `{/* ── v8.0: OI Scanner + Strike Analyser (sub-tab switcher) ── */}`,
  indent + `{activeTab === 'oiscanner' && (`,
  indent + `  <OIScannerWrapper chain={chain} summary={oiScannerSummary} />`,
  indent + `)}`,
  '',
  indent + `{/* ── v1.0: OI Pulse tab ── */}`,
];

lines.splice(startLine, endLine - startLine, ...newLines);
content = lines.join('\n');
console.log('\n✅ oiscanner block replaced');

// ── Inject OIScannerWrapper before export default ───────────────────────────
const exportIdx = content.lastIndexOf('\nexport default');
if (exportIdx === -1) { console.error('❌ Cannot find export default'); process.exit(1); }

const wrapper = `
// ─── OIScannerWrapper: sub-tab switcher ──────────────────────────────────────
function OIScannerWrapper({ chain, summary }: { chain: any; summary: any }) {
  const [subTab, setSubTab] = React.useState<'oi' | 'gex'>('oi');
  const base: React.CSSProperties = {
    flex: 1, padding: '11px 0', border: 'none', cursor: 'pointer',
    fontSize: 12, fontWeight: 700, letterSpacing: 1.5, transition: 'all 0.15s',
  };
  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: '#0a0a0a' }}>
      {/* Sub-tab switcher bar */}
      <div style={{ display: 'flex', borderBottom: '1px solid rgba(255,255,255,0.08)', background: '#0d0d0d', flexShrink: 0 }}>
        <button onClick={() => setSubTab('oi')} style={{
          ...base,
          background: subTab === 'oi' ? 'rgba(249,115,22,0.10)' : 'transparent',
          borderBottom: subTab === 'oi' ? '2px solid #f97316' : '2px solid transparent',
          color: subTab === 'oi' ? '#f97316' : 'rgba(255,255,255,0.3)',
        }}>🔭&nbsp;&nbsp;OI CONCENTRATION SCANNER</button>
        <div style={{ width: 1, background: 'rgba(255,255,255,0.07)', flexShrink: 0 }} />
        <button onClick={() => setSubTab('gex')} style={{
          ...base,
          background: subTab === 'gex' ? 'rgba(167,139,250,0.10)' : 'transparent',
          borderBottom: subTab === 'gex' ? '2px solid #a78bfa' : '2px solid transparent',
          color: subTab === 'gex' ? '#a78bfa' : 'rgba(255,255,255,0.3)',
        }}>📌&nbsp;&nbsp;GEX REGIME · STRIKE ANALYSER</button>
      </div>
      {/* Content area */}
      <div style={{ flex: 1, overflow: 'hidden' }}>
        {subTab === 'oi' && (
          <div style={{ height: '100%', overflowY: 'auto' }}>
            <OIScannerTab />
          </div>
        )}
        {subTab === 'gex' && (
          <div style={{ height: '100%', overflowY: 'auto' }}>
            <StrikeAnalyserTab chain={chain} summary={summary} />
          </div>
        )}
      </div>
    </div>
  );
}

`;

content = content.slice(0, exportIdx + 1) + wrapper + content.slice(exportIdx + 1);
console.log('✅ OIScannerWrapper injected');

// ── Ensure React is imported ─────────────────────────────────────────────────
if (!content.match(/import React[,\s{]/)) {
  const first = content.indexOf('import ');
  content = content.slice(0, first) + "import React from 'react';\n" + content.slice(first);
  console.log('✅ React import added');
} else {
  console.log('✅ React already imported');
}

fs.writeFileSync(file, content, 'utf8');
console.log('✅ Dashboard.tsx saved — ' + content.split('\n').length + ' lines');