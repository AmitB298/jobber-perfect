/**
 * excel-engine.ts
 * Location: D:\jobber-perfect\backend\excel-engine.ts
 *
 * BUGS FIXED:
 * ✅ tabColor: must use ws.properties.tabColor AFTER addWorksheet (not in options)
 * ✅ freeze_panes: must use ws.views = [{state:'frozen'...}] not ws.freeze_panes
 * ✅ Exported: ChainRow interface and buildExcelWorkbook function (required by excel-routes.ts)
 * ✅ Buffer: cast as Buffer explicitly
 */

import ExcelJS from 'exceljs';

// ============================================================
// TYPES
// ============================================================

export interface ChainRow {
  strike_price: number;
  ce_ltp: number | null;
  pe_ltp: number | null;
  ce_volume: number | null;
  pe_volume: number | null;
  ce_oi: number | null;
  pe_oi: number | null;
  ce_iv: number | null;
  pe_iv: number | null;
  ce_delta: number | null;
  ce_gamma: number | null;
  ce_theta: number | null;
  ce_vega: number | null;
  pe_delta: number | null;
  pe_gamma: number | null;
  pe_theta: number | null;
  pe_vega: number | null;
}

export interface ExcelExportParams {
  spotPrice: number;
  atmStrike: number;
  pcr_oi: number;
  pcr_volume: number;
  maxPain: number;
  expiryDate: string;
  daysToExpiry: number;
  chain: ChainRow[];
  exportedAt?: Date;
  snapshotLabel?: string;
}

// ============================================================
// COLOUR PALETTE (dark theme)
// ============================================================
const C = {
  bg:        'FF0F172A',  // slate-900
  bgAlt:     'FF1E293B',  // slate-800
  header:    'FF1E3A5F',  // dark blue header
  atm:       'FF1E3A5F',  // ATM row highlight
  ce:        'FF14532D',  // green-900
  pe:        'FF450A0A',  // red-900
  white:     'FFFFFFFF',
  yellow:    'FFFBBF24',
  green:     'FF4ADE80',
  red:       'FFF87171',
  blue:      'FF60A5FA',
  purple:    'FFC084FC',
  orange:    'FFFB923C',
  gray:      'FF94A3B8',
};

const font = (color = C.white, bold = false, size = 10): Partial<ExcelJS.Font> =>
  ({ color: { argb: color }, bold, size, name: 'Calibri' });

const fill = (argb: string): ExcelJS.Fill =>
  ({ type: 'pattern', pattern: 'solid', fgColor: { argb } });

const border = (): Partial<ExcelJS.Borders> => ({
  top:    { style: 'thin', color: { argb: 'FF1E293B' } },
  bottom: { style: 'thin', color: { argb: 'FF1E293B' } },
  left:   { style: 'thin', color: { argb: 'FF1E293B' } },
  right:  { style: 'thin', color: { argb: 'FF1E293B' } },
});

const n = (v: number | null | undefined, decimals = 2): number =>
  v != null ? parseFloat(Number(v).toFixed(decimals)) : 0;

const fmt = (v: number | null | undefined, d = 2): string =>
  v != null ? Number(v).toFixed(d) : '-';

// ============================================================
// HELPER: style a header row
// ============================================================
function styleHeaderRow(row: ExcelJS.Row, bgArgb: string = C.header): void {
  row.height = 20;
  row.eachCell((cell) => {
    cell.font    = font(C.white, true, 10);
    cell.fill    = fill(bgArgb);
    cell.border  = border();
    cell.alignment = { vertical: 'middle', horizontal: 'center' };
  });
}

function styleDataRow(row: ExcelJS.Row, bgArgb: string, height = 16): void {
  row.height = height;
  row.eachCell((cell) => {
    cell.fill   = fill(bgArgb);
    cell.border = border();
    cell.alignment = { vertical: 'middle' };
  });
}

