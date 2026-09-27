'use strict';
// Confere o app empacotado de verdade (dist/win-unpacked), não o código-fonte.
// Abre o .exe com a porta de depuração do Chromium ligada e, pelo protocolo do
// DevTools, chama a ponte window.cade como a interface chamaria: lista os
// discos, varre uma pasta com tamanhos conhecidos e navega nela. Isso prova
// que o pacote abre, que a worker thread sobe de dentro do app.asar e que o
// preload está de pé. No fim tira uma captura (dist/verificacao.png).
//
// Uso: npm run empacotar && npm run verificar-pacote
//      node scripts/verificar-pacote.js [executável] [argumentos...]
// Se o Windows barrar o .exe sem assinatura (Controle Inteligente de
// Aplicativos), dá pra conferir o mesmo app.asar com o Electron do projeto:
//   node scripts/verificar-pacote.js node_modules/electron/dist/electron.exe dist/win-unpacked/resources/app.asar
// Sem dependência: Node 24 já tem fetch e WebSocket globais.

const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');

const RAIZ = path.join(__dirname, '..');
const pacote = require(path.join(RAIZ, 'package.json'));
const EXE = path.resolve(process.argv[2] || path.join(RAIZ, 'dist', 'win-unpacked', `${pacote.build.executableName}.exe`));
const ARGUMENTOS = process.argv.slice(3).map((a) => (fs.existsSync(a) ? path.resolve(a) : a));
const CAPTURA = path.join(RAIZ, 'dist', 'verificacao.png');

// Pasta de teste: nome com acento de propósito, pra passar pela ponte IPC.
const ARQUIVOS = {
  'solto.bin': 1000,
  'grande/a.bin': 4000,
  'grande/fundo/b.bin': 3000,
  'pequena/c.bin': 500,
};
const TOTAL = 8500;

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

function conferir(condicao, mensagem) {
  if (!condicao) throw new Error(mensagem);
  console.log(`  ok  ${mensagem}`);
}

function portaLivre() {
  return new Promise((ok, falha) => {
    const s = net.createServer();
    s.once('error', falha);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => ok(port));
    });
  });
}

function montarPasta() {
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'cade-verificação-'));
  for (const [rel, tamanho] of Object.entries(ARQUIVOS)) {
    const c = path.join(raiz, rel);
    fs.mkdirSync(path.dirname(c), { recursive: true });
    fs.writeFileSync(c, Buffer.alloc(tamanho, 1));
  }
  return raiz;
}

