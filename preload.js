'use strict';
// Ponte entre a interface (sem Node) e o processo principal. Só passam
// funções nomeadas com argumentos simples. Nada de ipcRenderer solto na página.

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('cade', {
  discos: () => ipcRenderer.invoke('discos'),
  escolherPasta: () => ipcRenderer.invoke('escolher-pasta'),
  varrer: (raiz) => ipcRenderer.invoke('varrer', raiz),
  parar: () => ipcRenderer.invoke('parar'),
  filhos: (caminho) => ipcRenderer.invoke('filhos', caminho),
  arquivosDe: (caminho, limite) => ipcRenderer.invoke('arquivos-de', caminho, limite),
  maioresArquivos: () => ipcRenderer.invoke('maiores-arquivos'),
  pastasMaisPesadas: () => ipcRenderer.invoke('pastas-mais-pesadas'),
  semPermissao: () => ipcRenderer.invoke('sem-permissao'),
  abrir: (caminho, ehArquivo) => ipcRenderer.invoke('abrir', caminho, !!ehArquivo),
  aoProgresso: (fn) => {
    ipcRenderer.on('progresso', (_evento, dados) => fn(dados));
  },
});
