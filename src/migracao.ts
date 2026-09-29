import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { Armazenamento, PREFIXO_R2 } from './armazenamento';
import { Db, ok } from './db';
import { log } from './log';
import { emParalelo } from './util';

/* ---------- migração Supabase Storage -> R2 ---------- */

interface Alvo {
  tabela: 'documentos' | 'eventos';
  coluna: 'xml_path' | 'xml_resumo_path';
}
const ALVOS: Alvo[] = [
  { tabela: 'documentos', coluna: 'xml_path' },
  { tabela: 'documentos', coluna: 'xml_resumo_path' },
  { tabela: 'eventos', coluna: 'xml_path' },
];

/**
 * Move arquivos do formato antigo (gzip no Supabase Storage) para o R2 criptografado,
 * atualiza o caminho no banco e só então apaga o arquivo antigo. Pode ser interrompida e retomada.
 */
export async function migrarParaR2(db: Db, arm: Armazenamento, limite = 200): Promise<number> {
  if (!arm.usaR2) return 0;
  let movidos = 0;
  for (const alvo of ALVOS) {
    const linhas = ok(
      await db.from(alvo.tabela).select(`id,${alvo.coluna}`).not(alvo.coluna, 'is', null)
        .not(alvo.coluna, 'like', `${PREFIXO_R2}%`).limit(limite),
      `listar ${alvo.tabela}.${alvo.coluna} para migrar`,
    ) as any[];
    if (!linhas.length) continue;

    const apagar: string[] = [];
    await emParalelo(linhas, 8, async (l) => {
      const antigo: string = l[alvo.coluna];
      try {
        const xml = zlib.gunzipSync(await arm.lerBruto(antigo));
        const chave = antigo.replace(/\.gz$/, '');
        await arm.enviarR2(chave, arm.selarXml(xml));
        const r = await db.from(alvo.tabela).update({ [alvo.coluna]: PREFIXO_R2 + chave }).eq('id', l.id).eq(alvo.coluna, antigo);
        if (r.error) throw new Error(r.error.message);
        apagar.push(antigo);
        movidos++;
      } catch (e) {
        log.warn('falha ao migrar arquivo para o R2', { arquivo: antigo, erro: (e as Error).message });
      }
    });
    for (let i = 0; i < apagar.length; i += 100) {
      await arm.removerSupabase(apagar.slice(i, i + 100)).catch((e) => log.warn('falha ao apagar arquivos antigos', { erro: (e as Error).message }));
    }
  }
  if (movidos) log.info('arquivos migrados para o R2', { quantidade: movidos });
  return movidos;
}

/* ---------- backup incremental no disco da VPS ---------- */

/**
 * Copia para o disco local (volume do Easypanel) os arquivos criados ou alterados desde o último backup.
 * Os arquivos ficam como estão no R2: compactados e criptografados.
 */
export async function fazerBackup(db: Db, arm: Armazenamento, pasta: string): Promise<number> {
  if (!arm.usaR2) return 0;
  try {
    fs.mkdirSync(pasta, { recursive: true });
    fs.accessSync(pasta, fs.constants.W_OK);
  } catch {
    log.warn('pasta de backup indisponível; backup pulado', { pasta });
    return 0;
  }
  const arqControle = path.join(pasta, '.ultimo-backup');
  const desde = fs.existsSync(arqControle) ? fs.readFileSync(arqControle, 'utf8').trim() : '1970-01-01T00:00:00Z';
  const inicio = new Date().toISOString();

  const caminhos = new Set<string>();
  for (const [tabela, colunaData, colunas] of [
    ['documentos', 'atualizado_em', 'xml_path,xml_resumo_path'],
    ['eventos', 'capturado_em', 'xml_path'],
  ] as const) {
    for (let de = 0; ; de += 1000) {
      const pagina = ok(
        await db.from(tabela).select(colunas).gt(colunaData, desde).order(colunaData).range(de, de + 999),
        `listar ${tabela} para backup`,
      ) as any[];
      for (const l of pagina) {
        for (const c of colunas.split(',')) if (l[c]?.startsWith(PREFIXO_R2)) caminhos.add(l[c]);
      }
      if (pagina.length < 1000) break;
    }
  }

  let copiados = 0;
  await emParalelo([...caminhos], 8, async (c) => {
    try {
      const destino = path.join(pasta, c.slice(PREFIXO_R2.length));
      fs.mkdirSync(path.dirname(destino), { recursive: true });
      fs.writeFileSync(destino, await arm.lerBruto(c));
      copiados++;
    } catch (e) {
      log.warn('falha no backup de arquivo', { arquivo: c, erro: (e as Error).message });
    }
  });
  if (copiados === caminhos.size) fs.writeFileSync(arqControle, inicio);
  log.info('backup concluído', { copiados, total: caminhos.size, desde });
  return copiados;
}