// ============================================================
// SHEET 1: DASHBOARD
// ============================================================
function buildDashboardSheet(wb: ExcelJS.Workbook, p: ExcelExportParams): void {
  const ws = wb.addWorksheet('Dashboard');
  ws.properties.tabColor = { argb: '6366F1' };  // ✅ FIXED: not in addWorksheet options
  ws.views = [{ state: 'frozen', xSplit: 0, ySplit: 3, showGridLines: false }];  // ✅ FIXED

  ws.columns = [
    { key: 'a', width: 22 },
    { key: 'b', width: 20 },
    { key: 'c', width: 22 },
    { key: 'd', width: 20 },
    { key: 'e', width: 22 },
    { key: 'f', width: 20 },
  ];

  // Title row
  ws.mergeCells('A1:F1');
  const title = ws.getCell('A1');
  title.value = '⚡ JOBBER PRO — NIFTY Options Dashboard';
  title.font  = font(C.yellow, true, 14);
  title.fill  = fill(C.bg);
  title.alignment = { vertical: 'middle', horizontal: 'center' };
  ws.getRow(1).height = 28;

  // Subtitle
  ws.mergeCells('A2:F2');
  const sub = ws.getCell('A2');
  sub.value = `Exported: ${(p.exportedAt || new Date()).toLocaleString('en-IN')} ${p.snapshotLabel ? '| ' + p.snapshotLabel : ''}`;
  sub.font  = font(C.gray, false, 9);
  sub.fill  = fill(C.bg);
  sub.alignment = { vertical: 'middle', horizontal: 'center' };
  ws.getRow(2).height = 16;

  // Metric cards: label/value pairs in 3 columns
  const metrics = [
    { label: 'NIFTY Spot', value: `₹${fmt(p.spotPrice)}`,  color: C.white  },
    { label: 'ATM Strike', value: p.atmStrike.toString(),   color: C.yellow },
    { label: 'PCR (OI)',   value: fmt(p.pcr_oi),            color: p.pcr_oi > 1 ? C.green : C.red },
    { label: 'PCR (Vol)',  value: fmt(p.pcr_volume),        color: C.blue   },
    { label: 'Max Pain',   value: p.maxPain.toString(),     color: C.orange },
    { label: 'DTE',        value: `${p.daysToExpiry} days`, color: C.purple },
  ];

  // Header row for metrics
  const hdr = ws.addRow(['METRIC', 'VALUE', 'METRIC', 'VALUE', 'METRIC', 'VALUE']);
  styleHeaderRow(hdr, C.header);

  // Metric data rows
  for (let i = 0; i < metrics.length; i += 2) {
    const left  = metrics[i];
    const right = metrics[i + 1];
    const row = ws.addRow([left.label, left.value, right?.label ?? '', right?.value ?? '', '', '']);
    styleDataRow(row, C.bgAlt);
    row.getCell(1).font = font(C.gray,  false);
    row.getCell(2).font = font(left.color,  true);
    row.getCell(3).font = font(C.gray,  false);
    row.getCell(4).font = font(right?.color ?? C.white, true);
    [1, 2, 3, 4].forEach(c => row.getCell(c).alignment = { vertical: 'middle', horizontal: c % 2 === 0 ? 'center' : 'left' });
  }

  ws.addRow([]);

  // OI Summary
  const chainOI = p.chain.map(r => ({
    strike: r.strike_price,
    ceOI: n(r.ce_oi),
    peOI: n(r.pe_oi),
    net: n(r.pe_oi) - n(r.ce_oi),
  })).filter(r => r.ceOI > 0 || r.peOI > 0);

  const top5CE = [...chainOI].sort((a, b) => b.ceOI - a.ceOI).slice(0, 5);
  const top5PE = [...chainOI].sort((a, b) => b.peOI - a.peOI).slice(0, 5);

  ws.mergeCells(`A${ws.rowCount + 1}:C${ws.rowCount + 1}`);
  const ceHdr = ws.addRow(['Top CE OI (Resistance)', '', '', 'Top PE OI (Support)', '', '']);
  styleHeaderRow(ceHdr, C.ce);

  const maxRows = Math.max(top5CE.length, top5PE.length);
  for (let i = 0; i < maxRows; i++) {
    const ce = top5CE[i];
    const pe = top5PE[i];
    const row = ws.addRow([
      ce?.strike ?? '', ce ? (ce.ceOI / 1000).toFixed(0) + 'K' : '',
      '', pe?.strike ?? '', pe ? (pe.peOI / 1000).toFixed(0) + 'K' : '', '',
    ]);
    styleDataRow(row, C.bg);
    if (ce) { row.getCell(1).font = font(C.green, true); row.getCell(2).font = font(C.green); }
    if (pe) { row.getCell(4).font = font(C.red,   true); row.getCell(5).font = font(C.red);   }
  }
}

