#!/usr/bin/env node
'use strict';
// Versão de terminal, sem Electron e sem instalar nada. Serve pra quando o
// disco está tão cheio que nem dá pra baixar o Electron.
//
//   node cli.js                 lista os discos com espaço total e livre
//   node cli.js C:\             varre o disco e imprime os relatórios
//   node cli.js C:\Users\eu --top 30
//
// Opções:
//   --top N     quantas linhas em cada lista (padrão 20)
//   --sem-cor   desliga as cores do terminal

const path = require('node:path');
const { varrer, listarFilhos } = require('./src/varredura');
const { listarDiscos } = require('./src/discos');
const fmt = require('./src/formatar');

function lerArgs(argv) {
  const opcoes = { alvo: null, top: 20, cor: process.stderr.isTTY };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--top') opcoes.top = Math.max(1, parseInt(argv[++i], 10) || 20);
    else if (a === '--sem-cor') opcoes.cor = false;
    else if (a === '--ajuda' || a === '-h' || a === '--help') opcoes.ajuda = true;
    else if (!opcoes.alvo) opcoes.alvo = a;
  }
  return opcoes;
}

function ajuda() {
  process.stdout.write([
    'Cadê meu espaço? (terminal)',
    '',
    '  node cli.js                 lista os discos',
    '  node cli.js <disco ou pasta> [--top N] [--sem-cor]',
    '',
    'Exemplos:',
    '  node cli.js C:\\',
    '  node cli.js "C:\\Users\\augusto" --top 40',
    '',
  ].join('\n'));
}

function mostrarDiscos() {
  const discos = listarDiscos();
  if (!discos.length) {
    process.stdout.write('Nenhum disco encontrado.\n');
    return;
  }
  process.stdout.write('Discos:\n');
  for (const d of discos) {
    process.stdout.write(
      `  ${d.caminho.padEnd(6)} ${fmt.formatarBytes(d.usado).padStart(9)} usados de ${fmt.formatarBytes(d.total).padStart(9)}` +
      `   (${fmt.formatarBytes(d.livre)} livres, ${fmt.formatarPorcentagem(d.usado, d.total)} cheio)\n`
    );
  }
  process.stdout.write('\nPra varrer um: node cli.js ' + discos[0].caminho + '\n');
}

function titulo(texto, cor) {
  return (cor ? '\x1b[1m' : '') + texto + (cor ? '\x1b[0m' : '') + '\n';
}

function relatorio(r, opcoes) {
  const s = process.stdout;
  const cor = opcoes.cor && process.stdout.isTTY;
  const t = r.totais;

  s.write('\n');
  s.write(titulo(`${r.raiz}  ${fmt.formatarBytes(t.bytes)} em ${fmt.formatarNumero(t.arquivos)} arquivos e ${fmt.formatarNumero(t.pastas)} pastas (${fmt.formatarDuracao(r.duracaoMs)})`, cor));
  if (r.parou) s.write('  Varredura interrompida: os números são parciais.\n');
  if (t.semPermissao) s.write(`  ${fmt.formatarNumero(t.semPermissao)} pasta(s) ou arquivo(s) sem permissão de leitura, não entraram na conta.\n`);
  if (t.links) s.write(`  ${fmt.formatarNumero(t.links)} link(s)/junction(s) ignorados de propósito.\n`);

  const raiz = listarFilhos(r, r.raiz);
  s.write('\n' + titulo(`PASTAS DENTRO DE ${r.raiz} (da maior pra menor)`, cor));
  if (raiz.nArquivos) {
    s.write(`  ${fmt.formatarBytes(raiz.tamanhoArquivos).padStart(9)}  ${fmt.formatarPorcentagem(raiz.tamanhoArquivos, raiz.tamanho).padStart(5)}  [arquivos soltos na raiz: ${fmt.formatarNumero(raiz.nArquivos)}]\n`);
  }
  for (const f of raiz.filhos.slice(0, opcoes.top)) {
    const aviso = f.erro ? `  (sem permissão: ${f.erro})` : '';
    s.write(`  ${fmt.formatarBytes(f.tamanho).padStart(9)}  ${fmt.formatarPorcentagem(f.tamanho, raiz.tamanho).padStart(5)}  ${f.nome}${aviso}\n`);
  }
  if (raiz.filhos.length > opcoes.top) s.write(`  ... e mais ${raiz.filhos.length - opcoes.top} pastas\n`);

  s.write('\n' + titulo('PASTAS MAIS PESADAS EM QUALQUER NÍVEL (só os arquivos soltos nela)', cor));
  for (const p of r.pastasMaisPesadas.slice(0, opcoes.top)) {
    s.write(`  ${fmt.formatarBytes(p.tamanho).padStart(9)}  ${fmt.formatarNumero(p.nArquivos).padStart(8)} arq  ${p.caminho}\n`);
  }

  s.write('\n' + titulo('MAIORES ARQUIVOS', cor));
  for (const a of r.maioresArquivos.slice(0, opcoes.top)) {
    s.write(`  ${fmt.formatarBytes(a.tamanho).padStart(9)}  ${fmt.formatarData(a.modificado)}  ${a.caminho}\n`);
  }

  if (r.semPermissao.length) {
    const mostrar = Math.min(opcoes.top, r.semPermissao.length);
    s.write('\n' + titulo(`SEM PERMISSÃO DE LEITURA (${fmt.formatarNumero(r.semPermissao.length)}, mostrando ${mostrar})`, cor));
    for (const e of r.semPermissao.slice(0, mostrar)) s.write(`  ${e.codigo.padEnd(7)} ${e.caminho}\n`);
  }
  s.write('\n');
}

function principal() {
  const opcoes = lerArgs(process.argv.slice(2));
  if (opcoes.ajuda) return ajuda();
  if (!opcoes.alvo) return mostrarDiscos();

  const alvo = path.resolve(opcoes.alvo);
  const err = process.stderr;
  const apagarLinha = () => { if (err.isTTY) err.write('\r\x1b[2K'); };
  err.write(`Varrendo ${alvo} ...\n`);

  const r = varrer(alvo, {
    aoProgresso: (p) => {
      if (!err.isTTY) return;
      const atual = p.atual.length > 60 ? '...' + p.atual.slice(-57) : p.atual;
      apagarLinha();
      err.write(`  ${fmt.formatarNumero(p.pastas)} pastas, ${fmt.formatarNumero(p.arquivos)} arquivos, ${fmt.formatarBytes(p.bytes)}  ${atual}`);
    },
  });
  apagarLinha();

  if (r.arvore.erro) {
    err.write(`Não deu pra ler ${alvo} (${r.arvore.erro}).\n`);
    process.exitCode = 1;
    return;
  }
  relatorio(r, opcoes);
}

principal();
