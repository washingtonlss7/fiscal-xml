import zlib from 'zlib';

/**
 * Leitor de ZIP (sem dependências): lê o diretório central e descompacta arquivos "stored" (0) e "deflate" (8).
 * Com limites contra arquivos malformados ou "bombas" de compressão.
 */
export interface ArquivoZip {
  nome: string;
  conteudo: Buffer;
}

export interface LimitesZip {
  maxArquivos: number;
  maxTotal: number; // bytes descompactados somando tudo
  maxArquivo: number; // bytes descompactados por arquivo
}

const PADRAO: LimitesZip = { maxArquivos: 20_000, maxTotal: 500 * 1024 * 1024, maxArquivo: 20 * 1024 * 1024 };

export function ehZip(b: Buffer): boolean {
  return b.length >= 4 && b.readUInt32LE(0) === 0x04034b50;
}

export function lerZip(zip: Buffer, filtro: (nome: string) => boolean = () => true, limites: LimitesZip = PADRAO): ArquivoZip[] {
  // Fim do diretório central (EOCD): assinatura 0x06054b50 nos últimos 64 KB
  let eocd = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 65_557); i--) {
    if (zip.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('ZIP inválido ou corrompido.');
  const total = zip.readUInt16LE(eocd + 10);
  let p = zip.readUInt32LE(eocd + 16);
  if (total === 0xffff || p === 0xffffffff) throw new Error('ZIP64 não suportado. Divida o arquivo em partes menores.');
  if (total > limites.maxArquivos) throw new Error(`ZIP com arquivos demais (${total}; máximo ${limites.maxArquivos}).`);

  const saida: ArquivoZip[] = [];
  let soma = 0;
  for (let n = 0; n < total; n++) {
    if (p + 46 > zip.length || zip.readUInt32LE(p) !== 0x02014b50) throw new Error('ZIP inválido (diretório central).');
    const flags = zip.readUInt16LE(p + 8);
    const metodo = zip.readUInt16LE(p + 10);
    const tamComp = zip.readUInt32LE(p + 20);
    const tamOrig = zip.readUInt32LE(p + 24);
    const lenNome = zip.readUInt16LE(p + 28);
    const lenExtra = zip.readUInt16LE(p + 30);
    const lenComent = zip.readUInt16LE(p + 32);
    const local = zip.readUInt32LE(p + 42);
    const nome = zip.subarray(p + 46, p + 46 + lenNome).toString(flags & 0x800 ? 'utf8' : 'latin1');
    p += 46 + lenNome + lenExtra + lenComent;

    if (nome.endsWith('/') || !filtro(nome)) continue;
    if (flags & 0x1) throw new Error(`"${nome}" está protegido por senha.`);
    if (tamOrig > limites.maxArquivo) throw new Error(`"${nome}" é grande demais.`);
    if (local + 30 > zip.length || zip.readUInt32LE(local) !== 0x04034b50) throw new Error('ZIP inválido (cabeçalho local).');
    const ini = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
    const dados = zip.subarray(ini, ini + tamComp);

    let conteudo: Buffer;
    if (metodo === 0) conteudo = Buffer.from(dados);
    else if (metodo === 8) conteudo = zlib.inflateRawSync(dados, { maxOutputLength: limites.maxArquivo });
    else throw new Error(`"${nome}" usa um método de compressão não suportado.`);

    soma += conteudo.length;
    if (soma > limites.maxTotal) throw new Error('ZIP grande demais depois de descompactado.');
    saida.push({ nome, conteudo });
  }
  return saida;
}