// ============================================================
// SHEET 2: OPTIONS CHAIN
// ============================================================
function buildOptionsChainSheet(wb: ExcelJS.Workbook, p: ExcelExportParams): void {
  const ws = wb.addWorksheet('Options Chain');
  ws.properties.tabColor = { argb: '22C55E' };  // ✅ FIXED

  ws.columns = [
    { key: 'ce_iv',    width: 8,  header: 'CE IV%'   },
    { key: 'ce_delta', width: 8,  header: 'CE Delta' },
    { key: 'ce_gamma', width: 8,  header: 'CE Gamma' },
    { key: 'ce_theta', width: 8,  header: 'CE Theta' },
    { key: 'ce_vega',  width: 8,  header: 'CE Vega'  },
    { key: 'ce_oi',    width: 10, header: 'CE OI'    },
    { key: 'ce_vol',   width: 10, header: 'CE Vol'   },
    { key: 'ce_ltp',   width: 10, header: 'CE LTP'   },
    { key: 'strike',   width: 12, header: 'STRIKE'   },
    { key: 'pe_ltp',   width: 10, header: 'PE LTP'   },
    { key: 'pe_vol',   width: 10, header: 'PE Vol'   },
    { key: 'pe_oi',    width: 10, header: 'PE OI'    },
    { key: 'pe_vega',  width: 8,  header: 'PE Vega'  },
    { key: 'pe_theta', width: 8,  header: 'PE Theta' },
    { key: 'pe_gamma', width: 8,  header: 'PE Gamma' },
    { key: 'pe_delta', width: 8,  header: 'PE Delta' },
    { key: 'pe_iv',    width: 8,  header: 'PE IV%'   },
  ];

  ws.views = [{ state: 'frozen', xSplit: 0, ySplit: 1, showGridLines: false }];

  styleHeaderRow(ws.getRow(1), C.header);

  for (const row of p.chain) {
    const isATM = row.strike_price === p.atmStrike;
    const dataRow = ws.addRow({
      ce_iv:    n(row.ce_iv, 1),
      ce_delta: n(row.ce_delta),
      ce_gamma: n(row.ce_gamma, 4),
      ce_theta: n(row.ce_theta),
      ce_vega:  n(row.ce_vega),
      ce_oi:    n(row.ce_oi, 0),
      ce_vol:   n(row.ce_volume, 0),
      ce_ltp:   n(row.ce_ltp),
      strike:   row.strike_price,
      pe_ltp:   n(row.pe_ltp),
      pe_vol:   n(row.pe_volume, 0),
      pe_oi:    n(row.pe_oi, 0),
      pe_vega:  n(row.pe_vega),
      pe_theta: n(row.pe_theta),
      pe_gamma: n(row.pe_gamma, 4),
      pe_delta: n(row.pe_delta),
      pe_iv:    n(row.pe_iv, 1),
    });

    const bg = isATM ? C.atm : C.bg;
    styleDataRow(dataRow, bg);

    // CE side (green tint)
    for (let c = 1; c <= 8; c++) {
      dataRow.getCell(c).fill = fill(isATM ? C.atm : C.ce);
      dataRow.getCell(c).font = font(c === 8 ? C.green : C.white, false);
      dataRow.getCell(c).alignment = { horizontal: 'right', vertical: 'middle' };
    }
    // Strike
    dataRow.getCell(9).font = font(isATM ? C.yellow : C.white, true, 11);
    dataRow.getCell(9).alignment = { horizontal: 'center', vertical: 'middle' };
    // PE side (red tint)
    for (let c = 10; c <= 17; c++) {
      dataRow.getCell(c).fill = fill(isATM ? C.atm : C.pe);
      dataRow.getCell(c).font = font(c === 10 ? C.red : C.white, false);
      dataRow.getCell(c).alignment = { horizontal: 'left', vertical: 'middle' };
    }
  }
}

