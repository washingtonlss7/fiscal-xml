import zlib from 'zlib';
import { Writable } from 'stream';

/**
 * Gerador de ZIP simples (deflate), escrito direto na resposta HTTP.
 * Suficiente para os XMLs de uma empresa no mês (menos de 65 mil arquivos e 4 GB).
 */
export class Zip {
  private central: Buffer[] = [];
  private deslocamento = 0;
  private quantidade = 0;

  constructor(private readonly saida: Writable) {}

  private escrever(b: Buffer): Promise<void> {
    this.deslocamento += b.length;
    return new Promise((resolve) => {
      if (this.saida.write(b)) resolve();
      else this.saida.once('drain', () => resolve());
    });
  }

  async adicionar(nome: string, conteudo: Buffer, data = new Date()): Promise<void> {
    if (this.quantidade >= 65000) throw new Error('Arquivos demais para um único ZIP.');
    const nomeBuf = Buffer.from(nome, 'utf8');
    const comprimido = zlib.deflateRawSync(conteudo);
    const crc = zlib.crc32(conteudo) >>> 0;
    const hora = (data.getHours() << 11) | (data.getMinutes() << 5) | Math.floor(data.getSeconds() / 2);
    const dia = ((data.getFullYear() - 1980) << 9) | ((data.getMonth() + 1) << 5) | data.getDate();
    const inicio = this.deslocamento;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);        // versão necessária
    local.writeUInt16LE(0x0800, 6);    // nomes em UTF-8
    local.writeUInt16LE(8, 8);         // deflate
    local.writeUInt16LE(hora, 10);
    local.writeUInt16LE(dia, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(comprimido.length, 18);
    local.writeUInt32LE(conteudo.length, 22);
    local.writeUInt16LE(nomeBuf.length, 26);
    local.writeUInt16LE(0, 28);
    await this.escrever(local);
    await this.escrever(nomeBuf);
    await this.escrever(comprimido);

    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0);
    c.writeUInt16LE(20, 4);
    c.writeUInt16LE(20, 6);
    c.writeUInt16LE(0x0800, 8);
    c.writeUInt16LE(8, 10);
    c.writeUInt16LE(hora, 12);
    c.writeUInt16LE(dia, 14);
    c.writeUInt32LE(crc, 16);
    c.writeUInt32LE(comprimido.length, 20);
    c.writeUInt32LE(conteudo.length, 24);
    c.writeUInt16LE(nomeBuf.length, 28);
    c.writeUInt32LE(inicio, 42);
    this.central.push(c, nomeBuf);
    this.quantidade++;
  }

  async finalizar(): Promise<void> {
    const inicioCentral = this.deslocamento;
    const central = Buffer.concat(this.central);
    await this.escrever(central);
    const fim = Buffer.alloc(22);
    fim.writeUInt32LE(0x06054b50, 0);
    fim.writeUInt16LE(this.quantidade, 8);
    fim.writeUInt16LE(this.quantidade, 10);
    fim.writeUInt32LE(central.length, 12);
    fim.writeUInt32LE(inicioCentral, 16);
    await this.escrever(fim);
  }
}
