import { Zip } from './zip';

/**
 * Gerador de planilha Excel (.xlsx) mínimo: várias abas, cabeçalho em negrito,
 * formatos de moeda, porcentagem, número e data, e linha de total. Sem dependências.
 */

export type TipoColuna = 'texto' | 'moeda' | 'pct' | 'numero' | 'data' | 'inteiro';

export interface Coluna {
  titulo: string;
  tipo: TipoColuna;
  largura?: number;
  /** Soma a coluna numa linha de total no fim. */
  total?: boolean;
}

export interface Aba {
  nome: string;
  /** Linhas de texto acima da tabela (título, empresa, período). */
  cabecalho?: string[];
  colunas: Coluna[];
  linhas: (string | number | null | undefined)[][];
}

// Estilos (índices em cellXfs): 0 padrão, 1 cabeçalho, 2 moeda, 3 pct, 4 número, 5 data, 6 total moeda, 7 título, 8 total texto, 9 inteiro
const ESTILO: Record<TipoColuna, number> = { texto: 0, moeda: 2, pct: 3, numero: 4, data: 5, inteiro: 9 };

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="4">
<numFmt numFmtId="164" formatCode="#,##0.00"/>
<numFmt numFmtId="165" formatCode="0.00&quot;%&quot;"/>
<numFmt numFmtId="166" formatCode="#,##0.####"/>
<numFmt numFmtId="167" formatCode="dd/mm/yyyy"/>
</numFmts>
<fonts count="3"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="13"/><name val="Calibri"/></font></fonts>
<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE8EEF6"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left/><right/><top style="thin"/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="10">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"><alignment wrapText="1" vertical="center"/></xf>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="166" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="167" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="164" fontId="1" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1"/>
<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="1" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1"/>
<xf numFmtId="1" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
    // caracteres de controle não são aceitos em XML
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');

function letra(i: number): string {
  let s = '';
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

/** Data (AAAA-MM-DD...) para número de série do Excel. */
function serialData(v: string): number | null {
  const m = v.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  return Math.round((Date.UTC(+m[1], +m[2] - 1, +m[3]) - Date.UTC(1899, 11, 30)) / 86400000);
}

function celula(ref: string, v: unknown, estilo: number, tipo: TipoColuna): string {
  if (v === null || v === undefined || v === '') return '';
  if (tipo === 'data' && typeof v === 'string') {
    const s = serialData(v);
    if (s !== null) return `<c r="${ref}" s="${estilo}"><v>${s}</v></c>`;
  }
  if (typeof v === 'number' && Number.isFinite(v) && tipo !== 'texto') return `<c r="${ref}" s="${estilo}"><v>${v}</v></c>`;
  return `<c r="${ref}" s="${estilo === 1 || estilo === 7 || estilo === 8 ? estilo : 0}" t="inlineStr"><is><t xml:space="preserve">${esc(String(v))}</t></is></c>`;
}

function planilha(aba: Aba): string {
  const linhasXml: string[] = [];
  let r = 1;
  for (const [i, t] of (aba.cabecalho ?? []).entries()) {
    linhasXml.push(`<row r="${r}">${celula(`A${r}`, t, i === 0 ? 7 : 0, 'texto')}</row>`);
    r++;
  }
  if (aba.cabecalho?.length) r++;
  const linhaTitulos = r;
  linhasXml.push(`<row r="${r}">${aba.colunas.map((c, i) => celula(`${letra(i)}${r}`, c.titulo, 1, 'texto')).join('')}</row>`);
  r++;
  const primeira = r;
  for (const l of aba.linhas) {
    linhasXml.push(`<row r="${r}">${aba.colunas.map((c, i) => celula(`${letra(i)}${r}`, l[i], ESTILO[c.tipo], c.tipo)).join('')}</row>`);
    r++;
  }
  if (aba.linhas.length && aba.colunas.some((c) => c.total)) {
    const cel = aba.colunas.map((c, i) => {
      const ref = `${letra(i)}${r}`;
      if (i === 0) return `<c r="${ref}" s="8" t="inlineStr"><is><t>Total</t></is></c>`;
      if (!c.total) return `<c r="${ref}" s="8"/>`;
      const soma = aba.linhas.reduce((t, l) => t + (typeof l[i] === 'number' ? (l[i] as number) : 0), 0);
      return `<c r="${ref}" s="6"><f>SUM(${letra(i)}${primeira}:${letra(i)}${r - 1})</f><v>${Math.round(soma * 100) / 100}</v></c>`;
    });
    linhasXml.push(`<row r="${r}">${cel.join('')}</row>`);
  }
  const cols = aba.colunas.map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${c.largura ?? 14}" customWidth="1"/>`).join('');
  const ultimaCol = letra(aba.colunas.length - 1);
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheetViews><sheetView workbookViewId="0"><pane ySplit="${linhaTitulos}" topLeftCell="A${linhaTitulos + 1}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
<cols>${cols}</cols>
<sheetData>${linhasXml.join('')}</sheetData>
${aba.linhas.length ? `<autoFilter ref="A${linhaTitulos}:${ultimaCol}${linhaTitulos + aba.linhas.length}"/>` : ''}
</worksheet>`;
}

/** Nome de aba válido no Excel (até 31 caracteres, sem : \ / ? * [ ]). */
const nomeAba = (s: string) => s.replace(/[:\\/?*[\]]/g, ' ').slice(0, 31);

export async function escreverXlsx(zip: Zip, abas: Aba[]): Promise<void> {
  const b = (s: string) => Buffer.from(s, 'utf8');
  await zip.adicionar('[Content_Types].xml', b(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
${abas.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('\n')}
</Types>`));
  await zip.adicionar('_rels/.rels', b(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`));
  await zip.adicionar('xl/workbook.xml', b(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets>${abas.map((a, i) => `<sheet name="${esc(nomeAba(a.nome))}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets>
</workbook>`));
  await zip.adicionar('xl/_rels/workbook.xml.rels', b(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${abas.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('\n')}
<Relationship Id="rId${abas.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`));
  await zip.adicionar('xl/styles.xml', b(STYLES));
  for (const [i, a] of abas.entries()) await zip.adicionar(`xl/worksheets/sheet${i + 1}.xml`, b(planilha(a)));
  await zip.finalizar();
}
