'use strict';
// Teste de fumaça da interface, rodando no próprio Electron (sem Playwright).
//
// Abre ui/index.html numa BrowserWindow com o preload.js de verdade e as
// mesmas webPreferences do main.js, então a CSP e a ponte window.cade são as
// reais. Os canais IPC são os mesmos do main.js; só o que eles respondem muda.
//
//   npx electron tests/fumaca/app.js           fumaça: motor real numa pasta
//                                              temporária, confere tudo e tira
//                                              capturas em tests/fumaca/saida/
//   npx electron tests/fumaca/app.js --demo    capturas pro README em
//                                              docs/capturas/, com um C:\
//                                              inventado (não lê o disco)
//
// Falha se qualquer conferência falhar ou se aparecer erro no console da
// página (bloqueio da CSP aparece assim). Imprime "Fumaça OK" no fim.

const { app, BrowserWindow, ipcMain, nativeTheme } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');

const RAIZ_PROJETO = path.join(__dirname, '..', '..');
const { Motor } = require(path.join(RAIZ_PROJETO, 'src', 'motor'));
const varredura = require(path.join(RAIZ_PROJETO, 'src', 'varredura'));
const fmt = require(path.join(RAIZ_PROJETO, 'src', 'formatar'));

const MODO_DEMO = process.argv.includes('--demo');
const KB = 1024;
const MB = 1024 * KB;
const GB = 1024 * MB;

// Dados do Chromium (cache, preferências) numa pasta temporária fixa. Ela é
// apagada no começo: no fim o Chromium ainda segura alguns arquivos abertos,
// então uma pasta nova por execução iria se acumulando.
const pastaDados = path.join(os.tmpdir(), 'cade-fumaca-dados');
limparDados();
app.setPath('userData', pastaDados);
// A janela do teste é invisível (ver criarJanela). Se outra janela estiver
// por cima, o Chromium acharia que ela está coberta, pararia de desenhar e a
// captura sairia com a tela anterior; isto desliga essa economia.
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');

let janela = null;
const errosDaPagina = [];

const pausa = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- janela e página ----------

