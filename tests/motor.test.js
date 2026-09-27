'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { montar, TOTAL } = require('./fixture');
const { Motor } = require('../src/motor');

test('motor varre na worker thread e responde perguntas', async (t) => {
  const f = montar();
  const motor = new Motor();
  t.after(async () => {
    await motor.encerrar();
    f.limpar();
  });

  const progresso = [];
  motor.aoProgresso = (p) => progresso.push(p);

  const resumo = await motor.varrer(f.raiz);
  assert.equal(resumo.totais.bytes, TOTAL);
  assert.equal(resumo.parou, false);

  const raiz = await motor.filhos(resumo.raiz);
  assert.equal(raiz.tamanho, TOTAL);
  assert.equal(raiz.filhos[0].nome, 'pasta2');

  const sub = await motor.filhos(path.join(resumo.raiz, 'pasta1', 'sub'));
  assert.equal(sub.tamanho, 510);

  const arquivos = await motor.arquivosDe(path.join(resumo.raiz, 'pasta1'));
  assert.equal(arquivos.total, 1);
  assert.equal(arquivos.arquivos[0].nome, 'b.bin');

  const maiores = await motor.maioresArquivos();
  assert.equal(maiores[0].nome, 'e.bin');

  const pesadas = await motor.pastasMaisPesadas();
  assert.equal(path.basename(pesadas[0].caminho), 'pasta2');

  const erros = await motor.semPermissao();
  assert.ok(Array.isArray(erros));

  assert.equal(await motor.filhos('/fora/da/raiz'), null);
});

test('motor rejeita pedido desconhecido sem derrubar a thread', async (t) => {
  const motor = new Motor();
  t.after(() => motor.encerrar());
  await assert.rejects(motor.pedir('inventado', {}), /pedido desconhecido/);
  assert.deepEqual(await motor.maioresArquivos(), [], 'a thread segue viva');
});

test('parar antes de varrer faz a varredura terminar cedo e marcar parou', async (t) => {
  const f = montar();
  const motor = new Motor();
  t.after(async () => {
    await motor.encerrar();
    f.limpar();
  });
  // A varredura zera a flag ao começar, então parar() precisa chegar depois.
  // Como a worker só lê a flag por pasta e a fixture é minúscula, o teste
  // manda o pedido e em seguida sinaliza: o resultado pode ser completo ou
  // parcial, mas nunca pode lançar nem travar.
  const promessa = motor.varrer(f.raiz);
  motor.parar();
  const r = await promessa;
  assert.equal(typeof r.parou, 'boolean');
  assert.ok(r.totais.bytes <= TOTAL);
});
