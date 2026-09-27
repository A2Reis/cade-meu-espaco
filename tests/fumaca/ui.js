'use strict';
// Teste de fumaça da interface: abre ui/index.html num Chromium (Playwright),
// injeta um window.cade ligado ao motor real (worker thread, varredura real
// numa pasta temporária) e clica pelas telas tirando capturas.
//
// Não faz parte do `npm test` porque precisa do Chromium. Roda com:
//   npm run fumaca
// Capturas ficam em tests/fumaca/saida/.
//
// O que ele confere que o `npm test` não cobre: a CSP não bloqueia os
// scripts, a página monta sem erro no console, a navegação por pastas e as
// abas funcionam com dados de verdade.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { execSync } = require('node:child_process');
const { Motor } = require('../../src/motor');
const fmt = require('../../src/formatar');

function carregarPlaywright() {
  try {
    return require('playwright');
  } catch {
    const global = execSync('npm root -g').toString().trim();
    return require(path.join(global, 'playwright'));
  }
}

const MB = 1024 * 1024;

function montarFixture() {
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'cade-fumaca-'));
  const escrever = (rel, tamanho) => {
    const c = path.join(raiz, rel);
    fs.mkdirSync(path.dirname(c), { recursive: true });
    fs.writeFileSync(c, Buffer.alloc(tamanho, 65));
  };
  escrever('leia-me.txt', 3 * MB);
  escrever('Documentos/Fotos/praia.jpg', 4 * MB);
  escrever('Documentos/Fotos/serra.jpg', 2 * MB);
  escrever('Documentos/Fotos/festa.jpg', 1 * MB);
  escrever('Documentos/Videos/aniversario.mp4', 20 * MB);
  escrever('Jogos/Steam/jogo-a.pak', 15 * MB);
  escrever('Jogos/Steam/jogo-b.pak', 8 * MB);
  escrever('Cache/velho.tmp', 2 * MB);
  for (let i = 0; i < 40; i++) escrever('Cache/miudos/parte-' + i + '.bin', 10 * 1024);
  const total = (3 + 4 + 2 + 1 + 20 + 15 + 8 + 2) * MB + 40 * 10 * 1024;
  return { raiz, total, limpar: () => fs.rmSync(raiz, { recursive: true, force: true }) };
}

