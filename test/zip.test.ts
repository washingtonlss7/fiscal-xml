/** Gera um ZIP com o gerador próprio e confere com o unzip do sistema. */
import assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { Zip } from '../src/painel/zip';

(async () => {
  const arq = path.join(os.tmpdir(), `teste-${Date.now()}.zip`);
  const saida = fs.createWriteStream(arq);
  const zip = new Zip(saida);
  await zip.adicionar('55/entrada/nota-ç.xml', Buffer.from('<a>primeira nota</a>'.repeat(50)));
  await zip.adicionar('57/entrada/cte.xml', Buffer.from('<b>segundo</b>'));
  await zip.finalizar();
  await new Promise<void>((r) => saida.end(r));
  const lista = execFileSync('unzip', ['-t', arq]).toString();
  assert.ok(/No errors detected/.test(lista), lista);
  const conteudo = execFileSync('unzip', ['-p', arq, '57/entrada/cte.xml']).toString();
  assert.equal(conteudo, '<b>segundo</b>');
  fs.unlinkSync(arq);
  console.log('ok  ZIP válido (unzip -t) e conteúdo íntegro');
})();
