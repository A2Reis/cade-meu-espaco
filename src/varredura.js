'use strict';
// Varredura do disco: percorre uma raiz e monta uma árvore só de pastas.
// Arquivo não vira nó (seriam milhões). Cada pasta guarda quantos arquivos
// tem direto nela e quanto pesam. Os maiores arquivos e as pastas mais pesadas
// ficam em rankings limitados (ranking.js), então a memória cresce com o
// número de pastas, não de arquivos.
//
// Regras:
//  - Link simbólico e junction (atalho de pasta do Windows) nunca são seguidos,
//    pra não contar duas vezes nem entrar em laço. Contam zero byte.
//  - Pasta sem permissão de leitura vira nó com `erro` e entra na lista
//    `semPermissao`. A varredura segue nas outras.
//  - Tamanho é o tamanho lógico (st.size), o que o Explorer mostra em
//    "Tamanho", não "Tamanho em disco". Arquivo comprimido pelo NTFS ou
//    "somente na nuvem" do OneDrive aparece com o tamanho cheio.
//  - Tudo síncrono de propósito: roda numa worker thread (worker.js) e
//    síncrono é bem mais rápido que promessa por arquivo.

const fs = require('node:fs');
const path = require('node:path');
const { Ranking } = require('./ranking');

const NO_WINDOWS = process.platform === 'win32';

function novoNo(nome, pai) {
  return {
    nome,
    pai,
    tamanho: 0,          // tudo que está dentro, subpastas inclusas
    tamanhoArquivos: 0,  // só os arquivos soltos direto nesta pasta
    nArquivos: 0,        // arquivos soltos direto aqui
    nArquivosTotal: 0,   // arquivos em qualquer nível abaixo
    nPastasTotal: 0,     // subpastas em qualquer nível abaixo
    filhos: [],
    erro: null,          // código (EPERM, EACCES...) se não deu pra ler
  };
}

function varrer(raiz, opcoes = {}) {
  const inicio = Date.now();
  const raizAbs = path.resolve(String(raiz));
  const limiteRanking = opcoes.limiteRanking ?? 200;
  const limiteErros = opcoes.limiteErros ?? 1000;
  const intervalo = opcoes.intervaloProgresso ?? 400;
  const aoProgresso = typeof opcoes.aoProgresso === 'function' ? opcoes.aoProgresso : null;
  const deveParar = typeof opcoes.deveParar === 'function' ? opcoes.deveParar : () => false;

  const arvore = novoNo(raizAbs, null);
  const maioresArquivos = new Ranking(limiteRanking);
  const pastasMaisPesadas = new Ranking(limiteRanking);
  const semPermissao = [];
  const totais = { pastas: 0, arquivos: 0, bytes: 0, links: 0, semPermissao: 0 };

  const registrarErro = (no, caminho, e) => {
    const codigo = (e && e.code) || 'ERRO';
    if (no) no.erro = codigo;
    totais.semPermissao++;
    if (semPermissao.length < limiteErros) semPermissao.push({ caminho, codigo });
  };

  const pilha = [{ no: arvore, caminho: raizAbs }];
  let ultimoAviso = Date.now();
  let parou = false;

  while (pilha.length) {
    if (deveParar()) {
      parou = true;
      break;
    }
    const { no, caminho } = pilha.pop();

    // esta pasta conta em todos os ancestrais, lida ou não
    for (let p = no.pai; p; p = p.pai) p.nPastasTotal++;

    let entradas;
    try {
      entradas = fs.readdirSync(caminho, { withFileTypes: true });
    } catch (e) {
      registrarErro(no, caminho, e);
      continue;
    }
    totais.pastas++;

    let bytesAqui = 0;
    let nAqui = 0;
    for (const ent of entradas) {
      const caminhoEnt = path.join(caminho, ent.name);
      let ehPasta = false;
      let st = null;

      if (ent.isSymbolicLink()) {
        // No Windows todo "reparse point" cai aqui: link e junction, mas também
        // pasta do OneDrive e arquivo "somente na nuvem". O lstat separa:
        // link de verdade a gente ignora, o resto vira pasta ou arquivo normal.
        try {
          st = fs.lstatSync(caminhoEnt);
        } catch (e) {
          registrarErro(null, caminhoEnt, e);
          continue;
        }
        if (st.isSymbolicLink()) {
          totais.links++;
          continue;
        }
        ehPasta = st.isDirectory();
      } else if (ent.isDirectory()) {
        ehPasta = true;
      }

      if (ehPasta) {
        const filho = novoNo(ent.name, no);
        no.filhos.push(filho);
        pilha.push({ no: filho, caminho: caminhoEnt });
        continue;
      }

      if (!st) {
        try {
          st = fs.lstatSync(caminhoEnt);
        } catch (e) {
          // pagefile.sys e hiberfil.sys costumam cair aqui: o Windows não
          // deixa nem abrir pra ler os atributos
          registrarErro(null, caminhoEnt, e);
          continue;
        }
      }
      if (!st.isFile()) continue; // socket, pipe, dispositivo: não ocupa espaço de dado

      bytesAqui += st.size;
      nAqui++;
      if (st.size > maioresArquivos.menor) {
        maioresArquivos.considerar({
          caminho: caminhoEnt,
          nome: ent.name,
          pasta: caminho,
          tamanho: st.size,
          modificado: st.mtimeMs,
        });
      }
    }

    no.tamanhoArquivos = bytesAqui;
    no.nArquivos = nAqui;
    totais.arquivos += nAqui;
    totais.bytes += bytesAqui;
    if (nAqui > 0) pastasMaisPesadas.considerar({ caminho, tamanho: bytesAqui, nArquivos: nAqui });
    for (let p = no; p; p = p.pai) {
      p.tamanho += bytesAqui;
      p.nArquivosTotal += nAqui;
    }

    if (aoProgresso) {
      const agora = Date.now();
      if (agora - ultimoAviso >= intervalo) {
        ultimoAviso = agora;
        aoProgresso({ ...totais, atual: caminho });
      }
    }
  }

  return {
    raiz: raizAbs,
    arvore,
    totais,
    maioresArquivos: maioresArquivos.lista(),
    pastasMaisPesadas: pastasMaisPesadas.lista(),
    semPermissao,
    parou,
    duracaoMs: Date.now() - inicio,
  };
}

