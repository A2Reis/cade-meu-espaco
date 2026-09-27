'use strict';
// Processo principal do Electron. Abre a janela, cria o motor (worker thread
// que varre o disco) e expõe pra interface só o que ela precisa, via IPC.
// A interface roda isolada (contextIsolation + sandbox) e não tem Node.
//
// Este programa só lê. A única ação fora da leitura é abrir a pasta ou o
// arquivo no Explorer, e mesmo isso passa pelo shell do Electron.

const { app, BrowserWindow, ipcMain, shell, dialog, nativeTheme } = require('electron');
const path = require('node:path');
const { Motor } = require('./src/motor');
const { listarDiscos } = require('./src/discos');

// Mesmo appId do package.json (build.appId): o Windows usa isso pra agrupar
// a janela com o atalho do menu Iniciar na barra de tarefas.
const APP_ID = 'br.com.a2reis.cademeuespaco';

// Cores da barra de título. Têm que ser as mesmas do --fundo da interface,
// senão aparece uma emenda onde o Windows desenha minimizar/maximizar/fechar.
const TEMAS = {
  claro: { fundo: '#f3f4f8', simbolos: '#1f2330' },
  escuro: { fundo: '#16171d', simbolos: '#e6e7ee' },
};
const ALTURA_BARRA = 40;

const motor = new Motor();
let janela = null;

function exigirTexto(valor) {
  if (typeof valor !== 'string' || !valor.trim()) throw new Error('caminho inválido');
  return valor;
}

function temaAtual() {
  return nativeTheme.shouldUseDarkColors ? TEMAS.escuro : TEMAS.claro;
}

// Ícone da janela e da barra de tarefas. O .exe empacotado é o do Electron
// sem edição (package.json, win.signAndEditExecutable: false), pra não perder
// a reputação que o Controle Inteligente de Aplicativos do Windows exige;
// então o ícone vem de fora dele: resources\icone.ico (build.extraResources).
function caminhoDoIcone() {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'icone.ico')
    : path.join(__dirname, 'build', 'icon.ico');
}

function barraDeTitulo() {
  const t = temaAtual();
  return { color: t.fundo, symbolColor: t.simbolos, height: ALTURA_BARRA };
}

function criarJanela() {
  janela = new BrowserWindow({
    width: 1100,
    height: 720,
    minWidth: 820,
    minHeight: 520,
    title: 'Cadê meu espaço?',
    icon: caminhoDoIcone(),
    // Some a barra do Windows; a página desenha a dela e o sistema desenha só
    // os três botões por cima, no canto direito.
    titleBarStyle: 'hidden',
    titleBarOverlay: barraDeTitulo(),
    backgroundColor: temaAtual().fundo,
    // Só aparece com a página carregada, sem piscar em branco.
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  janela.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  // Arrastar um arquivo pra janela faria a página sair do app. Não deixa.
  janela.webContents.on('will-navigate', (e) => e.preventDefault());
  // Com titleBarStyle 'hidden' + titleBarOverlay, o Electron 44 no Windows não
  // emite 'ready-to-show' pra janela escondida (testado). O 'did-finish-load'
  // fica de reserva; como o fundo da janela já é o da página, não pisca.
  let mostrada = false;
  const mostrar = () => {
    if (mostrada || !janela || janela.isDestroyed()) return;
    mostrada = true;
    janela.show();
  };
  janela.once('ready-to-show', mostrar);
  janela.webContents.once('did-finish-load', mostrar);
  janela.webContents.once('did-fail-load', mostrar);
  janela.loadFile(path.join(__dirname, 'ui', 'index.html'));
  janela.on('closed', () => {
    janela = null;
  });
}

// Tema do Windows mudou (claro/escuro): a página acompanha sozinha pelo CSS,
// aqui só troca as cores dos botões do sistema e do fundo da janela.
nativeTheme.on('updated', () => {
  if (!janela || janela.isDestroyed()) return;
  janela.setTitleBarOverlay(barraDeTitulo());
  janela.setBackgroundColor(temaAtual().fundo);
});

motor.aoProgresso = (p) => {
  if (janela && !janela.isDestroyed()) janela.webContents.send('progresso', p);
};

function iniciar() {
  ipcMain.handle('discos', () => listarDiscos());

  ipcMain.handle('escolher-pasta', async () => {
    const r = await dialog.showOpenDialog(janela, {
      title: 'Escolha a pasta pra varrer',
      properties: ['openDirectory'],
    });
    return r.canceled || !r.filePaths.length ? null : r.filePaths[0];
  });

  ipcMain.handle('varrer', (_e, raiz) => motor.varrer(exigirTexto(raiz)));
  ipcMain.handle('parar', () => motor.parar());
  ipcMain.handle('filhos', (_e, caminho) => motor.filhos(exigirTexto(caminho)));
  ipcMain.handle('arquivos-de', (_e, caminho, limite) => motor.arquivosDe(exigirTexto(caminho), limite));
  ipcMain.handle('maiores-arquivos', () => motor.maioresArquivos());
  ipcMain.handle('pastas-mais-pesadas', () => motor.pastasMaisPesadas());
  ipcMain.handle('sem-permissao', () => motor.semPermissao());

  // Abre no Explorer. Arquivo: abre a pasta dele com o arquivo selecionado.
  // Pasta: abre a pasta. Devolve '' se deu certo ou a mensagem de erro.
  ipcMain.handle('abrir', async (_e, caminho, ehArquivo) => {
    exigirTexto(caminho);
    if (ehArquivo) {
      shell.showItemInFolder(caminho);
      return '';
    }
    return shell.openPath(caminho);
  });

  criarJanela();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) criarJanela();
  });
}

// Uma janela só. Abrir de novo (pelo atalho, por exemplo) traz a que já está
// aberta pra frente em vez de subir outra varredura em paralelo.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  if (process.platform === 'win32') app.setAppUserModelId(APP_ID);

  app.on('second-instance', () => {
    if (!janela) return;
    if (janela.isMinimized()) janela.restore();
    janela.show();
    janela.focus();
  });

  app.whenReady().then(iniciar);

  app.on('window-all-closed', () => {
    motor.encerrar();
    if (process.platform !== 'darwin') app.quit();
  });
}
