'use strict';
// Lado do processo principal: sobe a worker thread, manda pedidos numerados e
// casa cada resposta com a promessa certa. Progresso chega fora de ordem e vai
// pra `aoProgresso`.

const { Worker } = require('node:worker_threads');
const path = require('node:path');

class Motor {
  constructor() {
    this.worker = null;
    this.flag = null;
    this.pendentes = new Map();
    this.seq = 0;
    this.aoProgresso = null;
  }

  _garantirWorker() {
    if (this.worker) return;
    const compartilhado = new SharedArrayBuffer(4);
    this.flag = new Int32Array(compartilhado);
    this.worker = new Worker(path.join(__dirname, 'worker.js'), { workerData: { flag: compartilhado } });
    this.worker.on('message', (m) => {
      if (m.tipo === 'progresso') {
        if (this.aoProgresso) this.aoProgresso(m.dados);
        return;
      }
      const p = this.pendentes.get(m.id);
      if (!p) return;
      this.pendentes.delete(m.id);
      if (m.erro) p.rejeitar(new Error(m.erro));
      else p.resolver(m.dados);
    });
    this.worker.on('error', (e) => {
      for (const p of this.pendentes.values()) p.rejeitar(e);
      this.pendentes.clear();
      this.worker = null;
    });
    this.worker.on('exit', () => {
      this.worker = null;
    });
  }

  pedir(tipo, dados) {
    this._garantirWorker();
    const id = ++this.seq;
    return new Promise((resolver, rejeitar) => {
      this.pendentes.set(id, { resolver, rejeitar });
      this.worker.postMessage({ id, tipo, dados });
    });
  }

  varrer(raiz) {
    this._garantirWorker();
    Atomics.store(this.flag, 0, 0);
    return this.pedir('varrer', { raiz });
  }

  parar() {
    if (this.flag) Atomics.store(this.flag, 0, 1);
  }

  filhos(caminho) {
    return this.pedir('filhos', { caminho });
  }

  arquivosDe(caminho, limite) {
    return this.pedir('arquivosDe', { caminho, limite });
  }

  maioresArquivos() {
    return this.pedir('maioresArquivos');
  }

  pastasMaisPesadas() {
    return this.pedir('pastasMaisPesadas');
  }

  semPermissao() {
    return this.pedir('semPermissao');
  }

  async encerrar() {
    if (!this.worker) return;
    const w = this.worker;
    this.worker = null;
    await w.terminate();
  }
}

module.exports = { Motor };