function apagar(pasta) {
  try {
    fs.rmSync(pasta, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
  } catch (e) {
    console.warn(`  aviso: não deu pra apagar ${pasta} (${e.code || e.message})`);
  }
}

// Espera o app abrir a página da interface e devolve o endereço de depuração dela.
async function acharPagina(porta, prazoMs) {
  const limite = Date.now() + prazoMs;
  while (Date.now() < limite) {
    try {
      const alvos = await (await fetch(`http://127.0.0.1:${porta}/json/list`)).json();
      const pagina = alvos.find((a) => a.type === 'page' && /ui\/index\.html$/.test(a.url));
      if (pagina) return pagina.webSocketDebuggerUrl;
    } catch {
      // o app ainda está subindo
    }
    await esperar(250);
  }
  throw new Error(`a janela não abriu em ${prazoMs / 1000} s`);
}

// Cliente mínimo do protocolo do DevTools: manda comando numerado, casa a
// resposta pelo id e guarda os eventos que interessam.
class Depurador {
  constructor(url) {
    this.url = url;
    this.seq = 0;
    this.pendentes = new Map();
    this.ouvintes = new Map();
  }

  conectar() {
    return new Promise((ok, falha) => {
      this.ws = new WebSocket(this.url);
      this.ws.onopen = () => ok();
      this.ws.onerror = () => falha(new Error(`não conectou em ${this.url}`));
      this.ws.onmessage = (ev) => {
        const m = JSON.parse(ev.data);
        if (m.id && this.pendentes.has(m.id)) {
          const p = this.pendentes.get(m.id);
          this.pendentes.delete(m.id);
          if (m.error) p.falha(new Error(`${p.metodo}: ${m.error.message}`));
          else p.ok(m.result);
        } else if (m.method && this.ouvintes.has(m.method)) {
          for (const fn of this.ouvintes.get(m.method)) fn(m.params);
        }
      };
    });
  }

  enviar(metodo, params = {}, prazoMs = 30000) {
    const id = ++this.seq;
    return new Promise((ok, falha) => {
      const t = setTimeout(() => {
        this.pendentes.delete(id);
        falha(new Error(`${metodo}: sem resposta em ${prazoMs / 1000} s`));
      }, prazoMs);
      this.pendentes.set(id, {
        metodo,
        ok: (r) => (clearTimeout(t), ok(r)),
        falha: (e) => (clearTimeout(t), falha(e)),
      });
      this.ws.send(JSON.stringify({ id, method: metodo, params }));
    });
  }

  ao(evento, fn) {
    if (!this.ouvintes.has(evento)) this.ouvintes.set(evento, []);
    this.ouvintes.get(evento).push(fn);
  }

  // Roda uma expressão na página (mesmo mundo da interface) e devolve o valor.
  async avaliar(expressao) {
    const r = await this.enviar('Runtime.evaluate', { expression: expressao, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) {
      const d = r.exceptionDetails;
      throw new Error(`na página: ${(d.exception && d.exception.description) || d.text}`);
    }
    return r.result.value;
  }

  fechar() {
    try {
      this.ws.close();
    } catch {
      // já fechado
    }
  }
}

// A janela nasce escondida (show: false) e o main.js mostra quando a página
// carrega. Pelo DevTools a página parece visível mesmo com a janela escondida,
// então pergunta ao Windows: MainWindowHandle só vem diferente de 0 quando o
// processo tem uma janela visível.
async function janelaVisivel(pid, prazoMs) {
  const limite = Date.now() + prazoMs;
  while (Date.now() < limite) {
    const r = spawnSync('powershell', ['-NoProfile', '-Command', `(Get-Process -Id ${pid}).MainWindowHandle`], {
      encoding: 'utf8',
    });
    if (Number(String(r.stdout).trim()) > 0) return true;
    await esperar(500);
  }
  return false;
}

async function fecharApp(filho, porta) {
  if (filho.exitCode !== null) return;
  const saiu = new Promise((ok) => filho.once('exit', ok));
  try {
    const { webSocketDebuggerUrl } = await (await fetch(`http://127.0.0.1:${porta}/json/version`)).json();
    const navegador = new Depurador(webSocketDebuggerUrl);
    await navegador.conectar();
    navegador.enviar('Browser.close').catch(() => {});
    await Promise.race([saiu, esperar(5000)]);
    navegador.fechar();
  } catch {
    // se o Browser.close não der, mata abaixo
  }
  if (filho.exitCode === null) {
    // /T leva junto os processos filhos do Chromium (GPU, renderização)
    spawnSync('taskkill', ['/pid', String(filho.pid), '/T', '/F'], { stdio: 'ignore' });
    await Promise.race([saiu, esperar(3000)]);
  }
}

async function verificar() {
  if (!fs.existsSync(EXE)) throw new Error(`não achei ${EXE}. Rode antes: npm run empacotar`);
  console.log(`Abrindo ${[EXE, ...ARGUMENTOS].map((c) => path.relative(RAIZ, c) || c).join(' ')}`);

  const porta = await portaLivre();
  // Pasta de dados à parte: não mexe na do usuário e não esbarra na trava de
  // instância única se o app instalado estiver aberto.
  const dados = fs.mkdtempSync(path.join(os.tmpdir(), 'cade-verificacao-dados-'));
  const pasta = montarPasta();
  let saidaErro = '';
  let filho;
  try {
    filho = spawn(EXE, [...ARGUMENTOS, `--remote-debugging-port=${porta}`, `--user-data-dir=${dados}`], {
      stdio: ['ignore', 'ignore', 'pipe'],
    });
  } catch (e) {
    apagar(pasta);
    apagar(dados);
    // O Windows recusou abrir o .exe antes de ele rodar. Num .exe sem
    // assinatura digital, quase sempre é o Controle Inteligente de Aplicativos
    // (Smart App Control) ou o antivírus: ver Segurança do Windows.
    if (e.code === 'UNKNOWN' || e.code === 'EACCES' || e.code === 'EPERM') {
      throw new Error(
        `o Windows bloqueou ${path.basename(EXE)} (${e.code}). Sem assinatura digital, o ` +
          'Controle Inteligente de Aplicativos ou o antivírus pode barrar o .exe ' +
          '(Visualizador de Eventos, Microsoft-Windows-CodeIntegrity/Operational). Pra conferir ' +
          'o mesmo app.asar: node scripts/verificar-pacote.js node_modules/electron/dist/electron.exe ' +
          'dist/win-unpacked/resources/app.asar'
      );
    }
    throw e;
  }
  filho.stderr.on('data', (b) => {
    saidaErro = (saidaErro + b).slice(-4000);
  });
  const antesDoFim = new Promise((_ok, falha) => {
    filho.once('exit', (codigo) => falha(new Error(`o app fechou sozinho (código ${codigo})\n${saidaErro}`)));
    filho.once('error', falha);
  });
  antesDoFim.catch(() => {});

  let dep = null;
  try {
    const url = await Promise.race([acharPagina(porta, 30000), antesDoFim]);
    console.log('Janela');
    // Antes do reload abaixo: recarregar a página já faria a janela aparecer.
    conferir(await janelaVisivel(filho.pid, 10000), 'janela visível na tela');
    dep = new Depurador(url);
    await dep.conectar();

    // Recarrega com o console ligado pra pegar qualquer erro desde o começo
    // (script quebrado, bloqueio da CSP). O Runtime.enable ainda repete os
    // erros da primeira carga, por isso o Set: cada erro aparece uma vez.
    const erros = new Set();
    dep.ao('Runtime.exceptionThrown', (p) => {
      const d = p.exceptionDetails;
      erros.add((d.exception && d.exception.description) || d.text);
    });
    dep.ao('Runtime.consoleAPICalled', (p) => {
      if (p.type === 'error') erros.add(p.args.map((a) => a.value ?? a.description).join(' '));
    });
    dep.ao('Log.entryAdded', (p) => {
      if (p.entry.level === 'error') erros.add(`${p.entry.source}: ${p.entry.text}`);
    });
    await dep.enviar('Runtime.enable');
    await dep.enviar('Log.enable');
    await dep.enviar('Page.enable');
    const carregou = new Promise((ok) => dep.ao('Page.loadEventFired', ok));
    await dep.enviar('Page.reload', { ignoreCache: true });
    await Promise.race([carregou, esperar(15000)]);

    for (let i = 0; i < 40; i++) {
      if (await dep.avaliar(`document.readyState === 'complete' && typeof window.cade === 'object'`)) break;
      await esperar(250);
    }

    const janela = await dep.avaliar(`(() => {
      const w = navigator.windowControlsOverlay;
      const r = w && w.visible ? w.getTitlebarAreaRect() : null;
      return {
        titulo: document.title,
        largura: innerWidth,
        altura: innerHeight,
        escuro: matchMedia('(prefers-color-scheme: dark)').matches,
        barra: r && { largura: r.width, altura: r.height },
        funcoes: Object.keys(window.cade || {}),
      };
    })()`);
    conferir(janela.funcoes.includes('varrer'), `ponte window.cade de pé (${janela.funcoes.length} funções)`);
    conferir(
      janela.barra && janela.barra.altura === 40,
      `barra de título do Windows por cima da página, 40 px (área livre ${janela.barra && janela.barra.largura} de ${janela.largura} px)`
    );
    console.log(`      página ${janela.largura}x${janela.altura}, tema ${janela.escuro ? 'escuro' : 'claro'}, título "${janela.titulo}"`);

    console.log('Discos');
    const discos = await dep.avaliar('window.cade.discos()');
    conferir(Array.isArray(discos) && discos.length > 0, `${discos.length} disco(s): ${discos.map((d) => d.caminho).join(' ')}`);
    conferir(discos.every((d) => d.total > 0 && d.livre >= 0), 'cada disco tem total e livre');

    console.log('Varredura (worker thread de dentro do pacote)');
    const resumo = await dep.avaliar(`window.cade.varrer(${JSON.stringify(pasta)})`);
    conferir(resumo.totais.bytes === TOTAL, `somou ${resumo.totais.bytes} bytes (esperado ${TOTAL})`);
    conferir(resumo.totais.arquivos === 4, `contou ${resumo.totais.arquivos} arquivos (esperado 4)`);
    conferir(resumo.totais.pastas === 4, `contou ${resumo.totais.pastas} pastas (esperado 4, com a raiz)`);
    conferir(resumo.parou === false && resumo.nSemPermissao === 0, 'terminou inteira, sem erro de permissão');

    console.log('Navegação');
    const raiz = await dep.avaliar(`window.cade.filhos(${JSON.stringify(resumo.raiz)})`);
    conferir(raiz && raiz.tamanho === TOTAL, `pasta raiz com ${raiz && raiz.tamanho} bytes`);
    conferir(raiz.tamanhoArquivos === 1000, `arquivos soltos na raiz: ${raiz.tamanhoArquivos} bytes`);
    const nomes = raiz.filhos.map((f) => `${f.nome}=${f.tamanho}`).join(', ');
    conferir(nomes === 'grande=7000, pequena=500', `subpastas da maior pra menor: ${nomes}`);

    // Captura antes de julgar o console: se tiver erro, a imagem ajuda a ver.
    // Um respiro pra interface terminar de desenhar.
    await esperar(800);
    const { data } = await dep.enviar('Page.captureScreenshot', { format: 'png' });
    fs.mkdirSync(path.dirname(CAPTURA), { recursive: true });
    fs.writeFileSync(CAPTURA, Buffer.from(data, 'base64'));
    console.log(`Captura: ${path.relative(RAIZ, CAPTURA)}`);

    console.log('Console da página');
    conferir(erros.size === 0, erros.size ? `erros no console:\n${[...erros].join('\n')}` : 'sem erro no console');
  } finally {
    if (dep) dep.fechar();
    await fecharApp(filho, porta);
    apagar(pasta);
    apagar(dados);
  }
}

verificar()
  .then(() => {
    console.log('Pacote conferido: tudo certo.');
    process.exit(0);
  })
  .catch((e) => {
    console.error(`\nFALHOU: ${e.message}`);
    process.exit(1);
  });
