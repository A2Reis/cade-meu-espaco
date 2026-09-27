'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { montar, TOTAL } = require('./fixture');
const varredura = require('../src/varredura');

test('varrer soma os tamanhos certos em cada nível', (t) => {
  const f = montar();
  t.after(f.limpar);
  const r = varredura.varrer(f.raiz);

  assert.equal(r.raiz, path.resolve(f.raiz));
  assert.equal(r.totais.bytes, TOTAL);
  assert.equal(r.totais.arquivos, 5);
  assert.equal(r.arvore.tamanho, TOTAL);
  assert.equal(r.arvore.tamanhoArquivos, 1000);
  assert.equal(r.arvore.nArquivos, 1);
  assert.equal(r.arvore.nArquivosTotal, 5);
  assert.equal(r.parou, false);
  assert.ok(r.duracaoMs >= 0);

  const pasta1 = r.arvore.filhos.find((n) => n.nome === 'pasta1');
  const pasta2 = r.arvore.filhos.find((n) => n.nome === 'pasta2');
  assert.ok(pasta1 && pasta2);
  assert.equal(pasta1.tamanho, 2510);
  assert.equal(pasta1.tamanhoArquivos, 2000);
  assert.equal(pasta1.nArquivosTotal, 3);
  assert.equal(pasta1.nPastasTotal, 1);
  assert.equal(pasta2.tamanho, 3000);

  const sub = pasta1.filhos.find((n) => n.nome === 'sub');
  assert.equal(sub.tamanho, 510);
  assert.equal(sub.nArquivos, 2);
  assert.equal(sub.pai, pasta1);
});

test('link simbólico nunca é seguido nem contado', (t) => {
  const f = montar();
  t.after(f.limpar);
  if (!f.temLink) {
    t.skip('não deu pra criar link neste ambiente');
    return;
  }
  const r = varredura.varrer(f.raiz);
  assert.equal(r.totais.links, 1);
  assert.equal(r.totais.bytes, TOTAL, 'se seguisse o link, pasta1 contaria duas vezes');
  assert.ok(!r.arvore.filhos.some((n) => n.nome === 'atalho'));
});

test('pasta sem permissão vira nó com erro e não derruba a varredura', (t) => {
  const f = montar();
  t.after(f.limpar);
  if (!f.temTrancada) {
    t.skip('rodando como root ou no Windows: não dá pra simular pasta trancada');
    return;
  }
  const r = varredura.varrer(f.raiz);
  const trancada = r.arvore.filhos.find((n) => n.nome === 'trancada');
  assert.ok(trancada, 'a pasta aparece na árvore');
  assert.equal(trancada.erro, 'EACCES');
  assert.equal(trancada.tamanho, 0);
  assert.equal(r.totais.semPermissao, 1);
  assert.equal(r.semPermissao.length, 1);
  assert.equal(r.semPermissao[0].codigo, 'EACCES');
  assert.equal(r.totais.bytes, TOTAL, 'o resto continua contado');
  assert.equal(r.arvore.nPastasTotal, 4, 'pasta trancada conta como subpasta');
});

test('rankings de maiores arquivos e pastas mais pesadas', (t) => {
  const f = montar();
  t.after(f.limpar);
  const r = varredura.varrer(f.raiz, { limiteRanking: 3 });

  assert.deepEqual(r.maioresArquivos.map((a) => [a.nome, a.tamanho]), [['e.bin', 3000], ['b.bin', 2000], ['a.txt', 1000]]);
  assert.equal(r.maioresArquivos[0].pasta, path.join(r.raiz, 'pasta2'));
  assert.equal(r.maioresArquivos[0].caminho, path.join(r.raiz, 'pasta2', 'e.bin'));
  assert.ok(Number.isFinite(r.maioresArquivos[0].modificado));

  assert.deepEqual(r.pastasMaisPesadas.map((p) => [path.basename(p.caminho), p.tamanho, p.nArquivos]), [
    ['pasta2', 3000, 1],
    ['pasta1', 2000, 1],
    [path.basename(r.raiz), 1000, 1],
  ]);
});

test('sem limite de ranking guarda tudo', (t) => {
  const f = montar();
  t.after(f.limpar);
  const r = varredura.varrer(f.raiz);
  assert.equal(r.maioresArquivos.length, 5);
  assert.equal(r.maioresArquivos.at(-1).nome, 'd.bin');
  assert.equal(r.pastasMaisPesadas.length, 4);
});

test('deveParar interrompe e marca parou', (t) => {
  const f = montar();
  t.after(f.limpar);
  let chamadas = 0;
  const r = varredura.varrer(f.raiz, { deveParar: () => ++chamadas > 1 });
  assert.equal(r.parou, true);
  assert.ok(r.totais.pastas < 4, 'só a raiz foi lida');
  assert.ok(r.totais.bytes < TOTAL);
});

