import readline from 'readline';

/** Pede a senha no terminal sem mostrar o que é digitado. */
export function perguntarSenha(rotulo = 'Senha do certificado: '): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    const saida = rl as unknown as { _writeToOutput: (s: string) => void; output: NodeJS.WriteStream };
    process.stdout.write(rotulo);
    saida._writeToOutput = (s: string) => {
      if (s.includes('\n') || s.includes('\r')) saida.output.write('\n');
    };
    rl.question('', (resp) => {
      rl.close();
      resolve(resp);
    });
  });
}