// Janela escondida (show: false) não gera quadro novo e a captura repete o
// anterior. Fora da tela o Windows erra a escala e o tamanho. Então ela fica
// na tela, mas totalmente transparente, sem foco, sem botão na barra de
// tarefas e deixando o mouse passar: quem está usando o PC nem percebe.
function criarJanela(largura, altura, comPreload = true) {
  const j = new BrowserWindow({
    x: 0,
    y: 0,
    width: largura,
    height: altura,
    useContentSize: true,
    // sem moldura: o tamanho da janela é o da página. O app de verdade também
    // esconde a barra de título do Windows (titleBarStyle: 'hidden').
    frame: false,
    show: false,
    opacity: 0,
    focusable: false,
    skipTaskbar: true,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#16171d' : '#f3f4f8',
    webPreferences: {
      preload: comPreload ? path.join(RAIZ_PROJETO, 'preload.js') : undefined,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  j.removeMenu();
  j.setIgnoreMouseEvents(true);
  const wc = j.webContents;
  // Electron 44: o primeiro argumento é um evento com os detalhes; os
  // argumentos soltos (nível numérico, mensagem) ainda vêm, mas são obsoletos.
  wc.on('console-message', (detalhes, nivelAntigo, mensagemAntiga) => {
    const nivel = detalhes && detalhes.level !== undefined ? detalhes.level : nivelAntigo;
    const texto = detalhes && detalhes.message !== undefined ? detalhes.message : mensagemAntiga;
    if (nivel === 'error' || nivel === 3) errosDaPagina.push(texto);
  });
  wc.on('render-process-gone', (_e, d) => errosDaPagina.push('render-process-gone: ' + d.reason));
  wc.on('preload-error', (_e, _caminho, erro) => errosDaPagina.push('preload-error: ' + erro.message));
  wc.on('did-fail-load', (_e, codigo, descricao) => errosDaPagina.push('did-fail-load: ' + codigo + ' ' + descricao));
  wc.setWindowOpenHandler(() => ({ action: 'deny' }));
  return j;
}

async function abrirPagina(j, largura, altura) {
  await j.loadFile(path.join(RAIZ_PROJETO, 'ui', 'index.html'));
  // A janela nunca recebe foco (pra não roubar o de quem usa o PC), e sem
  // foco o Chromium não mostra :focus. A emulação faz a página agir como
  // focada, pro teste do teclado valer o que a pessoa veria.
  j.webContents.debugger.attach('1.3');
  await j.webContents.debugger.sendCommand('Emulation.setFocusEmulationEnabled', { enabled: true });
  j.showInactive();
  // a janela nasce antes de saber a escala da tela; o tamanho certo vem agora
  await mudarTamanho(j, largura, altura);
}

function js(codigo, j = janela) {
  return j.webContents.executeJavaScript(codigo, true);
}

const q = (s) => JSON.stringify(s);

async function esperar(condicao, descricao, limite = 8000, j = janela) {
  const inicio = Date.now();
  for (;;) {
    let ok = false;
    try {
      ok = await js('!!(' + condicao + ')', j);
    } catch {
      ok = false;
    }
    if (ok) return;
    if (Date.now() - inicio > limite) throw new Error('tempo esgotado esperando ' + descricao + '\n  condição: ' + condicao);
    await pausa(40);
  }
}

async function esperarNoPrincipal(condicao, descricao, limite = 5000) {
  const inicio = Date.now();
  while (!condicao()) {
    if (Date.now() - inicio > limite) throw new Error('tempo esgotado esperando ' + descricao);
    await pausa(20);
  }
}

function clicar(seletor) {
  return js(`(() => {
    const e = document.querySelector(${q(seletor)});
    if (!e) throw new Error('não achei ' + ${q(seletor)});
    e.click();
    return true;
  })()`);
}

function focar(seletor) {
  return js(`(() => {
    const e = document.querySelector(${q(seletor)});
    if (!e) throw new Error('não achei ' + ${q(seletor)});
    e.focus();
    return document.activeElement === e;
  })()`);
}

const textos = (seletor) => js(`Array.from(document.querySelectorAll(${q(seletor)}), (e) => e.textContent.trim())`);
const texto = (seletor) => js(`(() => { const e = document.querySelector(${q(seletor)}); return e ? e.textContent.trim() : null; })()`);
const visivel = (seletor) => `(() => { const e = document.querySelector(${q(seletor)}); return !!e && !e.closest('[hidden]'); })()`;
const trilhaAtual = () => texto('#trilha .trilha-item.atual');
const focado = () => js('document.activeElement ? (document.activeElement.dataset.caminho || document.activeElement.id || document.activeElement.tagName) : null');

// Tecla de verdade, pelo mesmo caminho de entrada do teclado físico.
async function tecla(codigo, modificadores = []) {
  const wc = janela.webContents;
  wc.sendInputEvent({ type: 'keyDown', keyCode: codigo, modifiers: modificadores });
  wc.sendInputEvent({ type: 'keyUp', keyCode: codigo, modifiers: modificadores });
  await pausa(60);
}

async function tema(nome) {
  nativeTheme.themeSource = nome;
  await esperar(`matchMedia('(prefers-color-scheme: dark)').matches === ${nome === 'dark'}`, 'tema ' + nome);
  await pausa(300);
}

async function capturar(pasta, nome, larguraFinal) {
  await pausa(300); // transições curtas terminarem
  // dois quadros desenhados depois da última mudança
  await Promise.race([
    js('new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(true))))'),
    pausa(1000),
  ]);
  let img = await janela.webContents.capturePage();
  if (img.isEmpty()) throw new Error('captura vazia: ' + nome);
  // tela com escala diferente de 100% gera imagem maior; padroniza a largura
  if (larguraFinal && img.getSize().width !== larguraFinal) img = img.resize({ width: larguraFinal, quality: 'best' });
  fs.writeFileSync(path.join(pasta, nome), img.toPNG());
}

// Com escala de tela fracionária (125%, 150%) o Windows arredonda a janela
// pra pixel físico, então aceita 2 px de diferença. De vez em quando o
// Windows ignora um pedido de tamanho; tenta de novo antes de desistir.
async function mudarTamanho(j, largura, altura) {
  const condicao = `Math.abs(window.innerWidth - ${largura}) <= 2 && Math.abs(window.innerHeight - ${altura}) <= 2`;
  for (let tentativa = 1; ; tentativa++) {
    j.setContentSize(largura, altura);
    try {
      await esperar(condicao, 'janela ' + largura + 'x' + altura, 1500, j);
      break;
    } catch (e) {
      if (tentativa < 3) continue;
      const real = await js('[window.innerWidth, window.innerHeight]', j);
      throw new Error(e.message + '\n  tamanho real: ' + real.join('x'));
    }
  }
  await pausa(150);
}

const tamanhoJanela = (largura, altura) => mudarTamanho(janela, largura, altura);

// Nada pode vazar pro lado: nem a página, nem a tela visível.
async function conferirSemRolagemLateral(onde) {
  const r = await js(`(() => {
    const tela = document.querySelector('.tela:not([hidden])');
    return {
      pagina: document.documentElement.scrollWidth - window.innerWidth,
      tela: tela ? tela.scrollWidth - tela.clientWidth : 0,
    };
  })()`);
  assert.ok(r.pagina <= 0 && r.tela <= 0, 'rolagem lateral em ' + onde + ': ' + JSON.stringify(r));
}

function registrar(tratadores) {
  for (const [canal, fn] of Object.entries(tratadores)) ipcMain.handle(canal, fn);
}

// ---------- fumaça: motor real numa pasta temporária ----------

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
  for (let i = 0; i < 40; i++) escrever('Cache/miudos/parte-' + i + '.bin', 10 * KB);
  const total = (3 + 4 + 2 + 1 + 20 + 15 + 8 + 2) * MB + 40 * 10 * KB;
  return { raiz, total, limpar: () => fs.rmSync(raiz, { recursive: true, force: true }) };
}

async function fumaca() {
  const fixture = montarFixture();
  const motor = new Motor();
  const saida = path.join(__dirname, 'saida');
  fs.mkdirSync(saida, { recursive: true });
  const aberturas = [];
  const varreduras = [];
  let pedidosDePasta = 0;
  let respostaAbrir = '';
  // Parar: a varredura segura até a interface apertar Parar e aí começa já
  // parada. Assim o parcial é sempre o mesmo, sem depender de relógio.
  let segurar = false;
  let soltar = null;
  const disco = { caminho: fixture.raiz, total: 500 * GB, livre: 40 * GB, usado: 460 * GB };

  motor.aoProgresso = (p) => {
    if (janela && !janela.isDestroyed()) janela.webContents.send('progresso', p);
  };
  registrar({
    discos: () => [disco],
    'escolher-pasta': () => {
      pedidosDePasta++;
      return null;
    },
    varrer: async (_e, raiz) => {
      varreduras.push(raiz);
      if (!segurar) return motor.varrer(raiz);
      await new Promise((r) => {
        soltar = r;
      });
      const pedido = motor.varrer(raiz);
      motor.parar();
      return pedido;
    },
    parar: () => {
      if (soltar) {
        soltar();
        soltar = null;
      } else {
        motor.parar();
      }
    },
    filhos: (_e, c) => motor.filhos(c),
    'arquivos-de': (_e, c, limite) => motor.arquivosDe(c, limite),
    'maiores-arquivos': () => motor.maioresArquivos(),
    'pastas-mais-pesadas': () => motor.pastasMaisPesadas(),
    'sem-permissao': () => motor.semPermissao(),
    abrir: (_e, caminho, ehArquivo) => {
      aberturas.push({ caminho, ehArquivo });
      return respostaAbrir;
    },
  });

  try {
    nativeTheme.themeSource = 'light';
    janela = criarJanela(1100, 720);
    await abrirPagina(janela, 1100, 720);

    // --- início ---
    await esperar('document.querySelector(".cartao-disco")', 'cartão do disco');
    assert.equal(await texto('#alvo'), 'Vai varrer: ' + fixture.raiz);
    assert.equal(await js('document.querySelectorAll(".cartao-disco").length'), 1);
    assert.equal(await texto('.cartao-disco .selo'), '92% cheio');
    assert.equal(await js('document.querySelector(".cartao-disco").getAttribute("aria-current")'), 'true');
    assert.ok(await js('!!document.querySelector(".cartao-disco svg .anel-fatia.cor-critico")'), 'medidor do disco na cor de crítico');
    assert.equal(await js('document.querySelector(".barra-titulo img.logo").naturalWidth > 0'), true, 'logo carregou');
    await conferirSemRolagemLateral('início');
    await capturar(saida, '01-inicio-claro.png');
    await tema('dark');
    await capturar(saida, '01-inicio-escuro.png');
    await tema('light');

    // "Escolher uma pasta…" cancelado não muda o alvo
    await clicar('#cartao-pasta');
    await esperarNoPrincipal(() => pedidosDePasta === 1, 'pedido de pasta');
    await pausa(100);
    assert.equal(await texto('#alvo'), 'Vai varrer: ' + fixture.raiz);

    // --- varrendo, com progresso inventado, e Parar ---
    segurar = true;
    await clicar('.cartao-disco .btn-varrer-disco');
    await esperar(visivel('#tela-varrendo'), 'tela de varredura');
    janela.webContents.send('progresso', {
      pastas: 12345, arquivos: 987654, bytes: 123 * GB, links: 4, semPermissao: 3,
      atual: 'C:\\Users\\augusto\\AppData\\Local\\Temp\\uma-pasta-com-nome-comprido\\mais-fundo',
    });
    await esperar('document.getElementById("p-pastas").textContent === "12.345"', 'progresso na tela');
    assert.equal(await texto('#p-arquivos'), '987.654');
    assert.equal(await texto('#p-bytes'), '123 GB');
    assert.equal(await texto('#p-erros'), '3');
    assert.ok((await texto('#p-atual')).endsWith('mais-fundo'));
    await capturar(saida, '02-varrendo-claro.png');
    await tamanhoJanela(820, 520);
    await conferirSemRolagemLateral('varredura na janela mínima');
    await capturar(saida, '02-varrendo-minima-claro.png');
    await tema('dark');
    await capturar(saida, '02-varrendo-minima-escuro.png');
    await tema('light');
    await tamanhoJanela(1100, 720);

    const botaoParar = await js(`(() => {
      const b = document.getElementById('btn-parar');
      b.click();
      return { desabilitado: b.disabled, texto: b.textContent.trim() };
    })()`);
    assert.deepEqual(botaoParar, { desabilitado: true, texto: 'Parando…' });
    await esperar(visivel('#aviso-parcial'), 'aviso de varredura parcial');
    assert.equal(await texto('#aviso-parcial'), 'Varredura interrompida no Parar: os números são parciais.');
    await esperar('document.querySelector("#lista-pastas .vazio")', 'pasta vazia no parcial');
    assert.ok((await texto('#lista-pastas .vazio')).includes('parou antes'));
    await capturar(saida, '03-parcial-claro.png');
    segurar = false;

    // --- nova varredura, agora completa ---
    await clicar('#btn-nova');
    await esperar(visivel('#tela-inicio'), 'volta pro início');
    await clicar('#btn-varrer');
    await esperar('document.querySelectorAll("#lista-pastas .linha").length === 4', 'linhas da raiz');
    assert.equal(await js('!!document.getElementById("aviso-parcial")'), false, 'sem aviso de parcial');
    const resumo = await texto('#resumo');
    assert.ok(resumo.includes(fmt.formatarBytes(fixture.total)), 'resumo mostra o total: ' + resumo);
    assert.ok(resumo.includes('O disco diz'), 'resumo compara com o disco');
    assert.ok(resumo.includes('Por que a soma é diferente?'), 'resumo explica a diferença');
    assert.equal(await trilhaAtual(), fixture.raiz);
    assert.equal(await js('document.getElementById("btn-subir").disabled'), true, 'Subir desabilitado na raiz');

    const nomes = await textos('#lista-pastas .linha .nome');
    assert.deepEqual(nomes, ['Documentos', 'Jogos', 'Cache', 'Arquivos soltos nesta pasta']);
    const tamanhos = await textos('#lista-pastas .linha .tam');
    assert.deepEqual(tamanhos, ['27,0 MB', '23,0 MB', '2,39 MB', '3,00 MB']);

    // anel de composição: mesmas cores das linhas, soltos puxados pra fora
    const anel = await js(`(() => {
      const fatias = Array.from(document.querySelectorAll('#cabecalho-pasta .anel-fatia'));
      const linhas = Array.from(document.querySelectorAll('#lista-pastas .linha'));
      const cor = (e) => Array.from(e.classList).find((c) => c.startsWith('cor-'));
      return { fatias: fatias.map(cor), linhas: linhas.map(cor), puxada: fatias.filter((f) => f.classList.contains('puxada')).map(cor) };
    })()`);
    assert.deepEqual(anel.fatias, ['cor-1', 'cor-2', 'cor-3', 'cor-soltos']);
    assert.deepEqual(anel.linhas, ['cor-1', 'cor-2', 'cor-3', 'cor-soltos']);
    assert.deepEqual(anel.puxada, ['cor-soltos']);
    await conferirSemRolagemLateral('resultado');
    await capturar(saida, '04-pastas-raiz-claro.png');
    await tema('dark');
    await capturar(saida, '04-pastas-raiz-escuro.png');
    await tema('light');

    // --- entra em Documentos e em Fotos, abre os arquivos soltos ---
    await clicar('#lista-pastas .linha:nth-child(1)');
    await esperar(`document.querySelector('#trilha .trilha-item.atual')?.textContent === 'Documentos'`, 'entrar em Documentos');
    assert.deepEqual(await textos('#lista-pastas .linha .nome'), ['Videos', 'Fotos']);
    await clicar('#lista-pastas .linha:nth-child(2)');
    await esperar(`document.querySelector('#trilha .trilha-item.atual')?.textContent === 'Fotos'`, 'entrar em Fotos');
    await clicar('#lista-pastas .linha.arquivos-soltos');
    await esperar('document.querySelector(".arquivos-lista .linha")', 'lista de arquivos soltos');
    assert.deepEqual(await textos('.arquivos-lista .linha .nome'), ['praia.jpg', 'serra.jpg', 'festa.jpg']);
    assert.equal(await js('document.querySelector(".linha.arquivos-soltos").getAttribute("aria-expanded")'), 'true');
    await capturar(saida, '05-pasta-fotos-claro.png');

    // Mostrar chama abrir com ehArquivo = true
    await clicar('.arquivos-lista .linha:nth-child(1) .acoes button');
    await esperarNoPrincipal(() => aberturas.length === 1, 'chamada de abrir');
    assert.equal(aberturas[0].ehArquivo, true);
    assert.equal(path.basename(aberturas[0].caminho), 'praia.jpg');

    // clicar de novo recolhe
    await clicar('#lista-pastas .linha.arquivos-soltos');
    await esperar('!document.querySelector(".arquivos-lista")', 'recolher arquivos soltos');

    // Subir e Backspace voltam pra raiz
    await clicar('#btn-subir');
    await esperar(`document.querySelector('#trilha .trilha-item.atual')?.textContent === 'Documentos'`, 'Subir');
    await tecla('Backspace');
    await esperar('document.querySelectorAll("#trilha .trilha-item").length === 1', 'Backspace até a raiz');
    assert.equal(await js('document.getElementById("btn-subir").disabled'), true);

    // --- teclado: Enter na linha focada, setas, Alt+Seta esquerda ---
    assert.equal(await focar('#lista-pastas .linha:nth-child(1)'), true);
    await tecla('Enter');
    await esperar(`document.querySelector('#trilha .trilha-item.atual')?.textContent === 'Documentos'`, 'Enter entra na pasta');
    await esperar(`document.activeElement?.dataset?.caminho?.endsWith('Videos')`, 'foco na primeira linha');
    await tecla('Down');
    assert.ok(String(await focado()).endsWith('Fotos'), 'seta pra baixo vai pra Fotos');
    await tecla('Left', ['alt']);
    await esperar('document.querySelectorAll("#trilha .trilha-item").length === 1', 'Alt+Seta esquerda sobe');
    await esperar(`document.activeElement?.dataset?.caminho?.endsWith('Documentos')`, 'foco volta pra pasta de onde subiu');
    assert.equal(await js('document.activeElement.matches(":focus-visible")'), true, 'foco de teclado visível');
    await capturar(saida, '05-foco-teclado-claro.png');

    // Abrir no Explorer do cabeçalho abre a pasta (ehArquivo = false)
    await clicar('#cabecalho-pasta .cabecalho-acoes button');
    await esperarNoPrincipal(() => aberturas.length === 2, 'abrir a pasta aberta');
    assert.deepEqual(aberturas[1], { caminho: fixture.raiz, ehArquivo: false });

    // --- Maiores arquivos ---
    await clicar('#aba-btn-arquivos');
    await esperar('document.querySelector("#lista-arquivos .linha")', 'maiores arquivos');
    assert.equal(await js('document.getElementById("aba-btn-arquivos").getAttribute("aria-selected")'), 'true');
    const maiores = await textos('#lista-arquivos .linha .nome');
    assert.equal(maiores[0], 'aniversario.mp4');
    assert.equal(maiores[1], 'jogo-a.pak');
    assert.deepEqual((await textos('#lista-arquivos .linha .rank')).slice(0, 2), ['1', '2']);
    await capturar(saida, '06-maiores-arquivos-claro.png');

    // setas no tablist trocam de aba
    await focar('#aba-btn-arquivos');
    await tecla('Right');
    await esperar(`document.getElementById('aba-btn-pesadas').getAttribute('aria-selected') === 'true'`, 'seta direita nas abas');
    await clicar('#aba-btn-arquivos');

    // "Ver pasta" leva pra vista Pastas, dentro da pasta do arquivo
    await clicar('#lista-arquivos .linha:nth-child(1) .acoes button:nth-child(2)');
    await esperar(`document.querySelector('#trilha .trilha-item.atual')?.textContent === 'Videos'`, 'Ver pasta');
    assert.equal(await js('document.getElementById("aba-pastas").hidden'), false);
    assert.equal(await js('document.getElementById("aba-btn-pastas").getAttribute("aria-selected")'), 'true');

    // --- Pastas mais pesadas ---
    await clicar('#aba-btn-pesadas');
    await esperar('document.querySelector("#lista-pesadas .linha")', 'pastas mais pesadas');
    const pesada = await js('document.querySelector("#lista-pesadas .linha").dataset.caminho');
    assert.ok(pesada.endsWith(path.join('Jogos', 'Steam')), pesada);
    assert.equal(await texto('#lista-pesadas .linha .nome'), 'Steam');
    await capturar(saida, '07-pesadas-claro.png');
    await tema('dark');
    await capturar(saida, '07-pesadas-escuro.png');
    await tema('light');
    await clicar('#lista-pesadas .linha');
    await esperar(`document.querySelector('#trilha .trilha-item.atual')?.textContent === 'Steam'`, 'clique na pesada navega');

    // --- Sem permissão (nada nesta pasta) ---
    await clicar('#aba-btn-erros');
    await esperar('document.querySelector("#lista-erros .vazio")', 'sem permissão vazio');
    assert.ok((await texto('#lista-erros .vazio')).startsWith('Tudo foi lido'));
    assert.equal(await texto('#contador-erros'), '0');
    await capturar(saida, '08-sem-permissao-claro.png');

    // --- erro do Explorer vira faixa dispensável ---
    await clicar('#aba-btn-pastas');
    respostaAbrir = 'Acesso negado';
    await clicar('#cabecalho-pasta .cabecalho-acoes button');
    await esperar(visivel('#erro-geral'), 'faixa de erro');
    assert.equal(await texto('#erro-texto'), 'Não deu pra abrir no Explorer: Acesso negado');
    await clicar('#btn-fechar-erro');
    await esperar('document.getElementById("erro-geral").hidden', 'fechar faixa de erro');
    respostaAbrir = '';

    // --- janela mínima ---
    await clicar('#trilha .trilha-item');
    await esperar('document.querySelectorAll("#trilha .trilha-item").length === 1', 'trilha leva à raiz');
    await tamanhoJanela(820, 520);
    await conferirSemRolagemLateral('resultado na janela mínima');
    await capturar(saida, '09-minima-claro.png');
    await tema('dark');
    await capturar(saida, '09-minima-escuro.png');
    await tema('light');
    await clicar('#btn-nova');
    await esperar(visivel('#tela-inicio'), 'início na janela mínima');
    await conferirSemRolagemLateral('início na janela mínima');
    await capturar(saida, '10-inicio-minima-claro.png');

    // --- Varrer de novo, no mesmo alvo ---
    await tamanhoJanela(1100, 720);
    await clicar('#btn-varrer');
    await esperar(visivel('#tela-resultado') + ' && document.querySelectorAll("#lista-pastas .linha").length === 4', 'primeira varredura');
    const antes = varreduras.length;
    await clicar('#aba-btn-arquivos');
    await clicar('#btn-de-novo');
    await esperarNoPrincipal(() => varreduras.length === antes + 1, 'varrer de novo');
    assert.equal(varreduras[antes], fixture.raiz, 'varre de novo o mesmo alvo');
    // volta pra vista Pastas, na raiz, com as abas recarregadas
    await esperar(`document.getElementById('aba-btn-pastas').getAttribute('aria-selected') === 'true' && document.querySelectorAll('#lista-pastas .linha').length === 4`, 'resultado de novo');
    assert.equal(await trilhaAtual(), fixture.raiz);
    assert.equal(await js('document.getElementById("lista-arquivos").childElementCount'), 0, 'lista da varredura anterior foi limpa');

    // --- janela grande ---
    await tamanhoJanela(1440, 900);
    await conferirSemRolagemLateral('resultado na janela grande');
    await capturar(saida, '11-grande-claro.png');
    await tamanhoJanela(1100, 720);

    // --- fora do Electron (sem window.cade) ---
    const solta = criarJanela(900, 600, false);
    await abrirPagina(solta, 900, 600);
    await esperar(visivel('#erro-geral'), 'aviso de fora do Electron', 5000, solta);
    const aviso = await js('document.getElementById("erro-texto").textContent', solta);
    assert.ok(aviso.includes('fora do Electron'), aviso);
    assert.equal(await js('document.getElementById("btn-varrer").disabled', solta), true);
    solta.destroy();

    assert.deepEqual(errosDaPagina, [], 'sem erro no console (CSP inclusa)');
    process.stdout.write('Capturas em ' + saida + '\n');
  } finally {
    await motor.encerrar();
    fixture.limpar();
  }
}

// ---------- demo: um C:\ inventado pras capturas do README ----------

// Monta uma árvore no mesmo formato que src/varredura.js monta, pra usar as
// mesmas funções de consulta (listarFilhos, resumo). Assim a interface recebe
// exatamente o que receberia do motor.
//
// Cada pasta: { nome, filhos, soltos: [[nome, bytes, diasAtrás]], resto:
// [bytes, n] (arquivos soltos pequenos, não listados um a um), fechada:
// [bytes, arquivos, pastas] (conteúdo em subpastas que a demo não detalha),
// grandes e pesadas (arquivos e pastas lá dentro que entram nos rankings),
// erro }.
function montarDemo() {
  const agora = Date.now();
  const DIA = 86400000;
  const p = (nome, filhos = [], extra = {}) => ({ nome, filhos, ...extra });
  const f = (nome, bytes, arquivos, pastas, extra = {}) => p(nome, [], { fechada: [bytes, arquivos, pastas], ...extra });
  const trancada = (nome, codigo) => p(nome, [], { erro: codigo });

  const definicao = p('C:\\', [
    p('Users', [
      p('Ana', [
        p('AppData', [
          p('Local', [
            p('Docker', [
              p('wsl', [
                p('disk', [], { soltos: [['ext4.vhdx', 63.8 * GB, 1]] }),
              ]),
              f('log', 184 * MB, 212, 6),
            ]),
            p('Packages', [
              p('CanonicalGroupLimited.Ubuntu24.04LTS_79rhkp1fndgsc', [
                p('LocalState', [], { soltos: [['ext4.vhdx', 17.2 * GB, 3]] }),
              ]),
              f('Microsoft.WindowsStore_8wekyb3d8bbwe', 1.9 * GB, 4210, 388),
              f('Microsoft.Windows.Photos_8wekyb3d8bbwe', 1.4 * GB, 2811, 146),
            ]),
            f('npm-cache', 9.4 * GB, 184233, 12410, { pesadas: [['_cacache\\index-v5\\3f', 212 * MB, 1874]] }),
            p('Google', [
              f('Chrome', 6.8 * GB, 41288, 3107, { pesadas: [['User Data\\Default\\Cache\\Cache_Data', 1.9 * GB, 18402]] }),
            ]),
            p('Microsoft', [
              f('Edge', 2.1 * GB, 15230, 1466),
              f('WindowsApps', 96 * MB, 64, 22),
            ]),
            p('Temp', [
              f('chrome_BITS_18244_1733562151', 412 * MB, 3, 1),
            ], {
              soltos: [['vs_installer_opt_out.log', 18 * MB, 90], ['MicrosoftEdgeUpdate.log', 6 * MB, 2]],
              resto: [3.9 * GB, 12480],
            }),
            f('Programs', 3.6 * GB, 38114, 4029),
          ]),
          f('Roaming', 7.9 * GB, 52310, 6120),
          f('LocalLow', 640 * MB, 1310, 210),
        ]),
        p('Downloads', [], {
          soltos: [
            ['Fotos-Casamento-2024.zip', 7.8 * GB, 301],
            ['ubuntu-24.04.2-desktop-amd64.iso', 5.91 * GB, 62],
            ['Win11_24H2_BrazilianPortuguese_x64.iso', 5.43 * GB, 118],
            ['DaVinci_Resolve_19.1_Windows.zip', 3.2 * GB, 41],
            ['Docker Desktop Installer.exe', 612 * MB, 33],
            ['VSCodeUserSetup-x64-1.96.2.exe', 98 * MB, 20],
          ],
          resto: [2.9 * GB, 214],
        }),
        p('Videos', [
          f('Captures', 5.4 * GB, 212, 3),
        ], {
          soltos: [['Viagem Chapada 2025.mp4', 11.6 * GB, 84], ['aula-gravada-03.mkv', 3.1 * GB, 12]],
          resto: [1.9 * GB, 41],
        }),
        f('projetos', 14.2 * GB, 312480, 41066),
        f('Pictures', 12.4 * GB, 9812, 214),
        f('Documents', 9.6 * GB, 23114, 1804),
        f('OneDrive', 4.4 * GB, 6210, 540),
        p('Desktop', [], { resto: [1.2 * GB, 86] }),
      ]),
      f('Public', 210 * MB, 96, 31),
      f('Default', 12 * MB, 41, 58),
    ]),
    p('Program Files (x86)', [
      p('Steam', [
        p('steamapps', [
          p('common', [
            f('Cyberpunk 2077', 58.2 * GB, 1204, 212, {
              grandes: [
                ['archive\\pc\\content\\basegame_4_gamedata.archive', 8.9 * GB, 140],
                ['archive\\pc\\content\\basegame_3_nightcity.archive', 7.6 * GB, 140],
                ['archive\\pc\\ep1\\ep1_1_nightcity.archive', 5.2 * GB, 140],
              ],
              pesadas: [['archive\\pc\\content', 41.3 * GB, 38], ['archive\\pc\\ep1', 9.8 * GB, 11]],
            }),
            f('Hades II', 6.1 * GB, 3120, 88),
            f('Stardew Valley', 640 * MB, 2211, 190),
          ]),
          f('shadercache', 1.9 * GB, 812, 64),
        ]),
        f('bin', 610 * MB, 402, 31),
      ], { resto: [290 * MB, 64] }),
      f('Microsoft', 820 * MB, 610, 88),
      f('Common Files', 410 * MB, 1210, 160),
    ]),
    p('Program Files', [
      f('Microsoft Visual Studio', 12.6 * GB, 88210, 9120),
      f('Adobe', 6.3 * GB, 14880, 1310),
      f('Microsoft Office', 4.1 * GB, 9840, 1122),
      f('JetBrains', 3.8 * GB, 21310, 2880),
      f('Docker', 3.2 * GB, 1540, 210),
      f('NVIDIA Corporation', 2.4 * GB, 3101, 402),
      f('Common Files', 1.8 * GB, 6010, 820),
      trancada('WindowsApps', 'EACCES'),
    ]),
    p('Windows', [
      f('WinSxS', 11.2 * GB, 94312, 18204),
      f('System32', 7.8 * GB, 21340, 2310),
      f('Installer', 5.2 * GB, 1622, 410, { pesadas: [['$PatchCache$\\Managed\\00004109D30000000000000000F01FEC', 1.1 * GB, 212]] }),
      p('SoftwareDistribution', [
        f('Download', 3.4 * GB, 4210, 388),
        f('DataStore', 510 * MB, 38, 6),
      ]),
      f('assembly', 1.4 * GB, 4120, 1860),
      f('SysWOW64', 1.6 * GB, 6010, 180),
      f('Microsoft.NET', 1.2 * GB, 3888, 610),
      f('Temp', 820 * MB, 610, 44),
      f('Fonts', 450 * MB, 1210, 0),
      trancada('Prefetch', 'EPERM'),
    ], { resto: [42 * MB, 38] }),
    p('ProgramData', [
      f('Package Cache', 6.2 * GB, 1840, 610),
      f('Microsoft', 3.1 * GB, 14210, 3302),
      f('NVIDIA Corporation', 1.2 * GB, 410, 66),
      f('chocolatey', 910 * MB, 2310, 402),
      f('Docker', 420 * MB, 210, 40),
    ]),
    p('$Recycle.Bin', [
      f('S-1-5-21-2814301559-3417711690-1780394231-1001', 2.3 * GB, 188, 12),
      trancada('S-1-5-18', 'EPERM'),
    ]),
    f('Intel', 31 * MB, 22, 4),
    p('PerfLogs'),
    trancada('System Volume Information', 'EPERM'),
    trancada('Recovery', 'EPERM'),
    trancada('Config.Msi', 'EPERM'),
  ], {
    soltos: [['pagefile.sys', 16 * GB, 0], ['hiberfil.sys', 12.7 * GB, 0], ['swapfile.sys', 256 * MB, 3]],
  });

  const raiz = 'C:\\';
  const maiores = [];
  const pesadas = [];
  const arquivosPorPasta = new Map();
  const semPermissao = [{ caminho: 'C:\\DumpStack.log.tmp', codigo: 'EBUSY' }];
  const totais = { pastas: 0, arquivos: 0, bytes: 0, links: 14, semPermissao: 0 };

  function construir(def, pai, caminho) {
    const no = {
      nome: def.nome, pai, tamanho: 0, tamanhoArquivos: 0, nArquivos: 0,
      nArquivosTotal: 0, nPastasTotal: 0, filhos: [], erro: def.erro || null,
    };
    if (no.erro) {
      semPermissao.push({ caminho, codigo: no.erro });
      return no;
    }
    totais.pastas++;
    const arquivos = (def.soltos || []).map(([nome, bytes, dias]) => ({
      caminho: path.join(caminho, nome), nome, pasta: caminho, tamanho: Math.round(bytes), modificado: agora - dias * DIA - 3600000 * 5,
    }));
    arquivosPorPasta.set(caminho.toLowerCase(), arquivos);
    maiores.push(...arquivos);
    const [restoBytes, restoN] = def.resto || [0, 0];
    no.tamanhoArquivos = arquivos.reduce((s, a) => s + a.tamanho, 0) + Math.round(restoBytes);
    no.nArquivos = arquivos.length + restoN;
    if (no.nArquivos) pesadas.push({ caminho, tamanho: no.tamanhoArquivos, nArquivos: no.nArquivos });
    no.tamanho = no.tamanhoArquivos;
    no.nArquivosTotal = no.nArquivos;
    if (def.fechada) {
      const [bytes, nArq, nPastas] = def.fechada;
      no.tamanho += Math.round(bytes);
      no.nArquivosTotal += nArq;
      no.nPastasTotal += nPastas;
      totais.pastas += nPastas;
      totais.arquivos += nArq;
      totais.bytes += Math.round(bytes);
    }
    for (const [rel, bytes, dias] of def.grandes || []) {
      const c = path.join(caminho, rel);
      maiores.push({ caminho: c, nome: path.basename(c), pasta: path.dirname(c), tamanho: Math.round(bytes), modificado: agora - dias * DIA });
    }
    for (const [rel, bytes, n] of def.pesadas || []) pesadas.push({ caminho: path.join(caminho, rel), tamanho: Math.round(bytes), nArquivos: n });
    totais.arquivos += no.nArquivos;
    totais.bytes += no.tamanhoArquivos;
    for (const filhoDef of def.filhos) {
      const filho = construir(filhoDef, no, path.join(caminho, filhoDef.nome));
      no.filhos.push(filho);
      no.tamanho += filho.tamanho;
      no.nArquivosTotal += filho.nArquivosTotal;
      no.nPastasTotal += 1 + filho.nPastasTotal;
    }
    return no;
  }

  const arvore = construir(definicao, null, raiz);
  arvore.nome = raiz;
  totais.semPermissao = semPermissao.length;
  const resultado = {
    raiz,
    arvore,
    totais,
    maioresArquivos: maiores.sort((a, b) => b.tamanho - a.tamanho).slice(0, 200),
    pastasMaisPesadas: pesadas.sort((a, b) => b.tamanho - a.tamanho).slice(0, 200),
    semPermissao,
    parou: false,
    duracaoMs: 133000,
  };
  const listarArquivosDe = (caminho, limite) => {
    const lista = arquivosPorPasta.get(String(caminho).toLowerCase());
    const no = varredura.encontrarNo(resultado, caminho);
    if (!lista || !no) return { caminho, erro: 'ENOENT', total: 0, tamanhoTotal: 0, arquivos: [] };
    const arquivos = [...lista].sort((a, b) => b.tamanho - a.tamanho).slice(0, limite);
    return { caminho, erro: null, total: no.nArquivos, tamanhoTotal: no.tamanhoArquivos, arquivos };
  };
  return { resultado, listarArquivosDe };
}

async function demo() {
  const { resultado, listarArquivosDe } = montarDemo();
  const saida = path.join(RAIZ_PROJETO, 'docs', 'capturas');
  fs.mkdirSync(saida, { recursive: true });
  const LARGURA = 1280;
  const ALTURA = 800;
  const discoC = { caminho: 'C:\\', total: 476 * GB, livre: 38.4 * GB };
  discoC.usado = discoC.total - discoC.livre;
  const discos = [
    discoC,
    { caminho: 'D:\\', total: 931.5 * GB, livre: 205.2 * GB, usado: (931.5 - 205.2) * GB },
    { caminho: 'E:\\', total: 58.5 * GB, livre: 41.6 * GB, usado: (58.5 - 41.6) * GB },
  ];
  let terminarVarredura = null;

  registrar({
    discos: () => discos,
    'escolher-pasta': () => null,
    // a varredura "anda" até o script mandar terminar
    varrer: (e) => new Promise((resolver) => {
      setTimeout(() => e.sender.send('progresso', {
        pastas: 48213, arquivos: 391877, bytes: 187.4 * GB, links: 9, semPermissao: 7,
        atual: 'C:\\Users\\Ana\\AppData\\Local\\Docker\\wsl\\disk',
      }), 100);
      terminarVarredura = () => resolver(varredura.resumo(resultado));
    }),
    parar: () => {},
    filhos: (_e, c) => varredura.listarFilhos(resultado, c),
    'arquivos-de': (_e, c, limite) => listarArquivosDe(c, limite),
    'maiores-arquivos': () => resultado.maioresArquivos,
    'pastas-mais-pesadas': () => resultado.pastasMaisPesadas,
    'sem-permissao': () => resultado.semPermissao,
    abrir: () => '',
  });

  const entrar = async (nome) => {
    await clicar(`#lista-pastas .linha[data-caminho$=${q('\\' + nome)}]`);
    await esperar(`document.querySelector('#trilha .trilha-item.atual')?.textContent === ${q(nome)}`, 'entrar em ' + nome);
  };

  nativeTheme.themeSource = 'light';
  janela = criarJanela(LARGURA, ALTURA);
  await abrirPagina(janela, LARGURA, ALTURA);
  await esperar('document.querySelectorAll(".cartao-disco").length === 3', 'cartões dos discos');
  await capturar(saida, 'inicio-claro.png', LARGURA);
  await tema('dark');
  await capturar(saida, 'inicio-escuro.png', LARGURA);
  await tema('light');

  await clicar('.cartao-disco .btn-varrer-disco');
  await esperar('document.getElementById("p-pastas").textContent === "48.213"', 'progresso da demo');
  // o clique do script deixa o foco (e o contorno) no Parar; quem usa o mouse não vê isso
  await js('document.activeElement && document.activeElement.blur()');
  await pausa(500); // o arco termina de andar
  await capturar(saida, 'varrendo-claro.png', LARGURA);
  await tema('dark');
  await capturar(saida, 'varrendo-escuro.png', LARGURA);
  await tema('light');

  terminarVarredura();
  await esperar('document.querySelectorAll("#lista-pastas .linha").length > 5', 'resultado da demo');
  await capturar(saida, 'pastas-claro.png', LARGURA);

  // arquivos soltos da raiz: hiberfil.sys e pagefile.sys
  await clicar('#lista-pastas .linha.arquivos-soltos');
  await esperar('document.querySelectorAll(".arquivos-lista .linha").length === 3', 'arquivos soltos da raiz');
  await js('document.querySelector(".linha.arquivos-soltos").scrollIntoView({ block: "center" })');
  await capturar(saida, 'arquivos-soltos-claro.png', LARGURA);

  for (const nome of ['Users', 'Ana', 'AppData', 'Local']) await entrar(nome);
  await js('document.getElementById("tela-resultado").scrollTop = 0');
  await tema('dark');
  await capturar(saida, 'pastas-escuro.png', LARGURA);
  await tema('light');

  await clicar('#aba-btn-arquivos');
  await esperar('document.querySelector("#lista-arquivos .linha")', 'maiores arquivos da demo');
  await capturar(saida, 'maiores-arquivos-claro.png', LARGURA);

  await clicar('#aba-btn-pesadas');
  await esperar('document.querySelector("#lista-pesadas .linha")', 'pesadas da demo');
  await tema('dark');
  await capturar(saida, 'pesadas-escuro.png', LARGURA);
  await tema('light');

  await clicar('#aba-btn-erros');
  await esperar('document.querySelector("#lista-erros .linha")', 'sem permissão da demo');
  await capturar(saida, 'sem-permissao-claro.png', LARGURA);

  assert.deepEqual(errosDaPagina, [], 'sem erro no console (CSP inclusa)');
  process.stdout.write('Capturas da demo em ' + saida + '\n');
}

// ---------- execução ----------

function limparDados() {
  try {
    fs.rmSync(pastaDados, { recursive: true, force: true });
  } catch {
    // o Chromium às vezes ainda segura algum arquivo; é pasta temporária
  }
}

// não deixa o teste pendurado se algo travar
const vigia = setTimeout(() => {
  process.stderr.write('FALHOU: tempo total esgotado\n');
  app.exit(1);
}, 180000);

app.on('window-all-closed', () => {
  // quem encerra é o próprio teste
});

app.whenReady()
  .then(() => (MODO_DEMO ? demo() : fumaca()))
  .then(() => {
    clearTimeout(vigia);
    if (!MODO_DEMO) process.stdout.write('Fumaça OK\n');
    limparDados();
    app.exit(0);
  })
  .catch((e) => {
    clearTimeout(vigia);
    process.stderr.write('FALHOU: ' + (e && e.stack ? e.stack : e) + '\n');
    if (errosDaPagina.length) process.stderr.write('Erros no console da página:\n  ' + errosDaPagina.join('\n  ') + '\n');
    limparDados();
    app.exit(1);
  });
