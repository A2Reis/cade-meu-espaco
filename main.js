'use strict';
// Processo principal do Electron. Abre a janela, cria o motor (worker thread
// que varre o disco) e expõe pra interface só o que ela precisa, via IPC.
// A interface roda isolada (contextIsolation + sandbox) e não tem Node.
//
// Este programa só lê. A única ação fora da leitura é abrir a pasta ou o
// arquivo no Explorer, e mesmo isso passa pelo shell do Electron.

const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron');
const path = require('node:path');
const { Motor } = require('./src/motor');
const { listarDiscos } = require('./src/discos');

const motor = new Motor();
let janela = null;

function exigirTexto(valor) {
  if (typeof valor !== 'string' || !valor.trim()) throw new Error('caminho inválido');
  return valor;
}

function criarJanela() {
  janela = new BrowserWindow({
    width: 1100,
    height: 720,
    minWidth: 820,
    minHeight: 520,
    title: 'Cadê meu espaço?',
    backgroundColor: '#f4f4f2',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  janela.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  janela.loadFile(path.join(__dirname, 'ui', 'index.html'));
  janela.on('closed', () => {
    janela = null;
  });
}

motor.aoProgresso = (p) => {
  if (janela && !janela.isDestroyed()) janela.webContents.send('progresso', p);
};

app.whenReady().then(() => {
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
});

app.on('window-all-closed', () => {
  motor.encerrar();
  if (process.platform !== 'darwin') app.quit();
});
