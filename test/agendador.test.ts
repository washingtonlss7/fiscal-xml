/**
 * Simulação do agendador com 1.000 empresas (tempo em escala: 1 ms aqui = 100 ms reais).
 *
 *   npx tsx test/agendador.test.ts
 */
import assert from 'assert';
import { Agendador, Trabalho } from '../src/agendador';
import { liberadoEm } from '../src/sync';
import { dentroDaJanela, esperar, lerJanela } from '../src/util';

const ESCALA = 100; // 1 ms simulado = 100 ms reais
const EMPRESAS = 1000;
const VAGAS = 30;

async function simular() {
  // "Banco": próxima consulta de cada empresa. Todas vencidas no início (cadastro em massa).
  const proxima = new Map<string, number>();
  for (let i = 0; i < EMPRESAS; i++) proxima.set(`emp-${String(i).padStart(4, '0')}`, Date.now() - i);

  let ativos = 0;
  let pico = 0;
  let chamadasFonte = 0;
  const execucoes = new Map<string, number>();
  const rodandoAgora = new Set<string>();

  const fonte = async (limite: number, excluir: string[]): Promise<Trabalho[]> => {
    chamadasFonte++;
    await esperar(1); // ida ao banco
    const fora = new Set(excluir);
    const agora = Date.now();
    const devidas = [...proxima.entries()]
      .filter(([id, t]) => t <= agora && !fora.has(id))
      .sort((a, b) => a[1] - b[1])
      .slice(0, limite);
    return devidas.map(([id]) => ({
      id,
      rodar: async () => {
        assert.ok(!rodandoAgora.has(id), `empresa ${id} rodando duas vezes ao mesmo tempo`);
        rodandoAgora.add(id);
        ativos++;
        pico = Math.max(pico, ativos);
        // NF-e + CT-e + gravação: 2 a 6 s reais por empresa em dia
        await esperar((2000 + Math.random() * 4000) / ESCALA);
        execucoes.set(id, (execucoes.get(id) ?? 0) + 1);
        proxima.set(id, Date.now() + 3 * 3600_000); // volta em 3 h
        ativos--;
        rodandoAgora.delete(id);
        if (id === 'emp-0007') throw new Error('falha simulada de uma empresa');
      },
    }));
  };

  const erros: unknown[] = [];
  const ag = new Agendador(VAGAS, fonte, (e) => erros.push(e), 60_000);
  const t0 = Date.now();
  const timer = setInterval(() => void ag.abastecer(), 150 / ESCALA * 10);
  await ag.abastecer();
  while (execucoes.size < EMPRESAS && Date.now() - t0 < 60_000) await esperar(5);
  clearInterval(timer);
  await ag.parar();
  const realSeg = ((Date.now() - t0) * ESCALA) / 1000;

  assert.equal(execucoes.size, EMPRESAS, 'todas as empresas devem ser sincronizadas');
  assert.ok([...execucoes.values()].every((n) => n === 1), 'nenhuma empresa deve rodar duas vezes no mesmo ciclo');
  assert.ok(pico <= VAGAS, `pico de ${pico} passou do limite de ${VAGAS}`);
  assert.ok(pico >= VAGAS - 2, `as vagas devem ficar ocupadas (pico ${pico})`);
  assert.equal(erros.length, 1, 'a falha de uma empresa não derruba o agendador');
  console.log(
    `ok  ${EMPRESAS} empresas, ${VAGAS} simultâneas: ciclo completo em ~${Math.round(realSeg / 60)} min reais ` +
      `(pico ${pico}, ${chamadasFonte} consultas ao banco)`,
  );
}

async function semGiroEmFalso() {
  // Empresa que falha sem atualizar a próxima consulta não pode ser repetida sem parar.
  let execucoes = 0;
  const ag = new Agendador(5, async (_l, excluir) => (excluir.includes('x') ? [] : [{ id: 'x', rodar: async () => { execucoes++; throw new Error('senha errada'); } }]), () => {}, 60_000);
  for (let i = 0; i < 20; i++) {
    await ag.abastecer();
    await esperar(2);
  }
  await ag.parar();
  assert.equal(execucoes, 1);
  console.log('ok  empresa com falha espera a pausa antes de tentar de novo');
}

async function respeitaExternos() {
  // Empresa em sincronização manual (painel) não é iniciada pelo agendador.
  const manual = new Set(['m']);
  let rodou = false;
  const ag = new Agendador(5, async (_l, excluir) => (excluir.includes('m') ? [] : [{ id: 'm', rodar: async () => { rodou = true; } }]), () => {}, 60_000, () => manual);
  await ag.abastecer();
  await ag.parar();
  assert.equal(rodou, false);
  console.log('ok  não inicia empresa que já está em sincronização manual');
}

function pedidoManual() {
  const agora = Date.now();
  const h = 3600_000;
  const iso = (ms: number) => new Date(ms).toISOString();
  // Em dia, última consulta há 2 h, próxima automática daqui a 1 h: manual libera já.
  const emDia = { proxima_consulta_em: iso(agora + h), ultima_consulta_em: iso(agora - 2 * h), ultimo_cstat: '137', erros_consecutivos: 0 };
  assert.ok(liberadoEm(emDia, true) <= agora);
  assert.ok(liberadoEm(emDia, false) > agora);
  // Consultou há 20 min: nem o manual pode (regra de 1 hora da SEFAZ).
  const recente = { ...emDia, ultima_consulta_em: iso(agora - 20 * 60_000) };
  assert.ok(liberadoEm(recente, true) > agora);
  // Bloqueio 656 e erro valem também para o manual.
  assert.ok(liberadoEm({ ...emDia, ultimo_cstat: '656' }, true) > agora);
  assert.ok(liberadoEm({ ...emDia, erros_consecutivos: 2 }, true) > agora);
  console.log('ok  pedido manual respeita a regra de 1 hora, 656 e erros');
}

function janela() {
  const j = lerJanela('23-6')!;
  const em = (h: string) => new Date(`2026-09-29T${h}:00-03:00`);
  for (const h of ['23:00', '23:30', '00:00', '03:15', '05:59']) assert.ok(dentroDaJanela(j, em(h)), `${h} deveria estar dentro`);
  for (const h of ['06:00', '09:00', '13:44', '22:59']) assert.ok(!dentroDaJanela(j, em(h)), `${h} deveria estar fora`);
  assert.equal(j.texto, '23h às 6h');
  assert.equal(lerJanela(''), null);
  assert.ok(dentroDaJanela(null));
  const dia = lerJanela('08:30-18:00')!;
  assert.ok(dentroDaJanela(dia, em('12:00')) && !dentroDaJanela(dia, em('08:29')) && !dentroDaJanela(dia, em('18:00')));
  assert.throws(() => lerJanela('23h'));
  console.log('ok  janela 23h às 6h (atravessa a meia-noite, horário de Brasília)');
}

(async () => {
  janela();
  pedidoManual();
  await semGiroEmFalso();
  await respeitaExternos();
  await simular();
  console.log('\nTestes do agendador passaram.');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
