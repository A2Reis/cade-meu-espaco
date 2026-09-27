'use strict';
// Interface. Não tem Node aqui: tudo passa por window.cade (preload.js) e
// a formatação vem de window.formatar (src/formatar.js carregado como script).
// Nada de innerHTML com dado do disco: nome de arquivo vira textContent.

(function () {
  const api = window.cade;
  const fmt = window.formatar;
  const $ = (id) => document.getElementById(id);

  const el = {
    disco: $('disco'),
    btnPasta: $('btn-pasta'),
    btnVarrer: $('btn-varrer'),
    btnParar: $('btn-parar'),
    alvo: $('alvo'),
    progresso: $('progresso'),
    pPastas: $('p-pastas'),
    pArquivos: $('p-arquivos'),
    pBytes: $('p-bytes'),
    pErros: $('p-erros'),
    pAtual: $('p-atual'),
    resumo: $('resumo'),
    erroGeral: $('erro-geral'),
    abas: $('abas'),
    vazio: $('vazio'),
    abaPastas: $('aba-pastas'),
    abaArquivos: $('aba-arquivos'),
    abaPesadas: $('aba-pesadas'),
    abaErros: $('aba-erros'),
    btnSubir: $('btn-subir'),
    trilha: $('trilha'),
    cabecalhoPasta: $('cabecalho-pasta'),
    listaPastas: $('lista-pastas'),
    listaArquivos: $('lista-arquivos'),
    listaPesadas: $('lista-pesadas'),
    listaErros: $('lista-erros'),
  };

  const estado = {
    discos: [],
    alvo: null,
    varrendo: false,
    resumo: null,
    pastaAtual: null,   // dados da pasta aberta na aba Pastas
    aba: 'pastas',
    abasCarregadas: new Set(),
  };

  // ---------- utilidades de DOM ----------

  function criar(tag, classe, texto) {
    const e = document.createElement(tag);
    if (classe) e.className = classe;
    if (texto !== undefined) e.textContent = texto;
    return e;
  }

  function botao(texto, aoClicar, titulo) {
    const b = criar('button', null, texto);
    b.type = 'button';
    if (titulo) b.title = titulo;
    b.addEventListener('click', (ev) => {
      ev.stopPropagation();
      aoClicar();
    });
    return b;
  }

  // Uma linha da lista: barra proporcional atrás, nome, tamanho, %, info, ações.
  function linha(o) {
    const l = criar('div', 'linha' + (o.classe ? ' ' + o.classe : '') + (o.aoClicar ? ' clicavel' : ''));
    const barra = criar('div', 'barra');
    barra.style.width = (Math.max(0, Math.min(1, o.frac || 0)) * 100).toFixed(2) + '%';
    l.append(barra);

    const nome = criar('div', 'nome', o.nome);
    if (o.sub) nome.append(criar('span', 'sub', o.sub));
    if (o.titulo) nome.title = o.titulo;
    l.append(nome);

    l.append(criar('div', 'tam', o.tamanho));
    l.append(criar('div', 'pct', o.pct || ''));
    l.append(criar('div', 'info', o.info || ''));

    const acoes = criar('div', 'acoes');
    for (const b of o.acoes || []) acoes.append(b);
    l.append(acoes);

    if (o.aoClicar) {
      l.addEventListener('click', o.aoClicar);
      l.tabIndex = 0;
      l.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter') o.aoClicar();
      });
    }
    return l;
  }

  function mostrarErro(msg) {
    el.erroGeral.textContent = msg;
    el.erroGeral.hidden = false;
  }

  function limparErro() {
    el.erroGeral.hidden = true;
    el.erroGeral.textContent = '';
  }

  async function abrir(caminho, ehArquivo) {
    limparErro();
    try {
      const erro = await api.abrir(caminho, ehArquivo);
      if (erro) mostrarErro('Não deu pra abrir no Explorer: ' + erro);
    } catch (e) {
      mostrarErro('Não deu pra abrir no Explorer: ' + e.message);
    }
  }

  // ---------- discos e alvo ----------

  async function carregarDiscos() {
    estado.discos = await api.discos();
    el.disco.replaceChildren();
    for (const d of estado.discos) {
      const o = criar('option', null,
        d.caminho + '   ' + fmt.formatarBytes(d.livre) + ' livres de ' + fmt.formatarBytes(d.total) +
        ' (' + fmt.formatarPorcentagem(d.usado, d.total) + ' cheio)');
      o.value = d.caminho;
      el.disco.append(o);
    }
    if (estado.discos.length) {
      estado.alvo = estado.discos[0].caminho;
      el.disco.value = estado.alvo;
    } else {
      mostrarErro('Nenhum disco encontrado. Use "Escolher pasta…".');
    }
    atualizarAlvo();
  }

  function atualizarAlvo() {
    el.alvo.textContent = estado.alvo ? 'Vai varrer: ' + estado.alvo : '';
    el.btnVarrer.disabled = !estado.alvo || estado.varrendo;
  }

  function escolherAlvo(caminho) {
    estado.alvo = caminho;
    let opcao = Array.from(el.disco.options).find((o) => o.value === caminho);
    if (!opcao) {
      opcao = criar('option', null, caminho + '   (pasta escolhida)');
      opcao.value = caminho;
      el.disco.append(opcao);
    }
    el.disco.value = caminho;
    atualizarAlvo();
  }

  // ---------- varredura ----------

  function travar(varrendo) {
    estado.varrendo = varrendo;
    el.disco.disabled = varrendo;
    el.btnPasta.disabled = varrendo;
    el.btnVarrer.disabled = varrendo || !estado.alvo;
    el.btnParar.hidden = !varrendo;
    el.btnParar.disabled = false;
    el.btnSubir.disabled = varrendo;
  }

  function atualizarProgresso(p) {
    el.pPastas.textContent = fmt.formatarNumero(p.pastas);
    el.pArquivos.textContent = fmt.formatarNumero(p.arquivos);
    el.pBytes.textContent = fmt.formatarBytes(p.bytes);
    el.pErros.textContent = fmt.formatarNumero(p.semPermissao);
    el.pAtual.textContent = p.atual || '';
  }

  async function varrer() {
    if (estado.varrendo || !estado.alvo) return;
    limparErro();
    travar(true);
    atualizarProgresso({ pastas: 0, arquivos: 0, bytes: 0, semPermissao: 0, atual: estado.alvo });
    el.progresso.hidden = false;
    el.resumo.hidden = true;
    el.abas.hidden = true;
    el.vazio.hidden = true;
    for (const s of [el.abaPastas, el.abaArquivos, el.abaPesadas, el.abaErros]) s.hidden = true;
    estado.abasCarregadas.clear();
    estado.resumo = null;
    estado.pastaAtual = null;

    try {
      const resumo = await api.varrer(estado.alvo);
      estado.resumo = resumo;
      mostrarResumo(resumo);
      el.abas.hidden = false;
      trocarAba('pastas');
      await navegar(resumo.raiz);
    } catch (e) {
      mostrarErro('Não deu pra varrer: ' + (e && e.message ? e.message : e));
      el.vazio.hidden = false;
    } finally {
      travar(false);
      el.progresso.hidden = true;
    }
  }

  function parar() {
    el.btnParar.disabled = true;
    el.btnParar.textContent = 'Parando…';
    api.parar().finally(() => {
      el.btnParar.textContent = 'Parar';
    });
  }

  function mostrarResumo(r) {
    el.resumo.replaceChildren();
    const t = r.totais;
    el.resumo.append(criar('p', 'destaque',
      r.raiz + ' tem ' + fmt.formatarBytes(t.bytes) + ' em ' + fmt.plural(t.arquivos, 'arquivo') +
      ' e ' + fmt.plural(t.pastas, 'pasta') + '. Varredura levou ' + fmt.formatarDuracao(r.duracaoMs) + '.'));

    if (r.parou) el.resumo.append(criar('p', 'atencao', 'Varredura interrompida no Parar: os números são parciais.'));

    if (t.semPermissao) {
      el.resumo.append(criar('p', null,
        fmt.formatarNumero(t.semPermissao) + ' pasta(s) ou arquivo(s) sem permissão de leitura ficaram de fora da soma. Veja a aba "Sem permissão".'));
    }

    const disco = estado.discos.find((d) => semBarraFinal(d.caminho) === semBarraFinal(r.raiz));
    if (disco) {
      el.resumo.append(criar('p', null,
        'O disco diz: ' + fmt.formatarBytes(disco.total) + ' no total, ' + fmt.formatarBytes(disco.usado) + ' usados, ' +
        fmt.formatarBytes(disco.livre) + ' livres (' + fmt.formatarPorcentagem(disco.usado, disco.total) + ' cheio).'));
      const diferenca = disco.usado - t.bytes;
      if (diferenca > disco.total * 0.01) {
        el.resumo.append(criar('p', null,
          'A varredura somou ' + fmt.formatarBytes(diferenca) + ' a menos do que o disco diz estar usado. ' +
          'Essa diferença fica em coisas que o Windows não deixa ler (pagefile.sys, hiberfil.sys, pontos de restauração, ' +
          'lixeira de outros usuários) e no que o próprio sistema de arquivos reserva.'));
      } else if (-diferenca > disco.total * 0.01) {
        el.resumo.append(criar('p', null,
          'A varredura somou ' + fmt.formatarBytes(-diferenca) + ' a mais do que o disco diz estar usado. ' +
          'Arquivos com vários nomes (links físicos, comuns em C:\\Windows\\WinSxS) contam uma vez por nome, ' +
          'e arquivos do OneDrive que estão só na nuvem contam com o tamanho cheio.'));
      }
    }
    el.resumo.hidden = false;
  }

  function semBarraFinal(c) {
    return String(c).replace(/[\\/]+$/, '').toLowerCase();
  }

  // ---------- abas ----------

  function trocarAba(nome) {
    estado.aba = nome;
    for (const b of el.abas.querySelectorAll('button')) b.classList.toggle('ativa', b.dataset.aba === nome);
    el.abaPastas.hidden = nome !== 'pastas';
    el.abaArquivos.hidden = nome !== 'arquivos';
    el.abaPesadas.hidden = nome !== 'pesadas';
    el.abaErros.hidden = nome !== 'erros';
    if (!estado.resumo || estado.abasCarregadas.has(nome)) return;
    estado.abasCarregadas.add(nome);
    if (nome === 'arquivos') api.maioresArquivos().then(renderizarMaioresArquivos).catch(erroDeCarga);
    if (nome === 'pesadas') api.pastasMaisPesadas().then(renderizarPesadas).catch(erroDeCarga);
    if (nome === 'erros') api.semPermissao().then(renderizarErros).catch(erroDeCarga);
  }

  function erroDeCarga(e) {
    mostrarErro('Não deu pra carregar: ' + (e && e.message ? e.message : e));
  }

  // ---------- aba Pastas ----------

  async function navegar(caminho) {
    limparErro();
    let dados;
    try {
      dados = await api.filhos(caminho);
    } catch (e) {
      erroDeCarga(e);
      return;
    }
    if (!dados) {
      mostrarErro('Essa pasta não está na varredura: ' + caminho);
      return;
    }
    estado.pastaAtual = dados;
    renderizarTrilha(dados.trilha);
    renderizarCabecalho(dados);
    renderizarPastas(dados);
    el.btnSubir.disabled = !dados.pai;
    el.abaPastas.scrollTop = 0;
    document.getElementById('conteudo').scrollTop = 0;
  }

  function renderizarTrilha(trilha) {
    el.trilha.replaceChildren();
    trilha.forEach((p, i) => {
      if (i > 0) el.trilha.append(criar('span', 'sep', '›'));
      const ultimo = i === trilha.length - 1;
      const b = botao(p.nome, () => { if (!ultimo) navegar(p.caminho); }, p.caminho);
      if (ultimo) b.classList.add('atual');
      el.trilha.append(b);
    });
  }

  function renderizarCabecalho(d) {
    el.cabecalhoPasta.replaceChildren();
    el.cabecalhoPasta.append(criar('span', 'tam', fmt.formatarBytes(d.tamanho)));
    el.cabecalhoPasta.append(criar('span', 'info',
      fmt.plural(d.nArquivosTotal, 'arquivo') + ' e ' + fmt.plural(d.nPastasTotal, 'pasta') + ' dentro de ' + d.caminho));
    if (d.erro) el.cabecalhoPasta.append(criar('span', 'info', 'Sem permissão de leitura (' + d.erro + ').'));
    el.cabecalhoPasta.append(botao('Abrir no Explorer', () => abrir(d.caminho, false)));
  }

  function renderizarPastas(d) {
    el.listaPastas.replaceChildren();
    const total = d.tamanho || 1;

    if (!d.filhos.length && !d.nArquivos) {
      el.listaPastas.append(criar('p', 'nota', d.erro ? 'Não deu pra ler o conteúdo desta pasta.' : 'Pasta vazia.'));
      return;
    }

    for (const f of d.filhos) {
      const infoPartes = [fmt.plural(f.nArquivosTotal, 'arquivo'), fmt.plural(f.nPastasTotal, 'pasta')];
      if (f.erro) infoPartes.unshift('sem permissão (' + f.erro + ')');
      el.listaPastas.append(linha({
        classe: f.erro ? 'trancada' : '',
        frac: f.tamanho / total,
        nome: f.nome,
        titulo: f.caminho,
        tamanho: fmt.formatarBytes(f.tamanho),
        pct: fmt.formatarPorcentagem(f.tamanho, total),
        info: infoPartes.join(', '),
        acoes: [botao('Abrir', () => abrir(f.caminho, false), 'Abrir esta pasta no Explorer')],
        aoClicar: () => navegar(f.caminho),
      }));
    }

    if (d.nArquivos) {
      const caixa = criar('div');
      let aberto = false;
      const l = linha({
        classe: 'arquivos-soltos',
        frac: d.tamanhoArquivos / total,
        nome: 'Arquivos soltos nesta pasta',
        tamanho: fmt.formatarBytes(d.tamanhoArquivos),
        pct: fmt.formatarPorcentagem(d.tamanhoArquivos, total),
        info: fmt.plural(d.nArquivos, 'arquivo') + ' (clique pra listar)',
        acoes: [botao('Abrir', () => abrir(d.caminho, false), 'Abrir esta pasta no Explorer')],
        aoClicar: () => {
          aberto = !aberto;
          if (aberto) mostrarArquivosSoltos(d.caminho, caixa, d.tamanhoArquivos);
          else caixa.replaceChildren();
        },
      });
      el.listaPastas.append(l, caixa);
    }
  }

  async function mostrarArquivosSoltos(caminho, caixa, tamanhoPasta) {
    caixa.replaceChildren(criar('p', 'nota', 'Lendo…'));
    let r;
    try {
      r = await api.arquivosDe(caminho, 500);
    } catch (e) {
      caixa.replaceChildren(criar('p', 'nota', 'Não deu pra ler: ' + e.message));
      return;
    }
    caixa.replaceChildren();
    if (r.erro) {
      caixa.append(criar('p', 'nota', 'Não deu pra ler esta pasta agora (' + r.erro + ').'));
      return;
    }
    const lista = criar('div', 'arquivos-lista');
    const base = tamanhoPasta || r.tamanhoTotal || 1;
    for (const a of r.arquivos) {
      lista.append(linha({
        frac: a.tamanho / base,
        nome: a.nome,
        titulo: a.caminho,
        tamanho: fmt.formatarBytes(a.tamanho),
        pct: fmt.formatarPorcentagem(a.tamanho, base),
        info: 'modificado em ' + fmt.formatarData(a.modificado),
        acoes: [botao('Mostrar', () => abrir(a.caminho, true), 'Abrir o Explorer com este arquivo selecionado')],
      }));
    }
    caixa.append(lista);
    if (r.total > r.arquivos.length) {
      caixa.append(criar('p', 'nota', 'Mostrando os ' + fmt.formatarNumero(r.arquivos.length) + ' maiores de ' + fmt.formatarNumero(r.total) + ' arquivos.'));
    }
  }

  function subir() {
    if (estado.pastaAtual && estado.pastaAtual.pai && !estado.varrendo) navegar(estado.pastaAtual.pai);
  }

  // ---------- aba Maiores arquivos ----------

  function renderizarMaioresArquivos(lista) {
    el.listaArquivos.replaceChildren();
    if (!lista.length) {
      el.listaArquivos.append(criar('p', 'nota', 'Nenhum arquivo encontrado.'));
      return;
    }
    const maior = lista[0].tamanho || 1;
    lista.forEach((a, i) => {
      el.listaArquivos.append(linha({
        frac: a.tamanho / maior,
        nome: (i + 1) + '. ' + a.nome,
        sub: a.pasta,
        titulo: a.caminho,
        tamanho: fmt.formatarBytes(a.tamanho),
        info: 'modificado em ' + fmt.formatarData(a.modificado),
        acoes: [
          botao('Mostrar', () => abrir(a.caminho, true), 'Abrir o Explorer com este arquivo selecionado'),
          botao('Ver pasta', () => irParaPasta(a.pasta), 'Navegar até a pasta dele aqui dentro'),
        ],
      }));
    });
  }

  function irParaPasta(caminho) {
    trocarAba('pastas');
    navegar(caminho);
  }

  // ---------- aba Pastas mais pesadas ----------

  function renderizarPesadas(lista) {
    el.listaPesadas.replaceChildren();
    if (!lista.length) {
      el.listaPesadas.append(criar('p', 'nota', 'Nenhuma pasta com arquivos.'));
      return;
    }
    const maior = lista[0].tamanho || 1;
    lista.forEach((p, i) => {
      el.listaPesadas.append(linha({
        frac: p.tamanho / maior,
        nome: (i + 1) + '. ' + p.caminho,
        titulo: p.caminho,
        tamanho: fmt.formatarBytes(p.tamanho),
        info: fmt.plural(p.nArquivos, 'arquivo solto', 'arquivos soltos'),
        acoes: [
          botao('Abrir', () => abrir(p.caminho, false), 'Abrir esta pasta no Explorer'),
          botao('Ver', () => irParaPasta(p.caminho), 'Navegar até ela aqui dentro'),
        ],
        aoClicar: () => irParaPasta(p.caminho),
      }));
    });
  }

  // ---------- aba Sem permissão ----------

  function renderizarErros(lista) {
    el.listaErros.replaceChildren();
    if (!lista.length) {
      el.listaErros.append(criar('p', 'nota', 'Tudo foi lido. Nenhuma pasta ou arquivo ficou de fora.'));
      return;
    }
    for (const e of lista) {
      el.listaErros.append(linha({
        classe: 'trancada',
        nome: e.caminho,
        titulo: e.caminho,
        tamanho: '',
        info: 'erro ' + e.codigo,
        acoes: [botao('Abrir', () => abrir(e.caminho, false), 'Tentar abrir no Explorer')],
      }));
    }
  }

  // ---------- amarração ----------

  function iniciar() {
    if (!api || !fmt) {
      mostrarErro('A interface foi aberta fora do Electron e não tem acesso ao disco. Rode com "npm start".');
      el.btnVarrer.disabled = true;
      el.btnPasta.disabled = true;
      return;
    }
    api.aoProgresso(atualizarProgresso);

    el.disco.addEventListener('change', () => {
      estado.alvo = el.disco.value;
      atualizarAlvo();
    });
    el.btnPasta.addEventListener('click', async () => {
      const pasta = await api.escolherPasta();
      if (pasta) escolherAlvo(pasta);
    });
    el.btnVarrer.addEventListener('click', varrer);
    el.btnParar.addEventListener('click', parar);
    el.btnSubir.addEventListener('click', subir);
    for (const b of el.abas.querySelectorAll('button')) b.addEventListener('click', () => trocarAba(b.dataset.aba));

    document.addEventListener('keydown', (ev) => {
      const alvoEhCampo = ev.target && (ev.target.tagName === 'INPUT' || ev.target.tagName === 'SELECT' || ev.target.tagName === 'TEXTAREA');
      if (alvoEhCampo) return;
      if (estado.aba === 'pastas' && (ev.key === 'Backspace' || (ev.altKey && ev.key === 'ArrowLeft'))) {
        ev.preventDefault();
        subir();
      }
    });

    carregarDiscos().catch((e) => mostrarErro('Não deu pra listar os discos: ' + e.message));
  }

  iniciar();
})();