async function principal() {
  const { chromium } = carregarPlaywright();
  const fixture = montarFixture();
  const motor = new Motor();
  const saida = path.join(__dirname, 'saida');
  fs.mkdirSync(saida, { recursive: true });
  const aberturas = [];

  const navegador = await chromium.launch();
  const pagina = await navegador.newPage({ viewport: { width: 1100, height: 720 } });
  const errosConsole = [];
  pagina.on('console', (m) => {
    if (m.type() === 'error') errosConsole.push(m.text());
  });
  pagina.on('pageerror', (e) => errosConsole.push('pageerror: ' + e.message));

  // Progresso: o motor chama, a página recebe.
  motor.aoProgresso = (p) => {
    pagina.evaluate((dados) => window.__progresso && window.__progresso(dados), p).catch(() => {});
  };

  await pagina.exposeFunction('cade_discos', () => [{ caminho: fixture.raiz, total: 500 * 1024 * MB, livre: 40 * 1024 * MB, usado: 460 * 1024 * MB }]);
  await pagina.exposeFunction('cade_escolherPasta', () => null);
  await pagina.exposeFunction('cade_varrer', (raiz) => motor.varrer(raiz));
  await pagina.exposeFunction('cade_parar', () => motor.parar());
  await pagina.exposeFunction('cade_filhos', (c) => motor.filhos(c));
  await pagina.exposeFunction('cade_arquivosDe', (c, l) => motor.arquivosDe(c, l));
  await pagina.exposeFunction('cade_maioresArquivos', () => motor.maioresArquivos());
  await pagina.exposeFunction('cade_pastasMaisPesadas', () => motor.pastasMaisPesadas());
  await pagina.exposeFunction('cade_semPermissao', () => motor.semPermissao());
  await pagina.exposeFunction('cade_abrir', (c, ehArquivo) => {
    aberturas.push({ caminho: c, ehArquivo });
    return '';
  });
  await pagina.addInitScript(() => {
    window.cade = {
      discos: () => window.cade_discos(),
      escolherPasta: () => window.cade_escolherPasta(),
      varrer: (r) => window.cade_varrer(r),
      parar: () => window.cade_parar(),
      filhos: (c) => window.cade_filhos(c),
      arquivosDe: (c, l) => window.cade_arquivosDe(c, l),
      maioresArquivos: () => window.cade_maioresArquivos(),
      pastasMaisPesadas: () => window.cade_pastasMaisPesadas(),
      semPermissao: () => window.cade_semPermissao(),
      abrir: (c, e) => window.cade_abrir(c, e),
      aoProgresso: (fn) => { window.__progresso = fn; },
    };
  });

  try {
    await pagina.goto('file://' + path.join(__dirname, '..', '..', 'ui', 'index.html'));
    await pagina.waitForSelector('#disco option', { state: 'attached' });
    assert.equal(await pagina.textContent('#alvo'), 'Vai varrer: ' + fixture.raiz);
    await pagina.screenshot({ path: path.join(saida, '1-inicio.png') });

    // tela de progresso com números fictícios, só pra ver que renderiza
    await pagina.evaluate(() => {
      document.getElementById('progresso').hidden = false;
      window.__progresso({ pastas: 12345, arquivos: 987654, bytes: 123 * 1024 * 1024 * 1024, semPermissao: 3, atual: 'C:\\Users\\augusto\\AppData\\Local\\Temp' });
    });
    await pagina.screenshot({ path: path.join(saida, '2-progresso.png') });
    await pagina.evaluate(() => { document.getElementById('progresso').hidden = true; });

    await pagina.click('#btn-varrer');
    await pagina.waitForSelector('#resumo:not([hidden])');
    await pagina.waitForSelector('#lista-pastas .linha');
    const resumo = await pagina.textContent('#resumo');
    assert.ok(resumo.includes(fmt.formatarBytes(fixture.total)), 'resumo mostra o total: ' + resumo);
    assert.ok(resumo.includes('O disco diz'), 'resumo compara com o disco');

    const nomes = await pagina.$$eval('#lista-pastas .linha .nome', (ns) => ns.map((n) => n.firstChild.textContent));
    assert.deepEqual(nomes, ['Documentos', 'Jogos', 'Cache', 'Arquivos soltos nesta pasta']);
    const tamanhos = await pagina.$$eval('#lista-pastas .linha .tam', (ns) => ns.map((n) => n.textContent));
    assert.deepEqual(tamanhos, ['27,0 MB', '23,0 MB', '2,39 MB', '3,00 MB']);
    await pagina.screenshot({ path: path.join(saida, '3-pastas-raiz.png') });

    // entra em Documentos, depois em Videos
    await pagina.click('#lista-pastas .linha:nth-child(1)');
    await pagina.waitForFunction(() => document.querySelector('#trilha button.atual')?.textContent === 'Documentos');
    const dentro = await pagina.$$eval('#lista-pastas .linha .nome', (ns) => ns.map((n) => n.firstChild.textContent));
    assert.deepEqual(dentro, ['Videos', 'Fotos']);
    await pagina.click('#lista-pastas .linha:nth-child(2)');
    await pagina.waitForFunction(() => document.querySelector('#trilha button.atual')?.textContent === 'Fotos');
    await pagina.click('#lista-pastas .linha.arquivos-soltos');
    await pagina.waitForSelector('.arquivos-lista .linha');
    const fotos = await pagina.$$eval('.arquivos-lista .linha .nome', (ns) => ns.map((n) => n.firstChild.textContent));
    assert.deepEqual(fotos, ['praia.jpg', 'serra.jpg', 'festa.jpg']);
    await pagina.screenshot({ path: path.join(saida, '4-pasta-fotos.png') });

    // botão Mostrar chama abrir com ehArquivo = true
    await pagina.click('.arquivos-lista .linha:nth-child(1) .acoes button');
    await pagina.waitForFunction(() => true);
    assert.equal(aberturas.length, 1);
    assert.equal(aberturas[0].ehArquivo, true);
    assert.equal(path.basename(aberturas[0].caminho), 'praia.jpg');

    // subir um nível duas vezes volta pra raiz
    await pagina.click('#btn-subir');
    await pagina.waitForFunction(() => document.querySelector('#trilha button.atual')?.textContent === 'Documentos');
    await pagina.keyboard.press('Backspace');
    await pagina.waitForFunction(() => document.querySelectorAll('#trilha button').length === 1);
    assert.equal(await pagina.$eval('#btn-subir', (b) => b.disabled), true);

    // aba Maiores arquivos
    await pagina.click('#abas button[data-aba="arquivos"]');
    await pagina.waitForSelector('#lista-arquivos .linha');
    const maiores = await pagina.$$eval('#lista-arquivos .linha .nome', (ns) => ns.map((n) => n.firstChild.textContent));
    assert.equal(maiores[0], '1. aniversario.mp4');
    assert.equal(maiores[1], '2. jogo-a.pak');
    await pagina.screenshot({ path: path.join(saida, '5-maiores-arquivos.png') });

    // "Ver pasta" leva pra aba Pastas na pasta do arquivo
    await pagina.click('#lista-arquivos .linha:nth-child(1) .acoes button:nth-child(2)');
    await pagina.waitForFunction(() => document.querySelector('#trilha button.atual')?.textContent === 'Videos');
    assert.equal(await pagina.$eval('#aba-pastas', (s) => s.hidden), false);

    // aba Pastas mais pesadas
    await pagina.click('#abas button[data-aba="pesadas"]');
    await pagina.waitForSelector('#lista-pesadas .linha');
    const pesadas = await pagina.$$eval('#lista-pesadas .linha .nome', (ns) => ns.map((n) => n.firstChild.textContent));
    assert.ok(pesadas[0].endsWith(path.join('Jogos', 'Steam')), pesadas[0]);
    await pagina.screenshot({ path: path.join(saida, '6-pastas-pesadas.png') });

    // aba Sem permissão (vazia nesta fixture)
    await pagina.click('#abas button[data-aba="erros"]');
    await pagina.waitForSelector('#lista-erros .nota, #lista-erros .linha');
    await pagina.screenshot({ path: path.join(saida, '7-sem-permissao.png') });

    assert.deepEqual(errosConsole, [], 'sem erro no console (CSP inclusa)');
    process.stdout.write('Fumaça OK. Capturas em ' + saida + '\n');
  } finally {
    await navegador.close();
    await motor.encerrar();
    fixture.limpar();
  }
}

principal().catch((e) => {
  process.stderr.write('FALHOU: ' + (e.stack || e) + '\n');
  process.exit(1);
});
