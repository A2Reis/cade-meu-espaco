'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const f = require('../src/formatar');

test('formatarBytes usa base 1024 e vírgula', () => {
  assert.equal(f.formatarBytes(0), '0 B');
  assert.equal(f.formatarBytes(999), '999 B');
  assert.equal(f.formatarBytes(1024), '1,00 KB');
  assert.equal(f.formatarBytes(1536), '1,50 KB');
  assert.equal(f.formatarBytes(10 * 1024), '10,0 KB');
  assert.equal(f.formatarBytes(100 * 1024), '100 KB');
  assert.equal(f.formatarBytes(1024 ** 2), '1,00 MB');
  assert.equal(f.formatarBytes(1024 ** 3), '1,00 GB');
  assert.equal(f.formatarBytes(356.2 * 1024 ** 3), '356 GB');
  assert.equal(f.formatarBytes(12.345 * 1024 ** 3), '12,3 GB');
  assert.equal(f.formatarBytes(2 * 1024 ** 4), '2,00 TB');
  assert.equal(f.formatarBytes(-5), '0 B');
  assert.equal(f.formatarBytes(NaN), '0 B');
});

test('formatarNumero separa milhar com ponto', () => {
  assert.equal(f.formatarNumero(0), '0');
  assert.equal(f.formatarNumero(999), '999');
  assert.equal(f.formatarNumero(1000), '1.000');
  assert.equal(f.formatarNumero(1234567), '1.234.567');
  assert.equal(f.formatarNumero(12.9), '12');
});

test('formatarPorcentagem', () => {
  assert.equal(f.formatarPorcentagem(50, 100), '50%');
  assert.equal(f.formatarPorcentagem(1.23, 100), '1,2%');
  assert.equal(f.formatarPorcentagem(0, 100), '0%');
  assert.equal(f.formatarPorcentagem(5, 0), '0%');
  assert.equal(f.formatarPorcentagem(100, 100), '100%');
  assert.equal(f.formatarPorcentagem(99.97, 100), '100%');
});

test('formatarDuracao', () => {
  assert.equal(f.formatarDuracao(0), '0 s');
  assert.equal(f.formatarDuracao(4200), '4 s');
  assert.equal(f.formatarDuracao(60000), '1 min');
  assert.equal(f.formatarDuracao(133000), '2 min 13 s');
  assert.equal(f.formatarDuracao(3600000), '1 h');
  assert.equal(f.formatarDuracao(3660000), '1 h 1 min');
});

test('plural', () => {
  assert.equal(f.plural(0, 'arquivo'), '0 arquivos');
  assert.equal(f.plural(1, 'arquivo'), '1 arquivo');
  assert.equal(f.plural(2, 'arquivo'), '2 arquivos');
  assert.equal(f.plural(1500, 'pasta'), '1.500 pastas');
});

test('formatarData em pt-BR', () => {
  const d = new Date(2026, 8, 20, 14, 5).getTime();
  assert.equal(f.formatarData(d), '20/09/2026 14:05');
  assert.equal(f.formatarData(NaN), '');
});
