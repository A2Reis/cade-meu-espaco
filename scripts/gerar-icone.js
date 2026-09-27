'use strict';
// Gera build/icon.png (1024x1024) e build/icon.ico (vários tamanhos) a partir
// de build/icon.svg. Roda com o próprio Electron (npm run icone), porque o
// Chromium já sabe desenhar SVG num <canvas>: nada de dependência nova.
//
// Cada tamanho é desenhado direto do vetor, não reduzido de uma imagem grande,
// então o 16x16 sai nítido. O ICO leva as imagens como PNG dentro (aceito
// pelo Windows desde o Vista) e o cabeçalho é montado na mão.

const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// O Chromium sempre cria pasta de dados (cache etc.) e segura os arquivos até
// o processo acabar, então não dá pra apagar daqui. Usa sempre a mesma pasta
// na pasta temporária do sistema: não acumula e não suja %APPDATA%\Electron.
app.setPath('userData', path.join(os.tmpdir(), 'cade-meu-espaco-icone'));

const PASTA = path.join(__dirname, '..', 'build');
const SVG = path.join(PASTA, 'icon.svg');
const TAMANHOS = [16, 20, 24, 32, 40, 48, 64, 96, 128, 256, 512, 1024];
const TAMANHOS_ICO = [16, 20, 24, 32, 40, 48, 64, 96, 128, 256];

// Troca width/height da tag <svg> pelo tamanho pedido, pra o Chromium
// rasterizar o vetor já no tamanho final.
function svgNoTamanho(texto, lado) {
  return texto.replace(/<svg\b[^>]*>/, (tag) => {
    const semMedidas = tag.replace(/\s(width|height)="[^"]*"/g, '');
    return semMedidas.replace(/^<svg/, `<svg width="${lado}" height="${lado}"`);
  });
}

// Código que roda dentro da janela escondida: desenha e devolve o PNG em base64.
function codigoDesenho(svg, lado) {
  const url = 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64');
  return `new Promise((ok, falha) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = ${lado};
      c.height = ${lado};
      const ctx = c.getContext('2d');
      ctx.clearRect(0, 0, ${lado}, ${lado});
      ctx.drawImage(img, 0, 0, ${lado}, ${lado});
      ok(c.toDataURL('image/png').split(',')[1]);
    };
    img.onerror = () => falha(new Error('não deu pra carregar o SVG'));
    img.src = ${JSON.stringify(url)};
  })`;
}

// ICONDIR (6 bytes) + um ICONDIRENTRY (16 bytes) por imagem + os PNGs.
// Largura/altura 0 no ICONDIRENTRY quer dizer 256.
function montarIco(imagens) {
  const cabecalho = Buffer.alloc(6);
  cabecalho.writeUInt16LE(0, 0); // reservado
  cabecalho.writeUInt16LE(1, 2); // 1 = ícone
  cabecalho.writeUInt16LE(imagens.length, 4);

  const entradas = [];
  let deslocamento = 6 + 16 * imagens.length;
  for (const { lado, png } of imagens) {
    const e = Buffer.alloc(16);
    e.writeUInt8(lado >= 256 ? 0 : lado, 0);
    e.writeUInt8(lado >= 256 ? 0 : lado, 1);
    e.writeUInt8(0, 2); // sem paleta
    e.writeUInt8(0, 3); // reservado
    e.writeUInt16LE(1, 4); // planos
    e.writeUInt16LE(32, 6); // bits por pixel (RGBA)
    e.writeUInt32LE(png.length, 8);
    e.writeUInt32LE(deslocamento, 12);
    deslocamento += png.length;
    entradas.push(e);
  }
  return Buffer.concat([cabecalho, ...entradas, ...imagens.map((i) => i.png)]);
}

async function gerar() {
  const svg = fs.readFileSync(SVG, 'utf8');
  const janela = new BrowserWindow({
    show: false,
    webPreferences: { contextIsolation: true, sandbox: true, backgroundThrottling: false },
  });
  await janela.loadURL('about:blank');

  const pngs = new Map();
  for (const lado of TAMANHOS) {
    const base64 = await janela.webContents.executeJavaScript(codigoDesenho(svgNoTamanho(svg, lado), lado));
    const png = Buffer.from(base64, 'base64');
    // Confere a largura e a altura gravadas no cabeçalho IHDR do PNG.
    if (png.readUInt32BE(16) !== lado || png.readUInt32BE(20) !== lado) {
      throw new Error(`PNG de ${lado}px saiu com o tamanho errado`);
    }
    pngs.set(lado, png);
  }
  janela.destroy();

  fs.writeFileSync(path.join(PASTA, 'icon.png'), pngs.get(1024));
  const ico = montarIco(TAMANHOS_ICO.map((lado) => ({ lado, png: pngs.get(lado) })));
  fs.writeFileSync(path.join(PASTA, 'icon.ico'), ico);

  console.log(`build/icon.png: 1024x1024, ${pngs.get(1024).length} bytes`);
  console.log(`build/icon.ico: ${TAMANHOS_ICO.join(', ')} px, ${ico.length} bytes`);
}

// Fechar a janela escondida não pode encerrar o app antes de gravar os arquivos.
app.on('window-all-closed', () => {});

app.whenReady()
  .then(gerar)
  .then(() => app.quit())
  .catch((e) => {
    console.error('Falhou ao gerar o ícone:', e.message);
    app.exit(1);
  });
