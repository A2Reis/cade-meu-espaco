'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Ranking } = require('../src/ranking');

test('guarda só os N maiores, do maior pro menor', () => {
  const r = new Ranking(3);
  for (const t of [5, 1, 9, 3, 7, 2, 8]) r.considerar({ tamanho: t });
  assert.deepEqual(r.lista().map((x) => x.tamanho), [9, 8, 7]);
  assert.equal(r.itens.length, 3);
});

test('menor é -Infinity enquanto não encheu, depois é o menor guardado', () => {
  const r = new Ranking(2);
  assert.equal(r.menor, -Infinity);
  r.considerar({ tamanho: 4 });
  assert.equal(r.menor, -Infinity);
  r.considerar({ tamanho: 6 });
  assert.equal(r.menor, 4);
  r.considerar({ tamanho: 5 });
  assert.equal(r.menor, 5);
});

test('item igual ao menor não entra, maior entra', () => {
  const r = new Ranking(1);
  assert.equal(r.considerar({ tamanho: 10 }), true);
  assert.equal(r.considerar({ tamanho: 10 }), false);
  assert.equal(r.considerar({ tamanho: 11 }), true);
  assert.deepEqual(r.lista().map((x) => x.tamanho), [11]);
});

test('limite zero não guarda nada', () => {
  const r = new Ranking(0);
  assert.equal(r.considerar({ tamanho: 1 }), false);
  assert.deepEqual(r.lista(), []);
});

test('aguenta muitos itens em ordem aleatória', () => {
  const r = new Ranking(50);
  const todos = [];
  for (let i = 0; i < 5000; i++) {
    const t = Math.floor(Math.random() * 1e9);
    todos.push(t);
    r.considerar({ tamanho: t });
  }
  todos.sort((a, b) => b - a);
  assert.deepEqual(r.lista().map((x) => x.tamanho), todos.slice(0, 50));
});
