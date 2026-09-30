/**
 * Integração com o Sistema Acessórias (e-Contínuo): token cifrado, envio do PDF, erros, não reenviar e lote.
 *
 *   npx tsx test/acessorias.test.ts
 */
import assert from 'assert';
import { lerRespostaEcontinuo, ServicoAcessorias, TransporteAcessorias, URL_ACESSORIAS } from '../src/integra/acessorias';
import { bancoFalso } from './banco-falso';

// 1) Respostas do e-Contínuo (formatos da documentação)
{
  const ok = lerRespostaEcontinuo(200, JSON.stringify({ msg: 'Entrega processada com sucesso! [DAS - Simples Nacional]', pathFolder: '13/Geral/GUIAS/DAS/2026/09/Fiscal/2026-09-DAS.pdf' }));
  assert.deepEqual(ok, { ok: true, mensagem: 'Entrega processada com sucesso! [DAS - Simples Nacional]', caminho: '13/Geral/GUIAS/DAS/2026/09/Fiscal/2026-09-DAS.pdf' });
  const erro = lerRespostaEcontinuo(200, JSON.stringify({ Erro: 'Entrega [DAS para 55.885.998/0001-40] inexistente [Comp. 09/2026].' }));
  assert.deepEqual([erro.ok, erro.mensagem], [false, 'Entrega [DAS para 55.885.998/0001-40] inexistente [Comp. 09/2026].']);
  assert.match(lerRespostaEcontinuo(401, '').mensagem, /recusou o token/);
  assert.match(lerRespostaEcontinuo(429, '').mensagem, /100 envios por minuto/);
  assert.equal(lerRespostaEcontinuo(500, '<html>').ok, false);
  console.log('ok  respostas do e-Contínuo: sucesso com pasta, entrega inexistente, token recusado e limite');
}

