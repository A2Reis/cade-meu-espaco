'use strict';
// Roda dentro de uma worker thread. Faz a varredura (síncrona, pesada) sem
// travar a janela, guarda a árvore na memória desta thread e responde
// perguntas sobre ela. O processo principal só recebe resumos pequenos.
//
// Parar: o principal escreve 1 num Int32Array compartilhado (workerData.flag)
// e a varredura confere a cada pasta. Assim dá pra interromper um laço
// síncrono sem matar a thread, e o que já foi varrido continua navegável.

const { parentPort, workerData } = require('node:worker_threads');
const varredura = require('./varredura');

const flag = new Int32Array(workerData.flag);
let resultado = null;

function atender(tipo, dados) {
  switch (tipo) {
    case 'varrer':
      resultado = varredura.varrer(dados.raiz, {
        deveParar: () => Atomics.load(flag, 0) === 1,
        aoProgresso: (p) => parentPort.postMessage({ tipo: 'progresso', dados: p }),
      });
      return varredura.resumo(resultado);
    case 'filhos':
      return resultado ? varredura.listarFilhos(resultado, dados.caminho) : null;
    case 'arquivosDe':
      return varredura.listarArquivosDe(dados.caminho, dados.limite);
    case 'maioresArquivos':
      return resultado ? resultado.maioresArquivos : [];
    case 'pastasMaisPesadas':
      return resultado ? resultado.pastasMaisPesadas : [];
    case 'semPermissao':
      return resultado ? resultado.semPermissao : [];
    default:
      throw new Error('pedido desconhecido: ' + tipo);
  }
}

parentPort.on('message', ({ id, tipo, dados }) => {
  try {
    parentPort.postMessage({ id, dados: atender(tipo, dados || {}) });
  } catch (e) {
    parentPort.postMessage({ id, erro: e && e.message ? e.message : String(e) });
  }
});
