'use strict';
// Guarda só os N maiores itens vistos até agora, sem armazenar o resto.
// É um heap mínimo pelo campo `tamanho`: o menor dos guardados fica no topo,
// e um item novo só entra se for maior que ele. Serve pra "maiores arquivos"
// e "pastas mais pesadas" sem a memória crescer com o número de arquivos.

class Ranking {
  constructor(limite) {
    this.limite = Math.max(0, Number(limite) || 0);
    this.itens = [];
  }

  // Menor tamanho que ainda está no ranking. Enquanto não encheu, qualquer
  // coisa entra, então devolve -Infinity.
  get menor() {
    return this.itens.length < this.limite ? -Infinity : this.itens[0].tamanho;
  }

  considerar(item) {
    if (this.limite === 0) return false;
    if (this.itens.length < this.limite) {
      this.itens.push(item);
      this._subir(this.itens.length - 1);
      return true;
    }
    if (item.tamanho <= this.itens[0].tamanho) return false;
    this.itens[0] = item;
    this._descer(0);
    return true;
  }

  // Do maior pro menor.
  lista() {
    return [...this.itens].sort((a, b) => b.tamanho - a.tamanho);
  }

  _subir(i) {
    const h = this.itens;
    while (i > 0) {
      const pai = (i - 1) >> 1;
      if (h[pai].tamanho <= h[i].tamanho) break;
      [h[pai], h[i]] = [h[i], h[pai]];
      i = pai;
    }
  }

  _descer(i) {
    const h = this.itens;
    const n = h.length;
    for (;;) {
      const esq = 2 * i + 1;
      const dir = esq + 1;
      let menor = i;
      if (esq < n && h[esq].tamanho < h[menor].tamanho) menor = esq;
      if (dir < n && h[dir].tamanho < h[menor].tamanho) menor = dir;
      if (menor === i) break;
      [h[menor], h[i]] = [h[i], h[menor]];
      i = menor;
    }
  }
}

module.exports = { Ranking };
