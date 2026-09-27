'use strict';
// Monta uma pasta temporária com tamanhos conhecidos pros testes:
//
//   raiz/
//     a.txt          1000 bytes
//     pasta1/
//       b.bin        2000
//       sub/
//         c.bin       500
//         d.bin        10
//     pasta2/
//       e.bin        3000
//     atalho -> pasta1   (link simbólico, tem que ser ignorado)
//     trancada/          (sem permissão, só quando dá pra simular)
//       f.bin         700
//
// Total contável: 1000 + 2000 + 500 + 10 + 3000 = 6510 bytes.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const TOTAL = 6510;

function podeTrancar() {
  // root lê qualquer pasta, e no Windows chmod não tira permissão
  if (process.platform === 'win32') return false;
  if (typeof process.getuid === 'function' && process.getuid() === 0) return false;
  return true;
}

function montar() {
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'cade-teste-'));
  const escrever = (rel, tamanho) => {
    const c = path.join(raiz, rel);
    fs.mkdirSync(path.dirname(c), { recursive: true });
    fs.writeFileSync(c, Buffer.alloc(tamanho, 120));
  };
  escrever('a.txt', 1000);
  escrever('pasta1/b.bin', 2000);
  escrever('pasta1/sub/c.bin', 500);
  escrever('pasta1/sub/d.bin', 10);
  escrever('pasta2/e.bin', 3000);

  let temLink = false;
  try {
    fs.symlinkSync(path.join(raiz, 'pasta1'), path.join(raiz, 'atalho'), 'junction');
    temLink = true;
  } catch {
    // sem direito de criar link (Windows sem modo desenvolvedor): teste pula essa parte
  }

  let temTrancada = false;
  if (podeTrancar()) {
    escrever('trancada/f.bin', 700);
    fs.chmodSync(path.join(raiz, 'trancada'), 0o000);
    temTrancada = true;
  }

  const limpar = () => {
    if (temTrancada) {
      try { fs.chmodSync(path.join(raiz, 'trancada'), 0o700); } catch { /* já foi */ }
    }
    fs.rmSync(raiz, { recursive: true, force: true });
  };

  return { raiz, temLink, temTrancada, limpar };
}

module.exports = { montar, TOTAL };
