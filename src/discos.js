'use strict';
// Lista os discos com total e livre. Sem dependência: usa fs.statfsSync, que
// no Windows vai por GetDiskFreeSpaceW. No Windows tenta todas as letras de
// A: a Z:. Letra sem disco (ou leitor vazio) dá erro e é pulada.
// Documentação: https://nodejs.org/api/fs.html#fsstatfssyncpath-options

const fs = require('node:fs');
const os = require('node:os');

function candidatos() {
  if (process.platform === 'win32') {
    const letras = [];
    for (let c = 65; c <= 90; c++) letras.push(String.fromCharCode(c) + ':\\');
    return letras;
  }
  const lista = ['/'];
  const casa = os.homedir();
  if (casa && casa !== '/') lista.push(casa);
  return lista;
}

function medir(caminho) {
  const s = fs.statfsSync(caminho);
  const total = Number(s.blocks) * Number(s.bsize);
  const livre = Number(s.bavail) * Number(s.bsize);
  if (!(total > 0)) return null;
  return { caminho, total, livre, usado: total - livre };
}

function listarDiscos() {
  const discos = [];
  for (const c of candidatos()) {
    try {
      const d = medir(c);
      if (!d) continue;
      // fora do Windows, a pasta do usuário costuma estar no mesmo disco da
      // raiz: mesmo total e mesmo livre é o mesmo disco, não repete
      if (discos.some((x) => x.total === d.total && x.livre === d.livre)) continue;
      discos.push(d);
    } catch {
      // letra sem disco, mídia ausente, sem permissão: segue pra próxima
    }
  }
  return discos;
}

module.exports = { listarDiscos, medir };