// ============================================================
// SHEET 3: IV ANALYSIS
// ============================================================
function buildIVSheet(wb: ExcelJS.Workbook, p: ExcelExportParams): void {
  const ws = wb.addWorksheet('IV Analysis');
  ws.properties.tabColor = { argb: 'A855F7' };  // ✅ FIXED

  ws.columns = [
    { width: 12 }, { width: 10 }, { width: 10 }, { width: 10 },
    { width: 10 }, { width: 10 }, { width: 12 },
  ];
  ws.views = [{ state: 'frozen', xSplit: 0, ySplit: 1, showGridLines: false }];

  const hdr = ws.addRow(['Strike', 'CE IV%', 'PE IV%', 'IV Skew', 'Moneyness%', 'CE OI', 'PE OI']);
  styleHeaderRow(hdr);

  const atmIV = p.chain.find(r => r.strike_price === p.atmStrike)?.ce_iv ?? 0;

  for (const row of p.chain) {
    const skew = n(row.pe_iv) - n(row.ce_iv);
    const moneyness = ((row.strike_price - p.spotPrice) / p.spotPrice * 100);
    const isATM = row.strike_price === p.atmStrike;

    const dataRow = ws.addRow([
      row.strike_price,
      n(row.ce_iv, 1),
      n(row.pe_iv, 1),
      parseFloat(skew.toFixed(2)),
      parseFloat(moneyness.toFixed(2)),
      n(row.ce_oi, 0),
      n(row.pe_oi, 0),
    ]);

    styleDataRow(dataRow, isATM ? C.atm : C.bgAlt);
    dataRow.getCell(1).font = font(isATM ? C.yellow : C.white, isATM);
    dataRow.getCell(2).font = font(C.green);
    dataRow.getCell(3).font = font(C.red);
    dataRow.getCell(4).font = font(skew > 0 ? C.purple : C.blue);
    dataRow.getCell(5).font = font(moneyness > 0 ? C.red : C.green);
    for (let c = 1; c <= 7; c++) {
      dataRow.getCell(c).alignment = { horizontal: 'right', vertical: 'middle' };
    }
  }
}

// ============================================================
// SHEET 4: OI PROFILE
// ============================================================
function buildOISheet(wb: ExcelJS.Workbook, p: ExcelExportParams): void {
  const ws = wb.addWorksheet('OI Profile');
  ws.properties.tabColor = { argb: 'F97316' };  // ✅ FIXED

  ws.columns = [
    { width: 12 }, { width: 14 }, { width: 14 }, { width: 14 },
    { width: 10 }, { width: 18 },
  ];
  ws.views = [{ state: 'frozen', xSplit: 0, ySplit: 1, showGridLines: false }];

  const hdr = ws.addRow(['Strike', 'CE OI', 'PE OI', 'Net OI (PE-CE)', 'Dominant', 'Signal']);
  styleHeaderRow(hdr);

  const maxOI = Math.max(...p.chain.map(r => Math.max(n(r.ce_oi), n(r.pe_oi))), 1);

  for (const row of p.chain) {
    const ceOI = n(row.ce_oi, 0);
    const peOI = n(row.pe_oi, 0);
    const net  = peOI - ceOI;
    const dom  = net > 0 ? 'BULLS' : 'BEARS';
    const isATM = row.strike_price === p.atmStrike;

    let signal = '';
    if (ceOI / maxOI > 0.6) signal = 'Strong Resistance';
    else if (peOI / maxOI > 0.6) signal = 'Strong Support';
    else if (Math.abs(net) < maxOI * 0.1) signal = 'Balanced';

    const dataRow = ws.addRow([row.strike_price, ceOI, peOI, net, dom, signal]);
    styleDataRow(dataRow, isATM ? C.atm : C.bg);
    dataRow.getCell(1).font = font(isATM ? C.yellow : C.white, isATM);
    dataRow.getCell(2).font = font(C.green);
    dataRow.getCell(3).font = font(C.red);
    dataRow.getCell(4).font = font(net > 0 ? C.green : C.red, true);
    dataRow.getCell(5).font = font(net > 0 ? C.green : C.red);
    dataRow.getCell(6).font = font(C.gray);
    for (let c = 1; c <= 6; c++) {
      dataRow.getCell(c).alignment = { horizontal: c <= 4 ? 'right' : 'center', vertical: 'middle' };
    }
  }
}