(async () => {
  const MK = Buffer.alloc(32, 9).toString('base64');
  const { db, t } = bancoFalso(['integracoes', 'guias', 'guias_envios']);
  const arquivos = new Map<string, Buffer>([['r2:g1', Buffer.from('%PDF das 1')], ['r2:g2', Buffer.from('%PDF das 2')], ['r2:g3', Buffer.from('%PDF das 3')]]);
  const arm = { ler: async (c: string) => arquivos.get(c)! } as any;
  const chamadas: { url: string; token: string; nome?: string; pdf?: string }[] = [];
  let resposta = (_nome: string) => ({ status: 200, corpo: JSON.stringify({ msg: 'Entrega processada com sucesso! [DAS]', pathFolder: 'x/DAS.pdf' }) });
  const tr: TransporteAcessorias = {
    async enviarPdf(url, token, nome, pdf) { chamadas.push({ url, token, nome, pdf: pdf.toString() }); return resposta(nome); },
    async get(url, token) { chamadas.push({ url, token }); return token === 'TOKEN-VALIDO-ACESSORIAS-123' ? { status: 200, corpo: '[]' } : { status: 401, corpo: '' }; },
  };
  const s = new ServicoAcessorias(db, arm, MK, tr, 0);

  // 2) Token: obrigatório, cifrado, nunca devolvido
  assert.equal((await s.situacao()).configurado, false);
  await assert.rejects(s.enviarGuia(1, 'a@x.com'), /não configurada/);
  await assert.rejects(s.salvar({ token: 'curto' }, 'adm@x.com'), /formato inválido/);
  const sit = await s.salvar({ token: 'TOKEN-VALIDO-ACESSORIAS-123' }, 'adm@x.com');
  assert.deepEqual([sit.configurado, sit.finalToken, sit.envioAutomatico, sit.atualizadoPor], [true, '-123', true, 'adm@x.com']);
  assert.ok(!JSON.stringify(sit).includes('TOKEN-VALIDO') && !String(t.integracoes[0].token_cifrado).includes('TOKEN'), 'token só cifrado');
  assert.equal((await s.salvar({ envioAutomatico: false }, 'adm@x.com')).envioAutomatico, false, 'desliga o automático sem trocar o token');
  assert.equal((await s.testar('adm@x.com')).ok, true);
  assert.equal(chamadas[0].url, `${URL_ACESSORIAS}/companies/ListAll?Pagina=1`);
  assert.equal(chamadas[0].token, 'TOKEN-VALIDO-ACESSORIAS-123', 'decifra o token para chamar');
  console.log('ok  token: validação, cifrado no banco, nunca devolvido, envio automático e teste');

  // 3) Envio de guia
  t.guias.push(
    { id: 1, empresa_id: 'e1', tipo: 'das_simples', competencia: '2026-09-01', numero_documento: '0720', caminho: 'r2:g1', gerado_em: '2026-09-30T10:00:00Z' },
    { id: 2, empresa_id: 'e2', tipo: 'das_mei', competencia: '2026-09-01', numero_documento: '0799', caminho: 'r2:g2', gerado_em: '2026-09-30T10:01:00Z' },
    { id: 3, empresa_id: 'e1', tipo: 'das_simples', competencia: '2026-09-01', numero_documento: '0721', caminho: 'r2:g3', gerado_em: '2026-09-30T11:00:00Z' },
    { id: 4, empresa_id: 'e3', tipo: 'das_simples', competencia: '2026-09-01', numero_documento: null, caminho: null, gerado_em: '2026-09-30T11:00:00Z' },
  );
  const e1 = await s.enviarGuia(1, 'a@x.com');
  assert.deepEqual([e1.status, e1.caminho_destino, e1.enviado_por], ['enviado', 'x/DAS.pdf', 'a@x.com']);
  const envio = chamadas[chamadas.length - 1];
  assert.deepEqual([envio.url, envio.nome, envio.pdf], [`${URL_ACESSORIAS}/econtinuo`, 'DAS-2026-09-0720.pdf', '%PDF das 1']);
  await assert.rejects(s.enviarGuia(1, 'a@x.com'), (e: any) => e.status === 409, 'não reenvia sem confirmar');
  await assert.rejects(s.enviarGuia(4, 'a@x.com'), /sem PDF|não tem PDF/);
  resposta = () => ({ status: 200, corpo: JSON.stringify({ Erro: 'Entrega [DAS-MEI para 44.555.666/0001-77] inexistente [Comp. 09/2026].' }) });
  const e2 = await s.enviarGuia(2, 'a@x.com');
  assert.deepEqual([e2.status, e2.mensagem], ['erro', 'Entrega [DAS-MEI para 44.555.666/0001-77] inexistente [Comp. 09/2026].']);
  console.log('ok  envio: PDF pelo e-Contínuo com nome da guia, registro, sem duplicar e erro da Acessórias gravado');

  // 4) Lote: só a guia vigente de cada empresa e só o que não foi aceito
  resposta = () => ({ status: 200, corpo: JSON.stringify({ msg: 'Entrega processada com sucesso!', pathFolder: 'y.pdf' }) });
  const antes = chamadas.length;
  const lote = await s.enviarPendentes('2026-09', 'a@x.com');
  const enviados = chamadas.slice(antes).map((c) => c.nome).sort();
  assert.deepEqual(enviados, ['DAS-2026-09-0721.pdf', 'DAS-MEI-2026-09-0799.pdf'], 'e1 vale a guia 3 (mais recente); e2 reenviada após erro; e3 sem PDF fica de fora do envio');
  assert.deepEqual(lote.resultados.map((r) => r.ok), [true, true], 'guia sem PDF nem entra no lote');
  const lote2 = await s.enviarPendentes('2026-09', 'a@x.com', ['e1', 'e2']);
  assert.deepEqual([lote2.resultados.length, lote2.jaEnviadas], [0, 2], 'nada pendente');
  const ult = await s.ultimosEnvios([1, 2, 3]);
  assert.deepEqual([ult.get(2).status, ult.get(3).status], ['enviado', 'enviado']);
  assert.equal((await s.situacao()).envios30d.total, t.guias_envios.length);
  await s.remover('adm@x.com');
  assert.equal((await s.situacao()).configurado, false);
  console.log('ok  lote: guia vigente por empresa, reenvio do que falhou, nada duplicado; remover a integração');
  console.log('\nTestes da Acessórias passaram.');
})().catch((e) => { console.error(e); process.exit(1); });
