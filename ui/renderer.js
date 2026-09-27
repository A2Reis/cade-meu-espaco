'use strict';
// Interface. Não tem Node aqui: tudo passa por window.cade (preload.js) e
// a formatação vem de window.formatar (src/formatar.js carregado como script).
// Nada de innerHTML: nome de arquivo vira textContent, ícone e anel viram
// elementos SVG criados um a um. A CSP não deixa estilo inline no HTML, então
// larguras e cores que mudam vão por element.style (CSSOM) ou atributo de SVG.

(function () {
  const api = window.cade;
  const fmt = window.formatar;
  const $ = (id) => document.getElementById(id);
  const SVG = 'http://www.w3.org/2000/svg';

  const CORES = 7;              // subpastas com cor própria no anel; o resto vira "outras"
  const LIMITE_ARQUIVOS = 500;  // arquivos soltos listados de uma vez
  const LIMIAR_DIFERENCA = 0.01; // abaixo de 1% do disco, a soma "bate" com o usado

  const el = {
    principal: $('principal'),
    anuncio: $('anuncio'),
    tituloContexto: $('titulo-contexto'),
    erroGeral: $('erro-geral'),
    erroTexto: $('erro-texto'),
    btnFecharErro: $('btn-fechar-erro'),
    telaInicio: $('tela-inicio'),
    telaVarrendo: $('tela-varrendo'),
    telaResultado: $('tela-resultado'),
    semDiscos: $('sem-discos'),
    gradeDiscos: $('grade-discos'),
    cartaoPasta: $('cartao-pasta'),
    pastaTitulo: $('pasta-titulo'),
    pastaDescricao: $('pasta-descricao'),
    pastaAcoes: $('pasta-acoes'),
    btnTrocarPasta: $('btn-trocar-pasta'),
    btnVarrerPasta: $('btn-varrer-pasta'),
    anelVarredura: $('anel-varredura'),
    pAlvo: $('p-alvo'),
    pBytes: $('p-bytes'),
    pReferencia: $('p-referencia'),
    pPastas: $('p-pastas'),
    pArquivos: $('p-arquivos'),
    pErros: $('p-erros'),
    pAtual: $('p-atual'),
    btnParar: $('btn-parar'),
    pararTexto: $('parar-texto'),
    resumoAlvo: $('resumo-alvo'),
    resumo: $('resumo'),
    btnDeNovo: $('btn-de-novo'),
    btnNova: $('btn-nova'),
    sentinela: $('sentinela-vistas'),
    barraVistas: $('barra-vistas'),
    abas: $('abas'),
    botoesAba: Array.from(document.querySelectorAll('#abas [role="tab"]')),
    contadorErros: $('contador-erros'),
    navegacao: $('navegacao'),
    btnSubir: $('btn-subir'),
    trilha: $('trilha'),
    abaPastas: $('aba-pastas'),
    abaArquivos: $('aba-arquivos'),
    abaPesadas: $('aba-pesadas'),
    abaErros: $('aba-erros'),
    cabecalhoPasta: $('cabecalho-pasta'),
    listaPastas: $('lista-pastas'),
    listaArquivos: $('lista-arquivos'),
    listaPesadas: $('lista-pesadas'),
    listaErros: $('lista-erros'),
    anelPasta: null,      // anel de composição da pasta aberta
    arcoVarredura: null,  // arco de progresso do anel da varredura
  };

  const estado = {
    discos: [],
    pastaEscolhida: null,  // pasta vinda do "Escolher uma pasta…"
    varrendo: false,
    tela: 'inicio',
    alvo: null,            // o que está sendo varrido (ou foi por último)
    resumo: null,
    alvoVarrido: null,
    discoDaVarredura: null, // disco inteiro sendo varrido, pra medir o progresso
    pastaAtual: null,      // dados da pasta aberta na vista Pastas
    aba: 'pastas',
    abasCarregadas: new Set(),
    geracao: 0,            // muda a cada varredura: resposta atrasada da anterior é descartada
    pedidoPasta: 0,        // idem pra cliques rápidos entre pastas
    voltaVarredura: 0,     // comprimento do círculo do anel da varredura
    focoAntesDoErro: null, // pra onde o foco volta quando a faixa de erro fecha
  };

  // ---------- utilidades de DOM ----------

  function criar(tag, classe, texto) {
    const e = document.createElement(tag);
    if (classe) e.className = classe;
    if (texto !== undefined) e.textContent = texto;
    return e;
  }

  function criarSvg(tag, atributos) {
    const e = document.createElementNS(SVG, tag);
    for (const [k, v] of Object.entries(atributos || {})) e.setAttribute(k, String(v));
    return e;
  }

  function icone(nome, classe) {
    const s = criarSvg('svg', { class: 'icone' + (classe ? ' ' + classe : ''), 'aria-hidden': 'true', focusable: 'false' });
    s.append(criarSvg('use', { href: '#i-' + nome }));
    return s;
  }

  // Botão com ícone opcional. O clique não sobe pra linha onde ele está.
  function botao(texto, aoClicar, opcoes = {}) {
    const b = criar('button', opcoes.classe || 'botao botao-linha');
    b.type = 'button';
    if (opcoes.icone) b.append(icone(opcoes.icone));
    b.append(document.createTextNode(texto));
    if (opcoes.titulo) b.title = opcoes.titulo;
    // quando o texto visível sozinho é ambíguo (vários "Varrer" na tela)
    if (opcoes.rotulo) b.setAttribute('aria-label', opcoes.rotulo);
    b.addEventListener('click', (ev) => {
      ev.stopPropagation();
      aoClicar(ev);
    });
    return b;
  }

  // Nas linhas, o que sai do app tem sempre o mesmo rótulo e a seta pra
  // fora; o que navega aqui dentro diz "Ir até a pasta". "Abrir" ao lado de
  // uma pasta que já abre no clique se leria como "entrar nela".
  function botaoExplorer(caminho, ehArquivo, titulo) {
    return botao('No Explorer', () => abrir(caminho, ehArquivo), {
      icone: 'abrir',
      titulo: titulo || (ehArquivo ? 'Abrir o Explorer com este arquivo selecionado' : 'Abrir esta pasta no Explorer'),
    });
  }

  function botaoIrAte(caminho, titulo) {
    return botao('Ir até a pasta', () => irParaPasta(caminho, true), { icone: 'ir', titulo });
  }

  // Dentro de uma lista (role=list), nota e estado vazio contam como item.
  function nota(texto, naLista) {
    const n = criar('p', 'nota', texto);
    if (naLista) n.setAttribute('role', 'listitem');
    return n;
  }

  function vazio(texto, nomeIcone, classe) {
    const v = criar('div', 'vazio' + (classe ? ' ' + classe : ''));
    v.setAttribute('role', 'listitem');
    if (nomeIcone) v.append(icone(nomeIcone));
    v.append(criar('p', null, texto));
    return v;
  }

  // O Electron embrulha o erro do processo principal em "Error invoking
  // remote method 'x': Error: ...". Pra quem usa, só a mensagem interessa.
  function mensagem(e) {
    const texto = e && e.message ? e.message : String(e);
    return texto.replace(/^Error invoking remote method '[^']*': (?:[A-Za-z]*Error: )?/, '');
  }

  // Código de erro do sistema em palavras. O código continua no title de
  // quem mostra, pra quem quiser procurar.
  const MOTIVOS = {
    EPERM: 'sem permissão',
    EACCES: 'sem permissão',
    EBUSY: 'em uso pelo Windows',
    ENOENT: 'não encontrado',
    ENAMETOOLONG: 'caminho longo demais',
  };

  function motivoErro(codigo) {
    return MOTIVOS[codigo] || 'não deu pra ler';
  }

  function pctCss(frac) {
    return (Math.max(0, Math.min(1, frac || 0)) * 100).toFixed(2) + '%';
  }

  // "C:\Users\Ana\Temp" vira cabeça "C:\Users\Ana\" e cauda "Temp".
  // Raiz de disco ("C:\") fica inteira na cauda.
  function partirCaminho(caminho) {
    const s = String(caminho);
    const semFinal = s.replace(/[\\/]+$/, '');
    const i = Math.max(semFinal.lastIndexOf('\\'), semFinal.lastIndexOf('/'));
    if (i < 0) return { cabeca: '', cauda: s };
    return { cabeca: s.slice(0, i + 1), cauda: s.slice(i + 1) };
  }

  function nomeDe(caminho) {
    return partirCaminho(caminho).cauda || String(caminho);
  }

  function pastaDe(caminho) {
    const { cabeca } = partirCaminho(caminho);
    const semFinal = cabeca.replace(/[\\/]+$/, '');
    // "C:\" e "/" continuam com a barra; o resto perde a do fim
    return !semFinal || /^[A-Za-z]:$/.test(semFinal) ? cabeca : semFinal;
  }

  // Caminho em fonte mono com reticências no meio: a cabeça encolhe primeiro
  // e o último pedaço (o nome da pasta ou do arquivo) fica sempre visível.
  // A barra vai junto da cauda, pra cortar como "C:\Users\An…\Temp".
  function caminhoMono(caminho, classe) {
    const c = criar('span', 'caminho' + (classe ? ' ' + classe : ''));
    let { cabeca, cauda } = partirCaminho(caminho);
    if (cabeca.length > 1 && /[\\/]$/.test(cabeca)) {
      cauda = cabeca.slice(-1) + cauda;
      cabeca = cabeca.slice(0, -1);
    }
    if (cabeca) c.append(criar('span', 'cabeca', cabeca));
    c.append(criar('span', 'cauda', cauda));
    c.title = String(caminho);
    return c;
  }

  // ---------- anéis ----------

  // Anel no desenho do logo: um círculo por fatia com stroke-dasharray,
  // começando no topo e andando no sentido horário. Fatias: lista de
  // { frac, cor, chave, puxada }, com frac entre 0 e 1 do anel inteiro.
  function anel({ diametro, espessura, fatias, classe }) {
    const folga = 6; // espaço pra fatia puxada pra fora não ser cortada
    const c = diametro / 2;
    const r = c - espessura / 2 - folga;
    const volta = 2 * Math.PI * r;
    const s = criarSvg('svg', {
      class: 'anel' + (classe ? ' ' + classe : ''),
      viewBox: `0 0 ${diametro} ${diametro}`,
      width: diametro,
      height: diametro,
      'aria-hidden': 'true',
    });
    const g = criarSvg('g', { transform: `rotate(-90 ${c} ${c})` });
    g.append(criarSvg('circle', { class: 'anel-trilha', cx: c, cy: c, r, fill: 'none', 'stroke-width': espessura }));

    // 2 px de fundo entre fatias vizinhas, como separador. Fatia sozinha
    // fecha o anel e não tem de onde ser puxada.
    const visiveis = fatias.filter((f) => f.frac * volta >= 1).length;
    const lacuna = visiveis > 1 ? 2 : 0;
    let inicio = 0;
    for (const f of fatias) {
      const comp = Math.max(0, Math.min(1, f.frac)) * volta;
      if (comp >= 1) {
        const circulo = criarSvg('circle', {
          class: 'anel-fatia ' + f.cor,
          cx: c,
          cy: c,
          r,
          fill: 'none',
          'stroke-width': espessura,
          'stroke-dasharray': `${Math.max(0.8, comp - lacuna).toFixed(2)} ${volta.toFixed(2)}`,
          'stroke-dashoffset': (-inicio).toFixed(2),
        });
        // direção do meio da fatia, pra puxar pra fora (no referencial já girado)
        const angulo = ((inicio + comp / 2) / volta) * 2 * Math.PI;
        circulo.style.setProperty('--ux', Math.cos(angulo).toFixed(3));
        circulo.style.setProperty('--uy', Math.sin(angulo).toFixed(3));
        if (f.puxada && visiveis > 1) circulo.classList.add('puxada');
        if (f.chave) circulo.dataset.chave = f.chave;
        g.append(circulo);
      }
      inicio += comp;
    }
    s.append(g);
    return s;
  }

  // O anel da tela de varredura é montado uma vez. Cada sinal tem o seu lugar,
  // pra um não se ler como o outro: num disco inteiro, o arco violeta na
  // trilha é o progresso e um arco âmbar fino, por dentro, gira pra mostrar
  // que continua lendo. Numa pasta não dá pra saber o total: aí só a fatia
  // âmbar do logo gira na trilha.
  function montarAnelVarredura() {
    const d = 128;
    const esp = 12;
    const c = d / 2;
    const r = c - esp / 2 - 6;
    const volta = 2 * Math.PI * r;
    estado.voltaVarredura = volta;
    const s = criarSvg('svg', { class: 'anel', viewBox: `0 0 ${d} ${d}`, width: d, height: d, 'aria-hidden': 'true' });
    const g = criarSvg('g', { transform: `rotate(-90 ${c} ${c})` });
    g.append(criarSvg('circle', { class: 'anel-trilha', cx: c, cy: c, r, fill: 'none', 'stroke-width': esp }));

    const arco = criarSvg('circle', { class: 'anel-progresso', cx: c, cy: c, r, fill: 'none', 'stroke-width': esp, 'stroke-linecap': 'round' });
    arco.style.strokeDasharray = `0 ${volta}`;

    const naTrilha = criarSvg('g', { class: 'orbita orbita-trilha' });
    const fatia = criarSvg('circle', {
      class: 'anel-fatia cor-soltos puxada',
      cx: c,
      cy: c,
      r,
      fill: 'none',
      'stroke-width': esp,
      'stroke-dasharray': `${(volta * 0.14).toFixed(2)} ${volta.toFixed(2)}`,
      'stroke-dashoffset': (-volta * 0.1).toFixed(2),
    });
    const angulo = 0.17 * 2 * Math.PI;
    fatia.style.setProperty('--ux', Math.cos(angulo).toFixed(3));
    fatia.style.setProperty('--uy', Math.sin(angulo).toFixed(3));
    naTrilha.append(fatia);

    const rDentro = r - esp / 2 - 6;
    const voltaDentro = 2 * Math.PI * rDentro;
    const porDentro = criarSvg('g', { class: 'orbita orbita-dentro' });
    porDentro.append(criarSvg('circle', {
      class: 'anel-fatia cor-soltos',
      cx: c,
      cy: c,
      r: rDentro,
      fill: 'none',
      'stroke-width': 4,
      'stroke-linecap': 'round',
      'stroke-dasharray': `${(voltaDentro * 0.16).toFixed(2)} ${voltaDentro.toFixed(2)}`,
    }));

    g.append(arco, naTrilha, porDentro);
    s.append(g);
    el.anelVarredura.replaceChildren(s);
    el.arcoVarredura = arco;
  }

  // ---------- erros, foco e Explorer ----------

  function mostrarErro(msg) {
    // guarda onde estava o foco, pra devolver quando a faixa fechar
    if (el.erroGeral.hidden) estado.focoAntesDoErro = document.activeElement;
    el.erroTexto.textContent = msg;
    el.erroGeral.hidden = false;
  }

  function limparErro() {
    el.erroGeral.hidden = true;
    el.erroTexto.textContent = '';
  }

  // O botão de fechar some junto com a faixa: o foco volta pra onde estava.
  function fecharErro() {
    const antes = estado.focoAntesDoErro;
    estado.focoAntesDoErro = null;
    limparErro();
    focarOuPrincipal(antes);
  }

  function focarOuPrincipal(e) {
    if (e && e !== document.body && e.isConnected && !e.disabled && !e.closest('[hidden]')) e.focus();
    else el.principal.focus();
  }

  function erroDeCarga(e) {
    mostrarErro('Não deu pra carregar: ' + mensagem(e));
  }

  // Aviso pro leitor de tela. Esvazia antes, pra a mesma frase ser lida de novo.
  function anunciar(texto) {
    el.anuncio.textContent = '';
    setTimeout(() => {
      el.anuncio.textContent = texto;
    }, 100);
  }

  async function abrir(caminho, ehArquivo) {
    limparErro();
    try {
      const erro = await api.abrir(caminho, ehArquivo);
      if (erro) mostrarErro('Não deu pra abrir no Explorer: ' + erro);
    } catch (e) {
      mostrarErro('Não deu pra abrir no Explorer: ' + mensagem(e));
    }
  }

  // ---------- telas ----------

  function mostrarTela(nome) {
    estado.tela = nome;
    el.telaInicio.hidden = nome !== 'inicio';
    el.telaVarrendo.hidden = nome !== 'varrendo';
    el.telaResultado.hidden = nome !== 'resultado';
    const contexto = nome === 'varrendo' ? estado.alvo : nome === 'resultado' ? estado.alvoVarrido : '';
    el.tituloContexto.textContent = contexto || '';
    document.title = contexto ? contexto + ' — Cadê meu espaço?' : 'Cadê meu espaço?';
  }

  // ---------- discos e pasta ----------

  function semBarraFinal(c) {
    return String(c).replace(/[\\/]+$/, '').toLowerCase();
  }

  function acharDisco(caminho) {
    return estado.discos.find((d) => semBarraFinal(d.caminho) === semBarraFinal(caminho)) || null;
  }

  // Faixas de ocupação: até 75% tranquilo, até 90% atenção, daí pra cima crítico.
  function faixaDe(usado, total) {
    const f = total > 0 ? usado / total : 0;
    if (f >= 0.9) return 'critico';
    if (f >= 0.75) return 'atencao';
    return 'ok';
  }

  async function carregarDiscos() {
    const discos = await api.discos();
    estado.discos = Array.isArray(discos) ? discos : [];
    renderizarDiscos();
  }

  function renderizarDiscos() {
    for (const c of el.gradeDiscos.querySelectorAll('.cartao-disco')) c.remove();
    for (const d of estado.discos) el.gradeDiscos.insertBefore(cartaoDisco(d), el.cartaoPasta);
    const nenhum = estado.discos.length === 0;
    el.semDiscos.hidden = !nenhum;
    el.cartaoPasta.classList.toggle('destaque', nenhum && !estado.pastaEscolhida);
  }

  // O cartão só mostra o disco; quem varre é o botão dele. Um caminho só pra
  // mesma ação, sem "escolher" antes.
  function cartaoDisco(d) {
    const faixa = faixaDe(d.usado, d.total);
    const pct = fmt.formatarPorcentagem(d.usado, d.total);
    const livre = fmt.formatarBytes(d.livre) + ' livres de ' + fmt.formatarBytes(d.total);

    const c = criar('div', 'cartao cartao-disco');
    c.dataset.caminho = d.caminho;
    c.setAttribute('role', 'group');
    c.setAttribute('aria-label', d.caminho + ', ' + livre + ', ' + pct + ' cheio');

    const medidor = criar('div', 'disco-medidor');
    medidor.append(anel({ diametro: 72, espessura: 8, fatias: [{ frac: d.total ? d.usado / d.total : 0, cor: 'cor-' + faixa }] }));

    const info = criar('div', 'disco-info');
    info.append(caminhoMono(d.caminho, 'disco-nome'));
    info.append(criar('span', 'disco-livre', livre));
    const rodape = criar('div', 'disco-rodape');
    rodape.append(criar('span', 'selo selo-' + faixa, pct + ' cheio'));
    rodape.append(botao('Varrer', () => varrer(d.caminho), {
      classe: 'botao botao-principal btn-varrer-disco',
      icone: 'lupa',
      titulo: 'Varrer ' + d.caminho + ' agora',
      rotulo: 'Varrer ' + d.caminho,
    }));
    info.append(rodape);

    c.append(medidor, info);
    return c;
  }

  async function escolherPasta() {
    if (estado.varrendo) return;
    let pasta;
    try {
      pasta = await api.escolherPasta();
    } catch (e) {
      mostrarErro('Não deu pra abrir o seletor de pastas: ' + mensagem(e));
      return;
    }
    if (!pasta) return;
    estado.pastaEscolhida = pasta;
    renderizarCartaoPasta();
    // o cartão deixou de ser botão: o foco vai pro Varrer dele
    if (document.activeElement === el.cartaoPasta || document.activeElement === document.body) el.btnVarrerPasta.focus();
  }

  function renderizarCartaoPasta() {
    const p = estado.pastaEscolhida;
    el.cartaoPasta.classList.toggle('escolhida', !!p);
    el.cartaoPasta.classList.toggle('destaque', !p && estado.discos.length === 0);
    el.pastaTitulo.textContent = p ? 'Pasta escolhida' : 'Escolher uma pasta…';
    el.pastaDescricao.replaceChildren(p ? caminhoMono(p) : document.createTextNode('Varre só uma pasta em vez do disco inteiro.'));
    el.pastaAcoes.hidden = !p;
    // Sem pasta, o cartão inteiro é o botão que abre o seletor. Com pasta,
    // Trocar… e Varrer fazem as ações e o cartão só agrupa.
    if (p) {
      el.cartaoPasta.setAttribute('role', 'group');
      el.cartaoPasta.setAttribute('aria-label', 'Pasta escolhida: ' + p);
      el.cartaoPasta.removeAttribute('tabindex');
    } else {
      el.cartaoPasta.setAttribute('role', 'button');
      el.cartaoPasta.setAttribute('aria-label', 'Escolher uma pasta pra varrer');
      el.cartaoPasta.tabIndex = 0;
    }
  }

  function aoAtivarCartaoPasta() {
    if (!estado.pastaEscolhida) escolherPasta();
  }

  // De volta ao início, o foco vai pro Varrer do alvo de antes (ou do primeiro
  // cartão), pra quem usa teclado não recomeçar do topo da página.
  function focarVarrerDoInicio(alvo) {
    const cartao = Array.from(el.gradeDiscos.querySelectorAll('.cartao-disco'))
      .find((c) => alvo && semBarraFinal(c.dataset.caminho) === semBarraFinal(alvo));
    let b = cartao ? cartao.querySelector('.btn-varrer-disco') : null;
    if (!b && estado.pastaEscolhida && alvo === estado.pastaEscolhida) b = el.btnVarrerPasta;
    if (!b) b = el.gradeDiscos.querySelector('.btn-varrer-disco') || (estado.pastaEscolhida ? el.btnVarrerPasta : el.cartaoPasta);
    b.focus();
  }

  // ---------- varredura ----------

  function travar(varrendo) {
    estado.varrendo = varrendo;
    el.btnParar.disabled = false;
    el.pararTexto.textContent = 'Parar';
    el.btnDeNovo.disabled = varrendo;
    el.btnNova.disabled = varrendo;
    el.btnSubir.disabled = varrendo || !(estado.pastaAtual && estado.pastaAtual.pai);
  }

  function prepararPainelVarredura(alvo) {
    const disco = estado.discoDaVarredura;
    el.pAlvo.replaceChildren(caminhoMono(alvo));
    el.pReferencia.textContent = disco
      ? 'somados, de uns ' + fmt.formatarBytes(disco.usado) + ' que o disco diz estar usados'
      : 'somados até agora';
    // disco inteiro: o arco mostra quanto do "usado" já foi somado.
    // Pasta: não dá pra saber o total, então só a fatia âmbar gira.
    el.anelVarredura.classList.toggle('indeterminado', !disco);
    el.arcoVarredura.style.strokeDasharray = `0 ${estado.voltaVarredura}`;
  }

  function atualizarProgresso(p) {
    if (!estado.varrendo || !p) return; // evento atrasado depois do fim
    el.pPastas.textContent = fmt.formatarNumero(p.pastas);
    el.pArquivos.textContent = fmt.formatarNumero(p.arquivos);
    el.pBytes.textContent = fmt.formatarBytes(p.bytes);
    el.pErros.textContent = fmt.formatarNumero(p.semPermissao);
    el.pErros.parentElement.classList.toggle('tem', p.semPermissao > 0);
    el.pAtual.replaceChildren(caminhoMono(p.atual || ''));
    const disco = estado.discoDaVarredura;
    if (disco && disco.usado > 0) {
      // nunca fecha o anel antes do fim: a soma costuma ficar abaixo do "usado"
      const frac = Math.min(0.97, p.bytes / disco.usado);
      const volta = estado.voltaVarredura;
      el.arcoVarredura.style.strokeDasharray = `${(frac * volta).toFixed(2)} ${volta.toFixed(2)}`;
    }
  }

  async function varrer(alvo) {
    if (estado.varrendo || !alvo) return;
    const geracao = ++estado.geracao;
    estado.alvo = alvo;
    limparErro();
    estado.resumo = null;
    estado.pastaAtual = null;
    estado.abasCarregadas.clear();
    limparVistas(); // nada da varredura anterior fica pra trás, nem escondido
    estado.discoDaVarredura = acharDisco(alvo);
    prepararPainelVarredura(alvo);
    travar(true);
    atualizarProgresso({ pastas: 0, arquivos: 0, bytes: 0, semPermissao: 0, atual: alvo });
    mostrarTela('varrendo');
    el.btnParar.focus();
    anunciar('Varrendo ' + alvo + '.');

    try {
      const resumo = await api.varrer(alvo);
      if (geracao !== estado.geracao) return;
      // o disco pode ter mudado desde a lista (a pessoa apagou coisa no Explorer)
      try {
        const discos = await api.discos();
        if (Array.isArray(discos)) {
          estado.discos = discos;
          renderizarDiscos();
        }
      } catch {
        // fica a lista anterior
      }
      estado.resumo = resumo;
      estado.alvoVarrido = alvo;
      mostrarResumo(resumo);
      mostrarTela('resultado');
      el.telaResultado.scrollTop = 0;
      trocarAba('pastas');
      anunciar(fraseDoFim(resumo));
      await navegar(resumo.raiz);
      // o Parar sumiu com a tela de varredura: o foco vai pras abas
      if (!el.telaResultado.contains(document.activeElement)) el.botoesAba[0].focus();
    } catch (e) {
      mostrarErro('Não deu pra varrer: ' + mensagem(e));
      mostrarTela('inicio');
      focarVarrerDoInicio(alvo);
    } finally {
      travar(false);
    }
  }

  function fraseDoFim(r) {
    const t = r.totais;
    let frase = r.parou
      ? 'Varredura interrompida: ' + fmt.formatarBytes(t.bytes) + ' somados até o Parar. Os números são parciais.'
      : 'Varredura concluída: ' + fmt.formatarBytes(t.bytes) + ' somados em ' + fmt.plural(t.arquivos, 'arquivo') + '.';
    if (t.semPermissao) frase += ' ' + fmt.formatarNumero(t.semPermissao) + ' sem permissão de leitura ficaram de fora.';
    return frase;
  }

  // O "Parando…" fica até a varredura voltar de fato: quem desfaz é o
  // travar(false) no fim do varrer(), não a resposta rápida do pedido.
  function parar() {
    el.btnParar.disabled = true;
    el.pararTexto.textContent = 'Parando…';
    Promise.resolve()
      .then(() => api.parar())
      .catch((e) => {
        el.btnParar.disabled = false;
        el.pararTexto.textContent = 'Parar';
        mostrarErro('Não deu pra parar: ' + mensagem(e));
      });
  }

  function novaVarredura() {
    if (estado.varrendo) return;
    limparErro();
    mostrarTela('inicio');
    const alvo = estado.alvoVarrido;
    focarVarrerDoInicio(alvo);
    // espaço livre pode ter mudado depois de apagar coisa
    carregarDiscos()
      .then(() => {
        // os cartões foram refeitos e o botão focado sumiu com eles
        if (document.activeElement === document.body) focarVarrerDoInicio(alvo);
      })
      .catch((e) => {
        mostrarErro('Não deu pra listar os discos: ' + mensagem(e));
        renderizarDiscos();
      });
  }

  function varrerDeNovo() {
    if (estado.varrendo || !estado.alvoVarrido) return;
    varrer(estado.alvoVarrido);
  }

  // ---------- resumo ----------

  function chip(nomeIcone, texto, titulo) {
    const c = criar('span', 'chip');
    c.append(icone(nomeIcone), criar('span', null, texto));
    if (titulo) c.title = titulo;
    return c;
  }

  function aviso(tipo, nomeIcone, texto, acao) {
    const a = criar('div', 'aviso-inline aviso-' + tipo);
    a.append(icone(nomeIcone), criar('span', 'aviso-texto', texto));
    if (acao) a.append(acao);
    return a;
  }

  // Quantos ficaram de fora por falta de permissão, num chip que leva pra aba
  // "Sem permissão". Cabe numa linha só, pra sobrar altura pra lista.
  function chipSemPermissao(n) {
    const frase = fmt.formatarNumero(n) + (n === 1
      ? ' pasta ou arquivo sem permissão de leitura ficou de fora da soma.'
      : ' pastas ou arquivos sem permissão de leitura ficaram de fora da soma.');
    const b = botao(fmt.formatarNumero(n) + ' sem permissão', () => trocarAba('erros', true), {
      classe: 'chip chip-aviso',
      icone: 'cadeado',
      titulo: frase + ' Clique pra ver quais.',
    });
    b.id = 'chip-sem-permissao';
    b.append(icone('seta', 'chip-seta'));
    return b;
  }

  function mostrarResumo(r) {
    const t = r.totais;
    const disco = acharDisco(r.raiz);

    el.resumoAlvo.replaceChildren(
      icone(disco ? 'disco' : 'pasta'),
      caminhoMono(r.raiz),
      criar('span', 'resumo-tipo', disco ? 'disco inteiro' : 'pasta'),
    );

    el.resumo.replaceChildren();
    el.resumo.classList.toggle('com-disco', !!disco);

    const principal = criar('div', 'resumo-principal');
    const total = criar('p', 'resumo-total');
    total.append(
      criar('span', 'numero-destaque', fmt.formatarBytes(t.bytes)),
      criar('span', 'resumo-total-rotulo',
        (r.parou ? 'somados até o Parar, em ' : 'somados em ') +
        fmt.plural(t.arquivos, 'arquivo') + ' e ' + fmt.plural(t.pastas, 'pasta')),
    );
    const chips = criar('div', 'chips');
    chips.append(chip('relogio', 'levou ' + fmt.formatarDuracao(r.duracaoMs), 'Tempo da varredura'));
    if (t.semPermissao) chips.append(chipSemPermissao(t.semPermissao));
    principal.append(total, chips);
    el.resumo.append(principal);

    if (disco) el.resumo.append(comparacaoComDisco(disco, t.bytes, r.parou));

    if (r.parou) {
      const a = aviso('atencao', 'aviso', 'Varredura interrompida no Parar: os números são parciais.');
      a.id = 'aviso-parcial';
      a.classList.add('resumo-aviso');
      el.resumo.append(a);
    }

    el.contadorErros.textContent = fmt.formatarNumero(t.semPermissao);
    el.contadorErros.classList.toggle('zero', !t.semPermissao);
  }

  // O que o disco diz (usado, livre) contra o que a varredura somou, numa
  // barra só, e a explicação da diferença quando ela passa de 1% do disco.
  function comparacaoComDisco(disco, soma, parou) {
    const caixa = criar('div', 'cartao comparacao');
    caixa.setAttribute('role', 'group');
    caixa.setAttribute('aria-label', 'Comparado com o que o disco diz');

    const somadoNoUsado = Math.min(soma, disco.usado);
    const fora = Math.max(0, disco.usado - soma);
    const barra = criar('div', 'barra-empilhada');
    barra.setAttribute('role', 'img');
    barra.setAttribute('aria-label',
      'Somado ' + fmt.formatarBytes(soma) + ', usado ' + fmt.formatarBytes(disco.usado) + ', livre ' + fmt.formatarBytes(disco.livre) + ' de ' + fmt.formatarBytes(disco.total));
    // a legenda embaixo explica os pedaços; o title repete, pra quem passa o mouse
    const segmento = (classe, valor, rotulo) => {
      if (valor <= 0) return;
      const s = criar('span', 'seg ' + classe);
      s.style.flexGrow = String(valor / disco.total);
      s.title = rotulo + ': ' + fmt.formatarBytes(valor);
      barra.append(s);
    };
    segmento('seg-somado', somadoNoUsado, 'Somado na varredura');
    segmento('seg-fora', fora, 'Usado, mas fora da soma');
    segmento('seg-livre', disco.livre, 'Livre');
    caixa.append(barra);

    const legenda = criar('ul', 'legenda');
    const item = (classe, rotulo, valor) => {
      const li = criar('li');
      li.append(criar('span', 'ponto ' + classe), criar('span', null, rotulo), criar('strong', null, fmt.formatarBytes(valor)));
      legenda.append(li);
    };
    item('seg-somado', 'Somado na varredura', soma);
    if (fora > 0) item('seg-fora', 'Usado, mas fora da soma', fora);
    item('seg-livre', 'Livre', disco.livre);

    // Legenda, frase e "Por que" dividem um bloco que quebra linha: em janela
    // baixa a frase sai e o "Por que" sobe pra linha da legenda (style.css).
    // O livre já está na legenda, então a frase fica com usado e total.
    const rodape = criar('div', 'comparacao-rodape');
    rodape.append(legenda, criar('p', 'disco-diz',
      'O disco diz: ' + fmt.formatarBytes(disco.usado) + ' usados de ' + fmt.formatarBytes(disco.total) +
      ' (' + fmt.formatarPorcentagem(disco.usado, disco.total) + ' cheio).'));
    caixa.append(rodape);

    const diferenca = disco.usado - soma;
    if (Math.abs(diferenca) > disco.total * LIMIAR_DIFERENCA) {
      let texto;
      if (diferenca > 0 && parou) {
        texto = 'A varredura somou ' + fmt.formatarBytes(diferenca) + ' a menos do que o disco diz estar usado, ' +
          'porque foi interrompida antes do fim. Varra de novo sem parar pra ver o total.';
      } else if (diferenca > 0) {
        texto = 'A varredura somou ' + fmt.formatarBytes(diferenca) + ' a menos do que o disco diz estar usado. ' +
          'Essa diferença fica em coisas que o Windows não deixa ler (pagefile.sys, hiberfil.sys, pontos de restauração, ' +
          'lixeira de outros usuários) e no que o próprio sistema de arquivos reserva.';
      } else {
        texto = 'A varredura somou ' + fmt.formatarBytes(-diferenca) + ' a mais do que o disco diz estar usado. ' +
          'Arquivos com vários nomes (links físicos, comuns em C:\\Windows\\WinSxS) contam uma vez por nome, ' +
          'e arquivos do OneDrive que estão só na nuvem contam com o tamanho cheio.';
      }
      // a explicação fica recolhida pra o resumo caber em janela pequena
      const explicacao = criar('p', 'porque-texto', texto);
      explicacao.id = 'porque-texto';
      explicacao.hidden = true;
      const porque = criar('button', 'porque');
      porque.type = 'button';
      porque.setAttribute('aria-expanded', 'false');
      porque.setAttribute('aria-controls', explicacao.id);
      porque.append(icone('seta'), criar('span', null, 'Por que a soma é diferente?'));
      porque.addEventListener('click', () => {
        const abrir = explicacao.hidden;
        explicacao.hidden = !abrir;
        porque.setAttribute('aria-expanded', String(abrir));
      });
      rodape.append(porque);
      caixa.append(explicacao);
    }
    return caixa;
  }

  // ---------- abas ----------

  function limparVistas() {
    for (const l of [el.listaPastas, el.listaArquivos, el.listaPesadas, el.listaErros, el.cabecalhoPasta, el.trilha]) l.replaceChildren();
    for (const n of el.abaErros.querySelectorAll('.nota-limite')) n.remove();
    el.anelPasta = null;
  }

  // Leva a lista pro começo sem esconder o resumo à toa: se a pessoa já rolou
  // além dele, volta só até a barra de abas, que fica grudada no topo.
  function rolarProComecoDaVista() {
    const limite = el.sentinela.offsetTop;
    if (el.telaResultado.scrollTop > limite) el.telaResultado.scrollTop = limite;
  }

  function trocarAba(nome, focar) {
    const mudou = estado.aba !== nome;
    estado.aba = nome;
    for (const b of el.botoesAba) {
      const ativa = b.dataset.aba === nome;
      b.setAttribute('aria-selected', String(ativa));
      b.tabIndex = ativa ? 0 : -1;
      if (ativa && focar) b.focus();
    }
    el.abaPastas.hidden = nome !== 'pastas';
    el.abaArquivos.hidden = nome !== 'arquivos';
    el.abaPesadas.hidden = nome !== 'pesadas';
    el.abaErros.hidden = nome !== 'erros';
    el.navegacao.hidden = nome !== 'pastas';
    if (mudou) rolarProComecoDaVista();

    // cada aba pede os dados uma vez por varredura
    const pedidos = {
      arquivos: [el.listaArquivos, () => api.maioresArquivos(), renderizarMaioresArquivos],
      pesadas: [el.listaPesadas, () => api.pastasMaisPesadas(), renderizarPesadas],
      erros: [el.listaErros, () => api.semPermissao(), renderizarErros],
    };
    if (!estado.resumo || !pedidos[nome] || estado.abasCarregadas.has(nome)) return;
    estado.abasCarregadas.add(nome);
    const [lista, pedir, renderizar] = pedidos[nome];
    const geracao = estado.geracao;
    lista.replaceChildren(nota('Carregando…', true));
    Promise.resolve()
      .then(pedir)
      .then((dados) => {
        if (geracao === estado.geracao) renderizar(dados || []);
      })
      .catch((e) => {
        if (geracao !== estado.geracao) return; // erro de uma varredura que já passou
        // sem a marca de carregada, voltar pra aba tenta de novo
        estado.abasCarregadas.delete(nome);
        lista.replaceChildren(vazio('Não deu pra carregar esta lista. Troque de aba e volte pra tentar de novo.', 'erro', 'vazio-erro'));
        erroDeCarga(e);
      });
  }

  // Setas, Home e End andam entre as abas (padrão de tablist).
  function teclaNasAbas(ev) {
    if (ev.altKey || ev.ctrlKey || ev.metaKey) return;
    const i = el.botoesAba.indexOf(document.activeElement);
    if (i < 0) return;
    const n = el.botoesAba.length;
    let j = null;
    if (ev.key === 'ArrowRight') j = (i + 1) % n;
    else if (ev.key === 'ArrowLeft') j = (i - 1 + n) % n;
    else if (ev.key === 'Home') j = 0;
    else if (ev.key === 'End') j = n - 1;
    if (j === null) return;
    ev.preventDefault();
    trocarAba(el.botoesAba[j].dataset.aba, true);
  }

  // ---------- linhas das listas ----------

  // Uma linha de lista: marcador (ícone ou posição), nome com detalhe embaixo,
  // células extras (barra, tamanho, %...) e ações. As colunas de cada tipo de
  // lista ficam no CSS, então as linhas de uma lista se alinham.
  function linha(o) {
    const l = criar('div', 'linha' + (o.classe ? ' ' + o.classe : '') + (o.cor ? ' ' + o.cor : ''));
    l.setAttribute('role', 'listitem');
    if (o.caminho) l.dataset.caminho = o.caminho;

    const marcador = criar('span', 'marcador');
    if (o.rank) marcador.append(criar('span', 'rank', String(o.rank)));
    else if (o.icone) marcador.append(icone(o.icone));
    l.append(marcador);

    const texto = criar('div', 'texto');
    const linhaNome = criar('div', 'linha-nome');
    let nome;
    if (o.aoClicar) {
      // Linha que faz algo: o nome é o botão dela. É ele que o Tab, as setas
      // e o leitor de tela alcançam; clicar no resto da linha é atalho do mouse.
      nome = criar('button', 'nome');
      nome.type = 'button';
      nome.append(criar('span', 'nome-texto', o.nome));
      if (o.expansivel) nome.append(icone('seta', 'expande'));
    } else {
      nome = criar('span', 'nome', o.nome);
    }
    if (o.titulo) nome.title = o.titulo;
    linhaNome.append(nome);
    texto.append(linhaNome);
    if (o.detalhe) {
      const d = criar('div', 'detalhe');
      for (const parte of [].concat(o.detalhe)) d.append(typeof parte === 'string' ? criar('span', null, parte) : parte);
      texto.append(d);
    }
    l.append(texto);

    for (const c of o.celulas || []) l.append(c);

    const acoes = criar('div', 'acoes');
    for (const b of o.acoes || []) acoes.append(b);
    l.append(acoes);

    if (o.aoClicar) {
      l.classList.add('clicavel');
      l.addEventListener('click', (ev) => {
        // clique com detail 0 no botão do nome veio do Enter ou do Espaço
        o.aoClicar(ev.detail === 0 && nome.contains(ev.target));
      });
    }
    if (o.fatia) {
      const realce = () => realcarFatia(o.fatia);
      const semRealce = () => realcarFatia(null);
      l.addEventListener('mouseenter', realce);
      l.addEventListener('mouseleave', semRealce);
      l.addEventListener('focusin', realce);
      l.addEventListener('focusout', semRealce);
    }
    return l;
  }

  function celulaBarra(frac) {
    const b = criar('div', 'barra');
    const miolo = criar('div', 'barra-miolo');
    miolo.style.width = pctCss(frac);
    b.append(miolo);
    return b;
  }

  function celula(classe, texto) {
    return criar('div', classe, texto);
  }

  // Seta pra cima/baixo passa o foco pro nome da linha vizinha da mesma lista.
  function moverFoco(atual, passo) {
    const lista = atual.closest('.lista');
    if (!lista) return;
    const botoes = Array.from(lista.querySelectorAll('.linha.clicavel button.nome'));
    const proximo = botoes[botoes.indexOf(atual) + passo];
    if (proximo) proximo.focus();
  }

  // ---------- vista Pastas ----------

  // Cor de cada subpasta: as maiores ganham cor própria, o resto fica neutro.
  // A mesma classe pinta a fatia do anel, o ícone e a barra da linha.
  function coresDaPasta(d) {
    const cores = new Map();
    let n = 0;
    for (const f of d.filhos) {
      if (f.tamanho > 0 && n < CORES) cores.set(f.caminho, 'cor-' + ++n);
      else cores.set(f.caminho, 'cor-outras');
    }
    return cores;
  }

  function fatiasDaPasta(d, cores) {
    const total = d.tamanho;
    if (!total) return [];
    const fatias = [];
    let outras = 0;
    for (const f of d.filhos) {
      const cor = cores.get(f.caminho);
      if (cor === 'cor-outras') outras += f.tamanho;
      else fatias.push({ frac: f.tamanho / total, cor, chave: f.caminho });
    }
    if (outras > 0) fatias.push({ frac: outras / total, cor: 'cor-outras', chave: 'outras' });
    // os arquivos soltos fecham o anel, puxados pra fora como a fatia do logo
    if (d.tamanhoArquivos > 0) fatias.push({ frac: d.tamanhoArquivos / total, cor: 'cor-soltos', chave: 'soltos', puxada: true });
    return fatias;
  }

  function realcarFatia(chave) {
    const a = el.anelPasta;
    if (!a) return;
    a.classList.toggle('com-realce', !!chave);
    for (const f of a.querySelectorAll('.anel-fatia')) f.classList.toggle('realcada', !!chave && f.dataset.chave === chave);
  }

  // opcoes.focar: 'primeira' (primeira linha), 'trilha' (a pasta atual na
  // trilha) ou o caminho de uma linha. opcoes.origem: a pasta de onde se subiu.
  async function navegar(caminho, opcoes = {}) {
    limparErro();
    const focoAntes = document.activeElement;
    const pedido = ++estado.pedidoPasta;
    const geracao = estado.geracao;
    let dados;
    try {
      dados = await api.filhos(caminho);
    } catch (e) {
      erroDeCarga(e);
      return;
    }
    if (pedido !== estado.pedidoPasta || geracao !== estado.geracao) return;
    if (!dados) {
      mostrarErro('Essa pasta não está na varredura: ' + caminho);
      return;
    }
    estado.pastaAtual = dados;
    const cores = coresDaPasta(dados);
    renderizarTrilha(dados.trilha);
    renderizarCabecalho(dados, cores);
    renderizarPastas(dados, cores);
    el.btnSubir.disabled = !dados.pai || estado.varrendo;
    rolarProComecoDaVista();
    if (opcoes.focar === 'trilha') focarTrilha();
    else if (opcoes.focar) focarLinha(opcoes.focar);
    // Subir chegou na raiz e ficou desabilitado: o foco não pode ficar nele
    else if (focoAntes === el.btnSubir && el.btnSubir.disabled && opcoes.origem) focarLinha(opcoes.origem);
  }

  // Depois de navegar pelo teclado, o foco vai pra primeira linha ou pra
  // pasta de onde a pessoa acabou de subir (como no Explorer).
  function focarLinha(alvo) {
    const linhas = Array.from(el.listaPastas.querySelectorAll('.linha.clicavel'));
    const escolhida = linhas.find((l) => l.dataset.caminho === alvo) || linhas[0];
    if (escolhida) escolhida.querySelector('button.nome').focus();
    else focarTrilha(); // pasta vazia: não tem linha pra focar
  }

  // Os itens da trilha são refeitos a cada pasta, então o clicado some.
  function focarTrilha() {
    const atual = el.trilha.querySelector('.trilha-item.atual');
    if (atual) atual.focus();
  }

  function renderizarTrilha(trilha) {
    const lista = criar('ol', 'trilha-lista');
    trilha.forEach((p, i) => {
      const item = criar('li');
      if (i > 0) item.append(icone('seta', 'trilha-sep'));
      const ultimo = i === trilha.length - 1;
      // a raiz aparece só pelo nome; o caminho inteiro está no title e no resumo
      const b = botao(i === 0 ? nomeDe(p.nome) : p.nome, () => {
        if (!ultimo) navegar(p.caminho, { focar: 'trilha' });
      }, { classe: 'trilha-item', titulo: p.caminho });
      if (ultimo) {
        b.classList.add('atual');
        b.setAttribute('aria-current', 'page');
      }
      item.append(b);
      lista.append(item);
    });
    el.trilha.replaceChildren(lista);
  }

  function renderizarCabecalho(d, cores) {
    const naRaiz = !d.pai;
    const medidor = criar('div', 'cabecalho-anel');
    el.anelPasta = anel({ diametro: 64, espessura: 10, fatias: fatiasDaPasta(d, cores) });
    medidor.append(el.anelPasta);

    const info = criar('div', 'cabecalho-info');
    info.append(criar('h2', 'cabecalho-nome', nomeDe(d.caminho)));
    if (naRaiz) {
      // total e contagens da raiz já estão no resumo, logo acima
      if (d.tamanho > 0) info.append(criar('p', 'cabecalho-conteudo', 'Cada cor do anel é uma linha da lista abaixo.'));
    } else {
      const dados = criar('div', 'cabecalho-dados');
      dados.append(criar('p', 'cabecalho-tamanho', fmt.formatarBytes(d.tamanho)));
      const conteudo = criar('p', 'cabecalho-conteudo');
      conteudo.append(
        criar('span', null, fmt.plural(d.nArquivosTotal, 'arquivo') + ' e ' + fmt.plural(d.nPastasTotal, 'pasta') + ' dentro de'),
        caminhoMono(d.caminho),
      );
      dados.append(conteudo);
      info.append(dados);
    }
    if (d.erro) {
      const a = aviso('aviso', 'cadeado', 'Não deu pra ler esta pasta: ' + motivoErro(d.erro) + '.');
      a.title = 'Código do erro: ' + d.erro;
      info.append(a);
    }

    const acoes = criar('div', 'cabecalho-acoes');
    acoes.append(botao('Abrir no Explorer', () => abrir(d.caminho, false),
      { classe: 'botao botao-secundario', icone: 'abrir', titulo: 'Abrir esta pasta no Explorer do Windows' }));

    el.cabecalhoPasta.replaceChildren(medidor, info, acoes);
  }

  function renderizarPastas(d, cores) {
    el.listaPastas.replaceChildren();

    if (!d.filhos.length && !d.nArquivos) {
      let texto = 'Pasta vazia.';
      if (d.erro) texto = 'Não deu pra ler o conteúdo desta pasta.';
      else if (estado.resumo && estado.resumo.parou) texto = 'Nada somado aqui: a pasta está vazia ou a varredura parou antes de chegar nela.';
      el.listaPastas.append(vazio(texto, d.erro ? 'cadeado' : 'pasta-contorno'));
      return;
    }

    const total = d.tamanho || 1;
    for (const f of d.filhos) {
      let celulas;
      let detalhe;
      if (f.erro) {
        // o tamanho é desconhecido, não zero: nada de "0 B" nem barra
        const tam = celula('tam', '—');
        tam.title = 'Tamanho desconhecido: o Windows não deixou ler';
        celulas = [celulaBarra(0), tam, celula('pct', '')];
        detalhe = criar('span', 'motivo', motivoErro(f.erro));
        detalhe.title = 'Código do erro: ' + f.erro;
      } else {
        celulas = [
          celulaBarra(f.tamanho / total),
          celula('tam', fmt.formatarBytes(f.tamanho)),
          celula('pct', fmt.formatarPorcentagem(f.tamanho, total)),
        ];
        detalhe = fmt.plural(f.nArquivosTotal, 'arquivo') + ', ' + fmt.plural(f.nPastasTotal, 'pasta');
      }
      const cor = f.erro ? '' : cores.get(f.caminho);
      el.listaPastas.append(linha({
        classe: f.erro ? 'trancada' : '',
        cor,
        icone: f.erro ? 'cadeado' : 'pasta',
        caminho: f.caminho,
        nome: f.nome,
        titulo: f.caminho,
        detalhe,
        celulas,
        acoes: [botaoExplorer(f.caminho, false)],
        aoClicar: (teclado) => navegar(f.caminho, { focar: teclado ? 'primeira' : null }),
        fatia: f.erro ? null : cor === 'cor-outras' ? 'outras' : f.caminho,
      }));
    }

    if (d.nArquivos) {
      const caixa = criar('div', 'arquivos-caixa');
      caixa.id = 'arquivos-soltos-lista';
      caixa.setAttribute('role', 'listitem');
      let aberto = false;
      const rotulo = () => fmt.plural(d.nArquivos, 'arquivo') + (aberto ? ' · clique pra recolher' : ' · clique pra listar');
      // Sem "No Explorer" aqui: seria a mesma pasta do "Abrir no Explorer" do cabeçalho.
      const l = linha({
        classe: 'arquivos-soltos',
        cor: 'cor-soltos',
        icone: 'arquivos',
        nome: 'Arquivos soltos nesta pasta',
        titulo: 'Arquivos que estão direto em ' + d.caminho + ', sem contar subpastas',
        detalhe: rotulo(),
        expansivel: true,
        celulas: [
          celulaBarra(d.tamanhoArquivos / total),
          celula('tam', fmt.formatarBytes(d.tamanhoArquivos)),
          celula('pct', fmt.formatarPorcentagem(d.tamanhoArquivos, total)),
        ],
        aoClicar: () => {
          aberto = !aberto;
          botaoNome.setAttribute('aria-expanded', String(aberto));
          l.classList.toggle('aberta', aberto);
          l.querySelector('.detalhe > span').textContent = rotulo();
          if (aberto) mostrarArquivosSoltos(d.caminho, caixa, total, () => aberto);
          else caixa.replaceChildren();
        },
        fatia: 'soltos',
      });
      const botaoNome = l.querySelector('button.nome');
      botaoNome.setAttribute('aria-expanded', 'false');
      botaoNome.setAttribute('aria-controls', caixa.id);
      el.listaPastas.append(l, caixa);
    }
  }

  // A árvore não guarda arquivo: a lista é lida na hora, então reflete o
  // disco de agora (se a pessoa apagou algo no Explorer, já some daqui).
  // Barra e % são da pasta aberta inteira, como nas linhas de pasta: as
  // colunas são as mesmas e têm que querer dizer a mesma coisa.
  async function mostrarArquivosSoltos(caminho, caixa, totalDaPasta, aindaAberto) {
    caixa.replaceChildren(nota('Lendo…'));
    const pedido = estado.pedidoPasta;
    let r;
    try {
      r = await api.arquivosDe(caminho, LIMITE_ARQUIVOS);
    } catch (e) {
      caixa.replaceChildren(nota('Não deu pra ler: ' + mensagem(e)));
      return;
    }
    if (pedido !== estado.pedidoPasta || !aindaAberto()) return;
    caixa.replaceChildren();
    if (r.erro) {
      const n = nota('Não deu pra ler esta pasta agora: ' + motivoErro(r.erro) + '.');
      n.title = 'Código do erro: ' + r.erro;
      caixa.append(n);
      return;
    }
    if (!r.arquivos.length) {
      caixa.append(nota('Nenhum arquivo solto aqui agora. Talvez tenham sido apagados depois da varredura.'));
      return;
    }
    const lista = criar('div', 'arquivos-lista');
    lista.setAttribute('role', 'list');
    lista.setAttribute('aria-label', 'Arquivos soltos, do maior pro menor');
    const base = totalDaPasta || r.tamanhoTotal || 1;
    for (const a of r.arquivos) {
      lista.append(linha({
        classe: 'linha-arquivo',
        cor: 'cor-soltos',
        icone: 'arquivo',
        caminho: a.caminho,
        nome: a.nome,
        titulo: a.caminho,
        detalhe: 'modificado em ' + fmt.formatarData(a.modificado),
        celulas: [
          celulaBarra(a.tamanho / base),
          celula('tam', fmt.formatarBytes(a.tamanho)),
          celula('pct', fmt.formatarPorcentagem(a.tamanho, base)),
        ],
        acoes: [botaoExplorer(a.caminho, true)],
      }));
    }
    caixa.append(lista);
    if (r.total > r.arquivos.length) {
      caixa.append(nota('Mostrando os ' + fmt.formatarNumero(r.arquivos.length) + ' maiores de ' + fmt.formatarNumero(r.total) + ' arquivos.'));
    }
  }

  function subir(teclado) {
    const atual = estado.pastaAtual;
    if (!atual || !atual.pai || estado.varrendo) return;
    navegar(atual.pai, { focar: teclado ? atual.caminho : null, origem: atual.caminho });
  }

  // Vindo das outras vistas: o botão ou a linha clicada some com a troca de
  // aba, então o foco vai pra primeira linha da pasta.
  function irParaPasta(caminho, focar) {
    trocarAba('pastas');
    navegar(caminho, { focar: focar ? 'primeira' : null });
  }

  // ---------- vista Maiores arquivos ----------

  function renderizarMaioresArquivos(lista) {
    el.listaArquivos.replaceChildren();
    if (!lista.length) {
      el.listaArquivos.append(vazio('Nenhum arquivo encontrado.', 'arquivo'));
      return;
    }
    const maior = lista[0].tamanho || 1;
    lista.forEach((a, i) => {
      el.listaArquivos.append(linha({
        // âmbar é só dos arquivos soltos: o ranking inteiro fica no violeta
        cor: 'cor-acento',
        rank: i + 1,
        caminho: a.caminho,
        nome: a.nome,
        titulo: a.caminho,
        detalhe: [caminhoMono(a.pasta), criar('span', 'data', 'modificado em ' + fmt.formatarData(a.modificado))],
        celulas: [celulaBarra(a.tamanho / maior), celula('tam', fmt.formatarBytes(a.tamanho))],
        acoes: [
          botaoExplorer(a.caminho, true),
          botaoIrAte(a.pasta, 'Ver a pasta dele aqui no app'),
        ],
        aoClicar: (teclado) => irParaPasta(a.pasta, teclado),
      }));
    });
  }

  // ---------- vista Pastas mais pesadas ----------

  function renderizarPesadas(lista) {
    el.listaPesadas.replaceChildren();
    if (!lista.length) {
      el.listaPesadas.append(vazio('Nenhuma pasta com arquivos.', 'pasta-contorno'));
      return;
    }
    const maior = lista[0].tamanho || 1;
    lista.forEach((p, i) => {
      const pai = pastaDe(p.caminho);
      const detalhe = [];
      if (pai && semBarraFinal(pai) !== semBarraFinal(p.caminho)) detalhe.push(caminhoMono(pai));
      detalhe.push(criar('span', null, fmt.plural(p.nArquivos, 'arquivo solto', 'arquivos soltos')));
      el.listaPesadas.append(linha({
        cor: 'cor-acento',
        rank: i + 1,
        caminho: p.caminho,
        nome: nomeDe(p.caminho),
        titulo: p.caminho,
        detalhe,
        celulas: [celulaBarra(p.tamanho / maior), celula('tam', fmt.formatarBytes(p.tamanho))],
        acoes: [
          botaoExplorer(p.caminho, false),
          botaoIrAte(p.caminho, 'Ver esta pasta aqui no app'),
        ],
        aoClicar: (teclado) => irParaPasta(p.caminho, teclado),
      }));
    });
  }

  // ---------- vista Sem permissão ----------

  function renderizarErros(lista) {
    el.listaErros.replaceChildren();
    const vista = el.abaErros;
    for (const n of vista.querySelectorAll('.nota-limite')) n.remove();
    if (!lista.length) {
      el.listaErros.append(vazio('Tudo foi lido. Nenhuma pasta ou arquivo ficou de fora.', 'ok', 'vazio-ok'));
      return;
    }
    for (const e of lista) {
      const pai = pastaDe(e.caminho);
      const selo = criar('span', 'selo selo-aviso', motivoErro(e.codigo));
      selo.title = 'Código do erro: ' + e.codigo;
      el.listaErros.append(linha({
        classe: 'trancada',
        icone: 'cadeado',
        caminho: e.caminho,
        nome: nomeDe(e.caminho),
        titulo: e.caminho,
        detalhe: pai && semBarraFinal(pai) !== semBarraFinal(e.caminho) ? [caminhoMono(pai)] : null,
        celulas: [selo],
        acoes: [botaoExplorer(e.caminho, false, 'Tentar abrir no Explorer')],
      }));
    }
    // a varredura guarda até 1.000 itens; o total vem no resumo
    const total = estado.resumo ? estado.resumo.totais.semPermissao : lista.length;
    if (total > lista.length) {
      const n = nota('Mostrando os primeiros ' + fmt.formatarNumero(lista.length) + ' de ' + fmt.formatarNumero(total) + ' itens.');
      n.classList.add('nota-limite');
      vista.append(n);
    }
  }

  // ---------- teclado ----------

  function teclaGeral(ev) {
    const alvo = ev.target;
    const ehCampo = alvo && (alvo.tagName === 'INPUT' || alvo.tagName === 'SELECT' || alvo.tagName === 'TEXTAREA' || alvo.isContentEditable);
    if (ehCampo) return;
    const naVistaPastas = estado.tela === 'resultado' && estado.aba === 'pastas';
    if (naVistaPastas && (ev.key === 'Backspace' || (ev.altKey && ev.key === 'ArrowLeft'))) {
      ev.preventDefault();
      subir(true);
      return;
    }
    if ((ev.key === 'ArrowDown' || ev.key === 'ArrowUp') && !ev.altKey && alvo.matches && alvo.matches('.linha button.nome')) {
      ev.preventDefault();
      moverFoco(alvo, ev.key === 'ArrowDown' ? 1 : -1);
    }
  }

  // ---------- amarração ----------

  function iniciar() {
    montarAnelVarredura();
    el.btnFecharErro.addEventListener('click', fecharErro);
    renderizarCartaoPasta();
    // Como o título nativo do Windows, a barra apaga com a janela sem foco
    // (os botões do sistema, desenhados por cima, já fazem isso sozinhos).
    window.addEventListener('blur', () => document.body.classList.add('inativa'));
    window.addEventListener('focus', () => document.body.classList.remove('inativa'));

    if (!api || !fmt) {
      mostrarErro('A interface foi aberta fora do Electron e não tem acesso ao disco. Rode com "npm start".');
      el.cartaoPasta.setAttribute('aria-disabled', 'true');
      return;
    }
    api.aoProgresso(atualizarProgresso);

    el.cartaoPasta.addEventListener('click', aoAtivarCartaoPasta);
    el.cartaoPasta.addEventListener('keydown', (ev) => {
      if (ev.target !== el.cartaoPasta || (ev.key !== 'Enter' && ev.key !== ' ')) return;
      ev.preventDefault();
      aoAtivarCartaoPasta();
    });
    el.btnTrocarPasta.addEventListener('click', (ev) => {
      ev.stopPropagation();
      escolherPasta();
    });
    el.btnVarrerPasta.addEventListener('click', (ev) => {
      ev.stopPropagation();
      varrer(estado.pastaEscolhida);
    });
    el.btnParar.addEventListener('click', parar);
    el.btnDeNovo.addEventListener('click', varrerDeNovo);
    el.btnNova.addEventListener('click', novaVarredura);
    el.btnSubir.addEventListener('click', () => subir(false));
    for (const b of el.botoesAba) b.addEventListener('click', () => trocarAba(b.dataset.aba));
    el.abas.addEventListener('keydown', teclaNasAbas);
    document.addEventListener('keydown', teclaGeral);

    // sombra embaixo das abas só quando elas estão grudadas no topo
    new IntersectionObserver(([e]) => {
      el.barraVistas.classList.toggle('grudada', !e.isIntersecting);
    }, { root: el.telaResultado }).observe(el.sentinela);

    // A lista rola por baixo das abas grudadas. O scroll-padding do CSS usa a
    // altura delas pra o foco do teclado nunca parar escondido ali embaixo.
    new ResizeObserver(() => {
      el.telaResultado.style.setProperty('--altura-vistas', el.barraVistas.offsetHeight + 'px');
    }).observe(el.barraVistas);

    carregarDiscos().catch((e) => {
      mostrarErro('Não deu pra listar os discos: ' + mensagem(e));
      renderizarDiscos(); // mostra o aviso de nenhum disco e destaca a pasta
    });
  }

  iniciar();
})();