test('aoProgresso é chamado com totais e pasta atual', (t) => {
  const f = montar();
  t.after(f.limpar);
  const avisos = [];
  varredura.varrer(f.raiz, { intervaloProgresso: 0, aoProgresso: (p) => avisos.push(p) });
  assert.ok(avisos.length >= 4, 'um aviso por pasta lida com intervalo zero');
  const ultimo = avisos.at(-1);
  assert.ok(typeof ultimo.atual === 'string');
  assert.ok(ultimo.pastas >= 1);
  assert.ok(ultimo.bytes <= TOTAL);
});

test('raiz inexistente vira erro na raiz, sem lançar', () => {
  const r = varredura.varrer(path.join(__dirname, 'nao-existe-mesmo'));
  assert.equal(r.arvore.erro, 'ENOENT');
  assert.equal(r.totais.pastas, 0);
  assert.equal(r.semPermissao.length, 1);
});

test('listarFilhos devolve subpastas da maior pra menor, trilha e pai', (t) => {
  const f = montar();
  t.after(f.limpar);
  const r = varredura.varrer(f.raiz);

  const raizLista = varredura.listarFilhos(r, r.raiz);
  assert.equal(raizLista.caminho, r.raiz);
  assert.equal(raizLista.nome, r.raiz);
  assert.equal(raizLista.pai, null);
  assert.equal(raizLista.tamanho, TOTAL);
  assert.deepEqual(raizLista.trilha, [{ nome: r.raiz, caminho: r.raiz }]);
  const nomes = raizLista.filhos.map((x) => x.nome);
  assert.equal(nomes[0], 'pasta2');
  assert.equal(nomes[1], 'pasta1');
  assert.ok(!('filhos' in raizLista.filhos[0]), 'filho resumido não carrega a subárvore');
  assert.ok(!('pai' in raizLista.filhos[0]));

  const sub = varredura.listarFilhos(r, path.join(r.raiz, 'pasta1', 'sub'));
  assert.equal(sub.tamanho, 510);
  assert.equal(sub.pai, path.join(r.raiz, 'pasta1'));
  assert.deepEqual(sub.trilha.map((x) => x.nome), [r.raiz, 'pasta1', 'sub']);
  assert.equal(sub.trilha[1].caminho, path.join(r.raiz, 'pasta1'));
  assert.equal(sub.filhos.length, 0);

  // caminho com barra final e com "." no meio resolve igual
  assert.equal(varredura.listarFilhos(r, path.join(r.raiz, 'pasta1', '.', 'sub') + path.sep).tamanho, 510);
});

test('listarFilhos devolve null fora da raiz ou em pasta que não existia', (t) => {
  const f = montar();
  t.after(f.limpar);
  const r = varredura.varrer(f.raiz);
  assert.equal(varredura.listarFilhos(r, path.dirname(r.raiz)), null);
  assert.equal(varredura.listarFilhos(r, path.join(r.raiz, 'nao-tem')), null);
  assert.equal(varredura.listarFilhos(r, path.join(r.raiz, '..', 'outra')), null);
});

test('listarArquivosDe lê os arquivos soltos na hora', (t) => {
  const f = montar();
  t.after(f.limpar);

  const raiz = varredura.listarArquivosDe(f.raiz);
  assert.equal(raiz.erro, null);
  assert.equal(raiz.total, 1, 'o link simbólico não conta');
  assert.equal(raiz.tamanhoTotal, 1000);
  assert.equal(raiz.arquivos[0].nome, 'a.txt');

  const sub = varredura.listarArquivosDe(path.join(f.raiz, 'pasta1', 'sub'), 1);
  assert.equal(sub.total, 2);
  assert.equal(sub.tamanhoTotal, 510);
  assert.equal(sub.arquivos.length, 1, 'respeita o limite');
  assert.equal(sub.arquivos[0].nome, 'c.bin');

  const nada = varredura.listarArquivosDe(path.join(f.raiz, 'nao-tem'));
  assert.equal(nada.erro, 'ENOENT');
  assert.deepEqual(nada.arquivos, []);
});

test('resumo é pequeno e sem referências circulares', (t) => {
  const f = montar();
  t.after(f.limpar);
  const r = varredura.varrer(f.raiz);
  const s = varredura.resumo(r);
  assert.equal(s.raiz, r.raiz);
  assert.equal(s.totais.bytes, TOTAL);
  assert.equal(s.parou, false);
  assert.equal(typeof s.nSemPermissao, 'number');
  assert.doesNotThrow(() => structuredClone(s));
});
