'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const { listarDiscos, medir } = require('../src/discos');

test('listarDiscos acha pelo menos um disco com total e livre coerentes', () => {
  const discos = listarDiscos();
  assert.ok(discos.length >= 1);
  for (const d of discos) {
    assert.equal(typeof d.caminho, 'string');
    assert.ok(d.total > 0);
    assert.ok(d.livre >= 0 && d.livre <= d.total);
    assert.equal(d.usado, d.total - d.livre);
  }
});

test('medir a pasta temporária dá um disco', () => {
  const d = medir(os.tmpdir());
  assert.ok(d.total > 0);
});

test('medir caminho inexistente lança', () => {
  assert.throws(() => medir('/caminho/que/nao/existe/nem/a/pau'));
});
