import 'dotenv/config';

function obrigatorio(nome: string): string {
  const v = process.env[nome];
  if (!v || !v.trim()) throw new Error(`Variável de ambiente ${nome} não definida. Veja o .env.example.`);
  return v.trim();
}

function opcional(nome: string, padrao: string): string {
  const v = process.env[nome];
  return v && v.trim() ? v.trim() : padrao;
}

/** Ambiente da SEFAZ: 1 = produção, 2 = homologação. */
export function tpAmb(): 1 | 2 {
  const v = opcional('TP_AMB', '1');
  if (v !== '1' && v !== '2') throw new Error('TP_AMB deve ser 1 (produção) ou 2 (homologação).');
  return Number(v) as 1 | 2;
}

/** Caminho opcional de um arquivo PEM com a cadeia ICP-Brasil (ver README). */
export function caBundlePath(): string | undefined {
  const v = process.env.SEFAZ_CA_FILE;
  return v && v.trim() ? v.trim() : undefined;
}

export function configWorker() {
  return {
    supabaseUrl: obrigatorio('SUPABASE_URL'),
    supabaseServiceKey: obrigatorio('SUPABASE_SERVICE_ROLE_KEY'),
    masterKey: obrigatorio('MASTER_KEY'),
    bucket: opcional('XML_BUCKET', 'xmls'),
    concorrencia: Math.max(1, Number(opcional('CONCORRENCIA', '10'))),
    // Horários das rodadas (cron, fuso de São Paulo). Separados por ";".
    cronRodadas: opcional('CRON_RODADAS', '0 2 * * *;0 14 * * *').split(';').map((s) => s.trim()).filter(Boolean),
    rodarAoIniciar: opcional('RODAR_AO_INICIAR', 'false') === 'true',
    // Máximo de chamadas seguidas por empresa/modelo numa rodada (cada uma traz até 50 docs).
    maxChamadasPorRodada: Math.max(1, Number(opcional('MAX_CHAMADAS_POR_RODADA', '40'))),
    tpAmb: tpAmb(),
  };
}

export type ConfigWorker = ReturnType<typeof configWorker>;