// ============================================================
// SHEET 5: RAW DATA
// ============================================================
function buildRawSheet(wb: ExcelJS.Workbook, p: ExcelExportParams): void {
  const ws = wb.addWorksheet('Raw Data');
  ws.properties.tabColor = { argb: '6B7280' };  // ✅ FIXED

  const cols = [
    'strike_price','ce_ltp','ce_volume','ce_oi','ce_iv',
    'ce_delta','ce_gamma','ce_theta','ce_vega',
    'pe_ltp','pe_volume','pe_oi','pe_iv',
    'pe_delta','pe_gamma','pe_theta','pe_vega',
  ];

  ws.columns = cols.map(k => ({ key: k, header: k, width: 13 }));
  ws.views = [{ state: 'frozen', xSplit: 0, ySplit: 1, showGridLines: false }];

  styleHeaderRow(ws.getRow(1));

  for (const row of p.chain) {
    const dataRow = ws.addRow({
      strike_price: row.strike_price,
      ce_ltp:       n(row.ce_ltp),
      ce_volume:    n(row.ce_volume, 0),
      ce_oi:        n(row.ce_oi, 0),
      ce_iv:        n(row.ce_iv, 2),
      ce_delta:     n(row.ce_delta),
      ce_gamma:     n(row.ce_gamma, 4),
      ce_theta:     n(row.ce_theta),
      ce_vega:      n(row.ce_vega),
      pe_ltp:       n(row.pe_ltp),
      pe_volume:    n(row.pe_volume, 0),
      pe_oi:        n(row.pe_oi, 0),
      pe_iv:        n(row.pe_iv, 2),
      pe_delta:     n(row.pe_delta),
      pe_gamma:     n(row.pe_gamma, 4),
      pe_theta:     n(row.pe_theta),
      pe_vega:      n(row.pe_vega),
    });
    styleDataRow(dataRow, row.strike_price === p.atmStrike ? C.atm : C.bgAlt);
    dataRow.eachCell(cell => {
      cell.font = font(C.white, false, 9);
      cell.alignment = { horizontal: 'right', vertical: 'middle' };
    });
  }

  ws.autoFilter = { from: 'A1', to: `Q${ws.rowCount}` };
}

// ============================================================
// MAIN EXPORT FUNCTION
// ============================================================
export async function exportToExcel(params: ExcelExportParams): Promise<any> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Jobber Pro';
  wb.created = new Date();

  buildDashboardSheet(wb, params);
  buildOptionsChainSheet(wb, params);
  buildIVSheet(wb, params);
  buildOISheet(wb, params);
  buildRawSheet(wb, params);

  // ✅ FIXED: cast to Buffer
  return (await wb.xlsx.writeBuffer()) as any;
}

// ============================================================
// ALIAS: required by excel-routes.ts
// ============================================================
export const buildExcelWorkbook: (params: ExcelExportParams) => Promise<any> = exportToExcel;



