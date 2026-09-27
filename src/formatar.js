// Formatação de números do jeito brasileiro, sem depender de ICU.
// Funciona como módulo CommonJS (Node) e como script solto no navegador
// (vira window.formatar), porque a interface do Electron não tem require.
(function (raiz, fabrica) {
  if (typeof module === 'object' && module.exports) module.exports = fabrica();
  else raiz.formatar = fabrica();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const UNIDADES = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];

  // 1234567 vira "1.234.567".
  function formatarNumero(n) {
    if (!Number.isFinite(n)) return '0';
    return String(Math.trunc(Math.abs(n))).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  }

  // Base 1024, igual ao Explorer do Windows. 1536 vira "1,50 KB".
  // Casas decimais: 2 até 9,99, 1 até 99,9, nenhuma daí pra cima.
  function formatarBytes(bytes) {
    if (!Number.isFinite(bytes) || bytes < 0) return '0 B';
    let valor = bytes;
    let i = 0;
    while (valor >= 1024 && i < UNIDADES.length - 1) {
      valor /= 1024;
      i++;
    }
    let casas = 0;
    if (i > 0) casas = valor < 10 ? 2 : valor < 100 ? 1 : 0;
    const texto = valor.toFixed(casas).replace('.', ',');
    return texto + ' ' + UNIDADES[i];
  }

  // Fração de um total em porcentagem: 0,5 vira "50%", 0,0123 vira "1,2%".
  function formatarPorcentagem(parte, total) {
    if (!total || !Number.isFinite(parte) || parte <= 0) return '0%';
    const p = (parte / total) * 100;
    if (p >= 99.95) return '100%';
    const texto = p >= 10 ? p.toFixed(0) : p.toFixed(1);
    return texto.replace('.', ',') + '%';
  }

  // 133000 ms vira "2 min 13 s".
  function formatarDuracao(ms) {
    if (!Number.isFinite(ms) || ms < 0) return '0 s';
    const s = Math.round(ms / 1000);
    if (s < 60) return s + ' s';
    const min = Math.floor(s / 60);
    const resto = s % 60;
    if (min < 60) return resto ? min + ' min ' + resto + ' s' : min + ' min';
    const h = Math.floor(min / 60);
    const minResto = min % 60;
    return minResto ? h + ' h ' + minResto + ' min' : h + ' h';
  }

  // Data e hora em pt-BR: "20/09/2026 14:05".
  function formatarData(ms) {
    if (!Number.isFinite(ms)) return '';
    const d = new Date(ms);
    const dois = (n) => String(n).padStart(2, '0');
    return dois(d.getDate()) + '/' + dois(d.getMonth() + 1) + '/' + d.getFullYear() +
      ' ' + dois(d.getHours()) + ':' + dois(d.getMinutes());
  }

  // plural(1, 'arquivo') vira "1 arquivo", plural(2, 'arquivo') vira "2 arquivos".
  // Passe o plural quando não for só acrescentar "s".
  function plural(n, singular, pluralForma) {
    const p = pluralForma || singular + 's';
    return formatarNumero(n) + ' ' + (Math.abs(n) === 1 ? singular : p);
  }

  return { formatarNumero, formatarBytes, formatarPorcentagem, formatarDuracao, formatarData, plural };
});