function mesmoNome(a, b) {
  return NO_WINDOWS ? a.toLowerCase() === b.toLowerCase() : a === b;
}

// Acha o nó da árvore que corresponde a um caminho absoluto. Devolve null se
// o caminho está fora da raiz varrida ou não existia na hora da varredura.
function encontrarNo(resultado, caminho) {
  const alvo = path.resolve(String(caminho));
  const rel = path.relative(resultado.raiz, alvo);
  if (rel === '') return resultado.arvore;
  if (rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel)) return null;
  let no = resultado.arvore;
  for (const parte of rel.split(path.sep)) {
    const filho = no.filhos.find((f) => mesmoNome(f.nome, parte));
    if (!filho) return null;
    no = filho;
  }
  return no;
}

function caminhoDoNo(resultado, no) {
  const partes = [];
  for (let p = no; p && p.pai; p = p.pai) partes.push(p.nome);
  partes.reverse();
  return partes.length ? path.join(resultado.raiz, ...partes) : resultado.raiz;
}

// Versão sem referências circulares (sem `pai`, sem `filhos`), pronta pra
// atravessar postMessage e chegar na interface.
function resumirNo(resultado, no, caminho) {
  return {
    nome: no.pai ? no.nome : resultado.raiz,
    caminho: caminho ?? caminhoDoNo(resultado, no),
    tamanho: no.tamanho,
    tamanhoArquivos: no.tamanhoArquivos,
    nArquivos: no.nArquivos,
    nArquivosTotal: no.nArquivosTotal,
    nPastasTotal: no.nPastasTotal,
    nFilhos: no.filhos.length,
    erro: no.erro,
  };
}

// Conteúdo de uma pasta: ela mesma, o caminho até a raiz (trilha) e as
// subpastas da maior pra menor.
function listarFilhos(resultado, caminho) {
  const no = encontrarNo(resultado, caminho);
  if (!no) return null;
  const caminhoNo = caminhoDoNo(resultado, no);

  const trilha = [];
  for (let p = no; p; p = p.pai) {
    trilha.push({ nome: p.pai ? p.nome : resultado.raiz, caminho: caminhoDoNo(resultado, p) });
  }
  trilha.reverse();

  const filhos = no.filhos
    .map((f) => resumirNo(resultado, f, path.join(caminhoNo, f.nome)))
    .sort((a, b) => b.tamanho - a.tamanho);

  return {
    ...resumirNo(resultado, no, caminhoNo),
    pai: no.pai ? caminhoDoNo(resultado, no.pai) : null,
    trilha,
    filhos,
  };
}

// Arquivos soltos numa pasta, lidos na hora (a árvore não guarda arquivo).
// Devolve só os `limite` maiores, mas conta e soma todos.
function listarArquivosDe(caminho, limite = 500) {
  const dir = path.resolve(String(caminho));
  let entradas;
  try {
    entradas = fs.readdirSync(dir, { withFileTypes: true });
  } catch (e) {
    return { caminho: dir, erro: e.code || 'ERRO', total: 0, tamanhoTotal: 0, arquivos: [] };
  }
  const ranking = new Ranking(limite);
  let total = 0;
  let tamanhoTotal = 0;
  for (const ent of entradas) {
    if (ent.isDirectory()) continue;
    const c = path.join(dir, ent.name);
    let st;
    try {
      st = fs.lstatSync(c);
    } catch {
      continue;
    }
    if (st.isSymbolicLink() || !st.isFile()) continue;
    total++;
    tamanhoTotal += st.size;
    ranking.considerar({ caminho: c, nome: ent.name, pasta: dir, tamanho: st.size, modificado: st.mtimeMs });
  }
  return { caminho: dir, erro: null, total, tamanhoTotal, arquivos: ranking.lista() };
}

// O que a interface precisa saber quando a varredura termina.
function resumo(resultado) {
  return {
    raiz: resultado.raiz,
    totais: { ...resultado.totais },
    parou: resultado.parou,
    duracaoMs: resultado.duracaoMs,
    nSemPermissao: resultado.semPermissao.length,
  };
}

module.exports = { varrer, encontrarNo, caminhoDoNo, listarFilhos, listarArquivosDe, resumo };
