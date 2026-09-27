# Cadê meu espaço?

App de janela pra Windows que varre um disco (ou uma pasta) e mostra exatamente
quais pastas e arquivos estão comendo o espaço. Só lê. Não apaga nada. Pra
apagar, ele abre a pasta no Explorer e você decide.

Feito em Node.js + Electron. O núcleo da varredura é Node puro, então também
roda no terminal sem instalar o Electron (útil quando o disco está tão cheio que
nem dá pra baixar coisa nova).

## Sumário

1. [Se o disco está lotado, comece pelo terminal](#1-se-o-disco-está-lotado-comece-pelo-terminal)
2. [Requisitos](#2-requisitos)
3. [Instalar e abrir o app](#3-instalar-e-abrir-o-app)
4. [Como usar, tela por tela](#4-como-usar-tela-por-tela)
5. [Onde o espaço costuma se esconder no Windows](#5-onde-o-espaço-costuma-se-esconder-no-windows)
6. [O que ele faz e o que não faz](#6-o-que-ele-faz-e-o-que-não-faz)
7. [Como funciona por dentro](#7-como-funciona-por-dentro)
8. [Testes](#8-testes)
9. [Gerar um .exe](#9-gerar-um-exe)
10. [O que foi testado e o que não foi](#10-o-que-foi-testado-e-o-que-não-foi)
11. [Fontes](#11-fontes)

## 1. Se o disco está lotado, comece pelo terminal

O Electron ocupa uns 250 MB depois de instalado (pacote + binário em cache).
Se o seu C: está no limite, use primeiro a versão de terminal, que não instala
nada:

```bat
git clone https://github.com/A2Reis/cade-meu-espaco.git
cd cade-meu-espaco
node cli.js
```

Isso lista os discos com total, usado e livre. Aí varra o disco problemático:

```bat
node cli.js C:\
```

Ele mostra o progresso (pastas, arquivos, GB somados e a pasta atual) e no fim
imprime quatro listas: pastas dentro de `C:\` da maior pra menor, pastas mais
pesadas em qualquer nível, maiores arquivos, e o que ficou sem permissão de
leitura. Com `--top 40` cada lista fica com 40 linhas (o padrão é 20). Pra
varrer só uma pasta, passe o caminho entre aspas:

```bat
node cli.js "C:\Users\augusto" --top 40
```

Libere espaço com o que descobrir, e depois instale o app de janela.

## 2. Requisitos

- Windows 10 ou 11 (o núcleo também roda em Linux e macOS, e foi testado em Linux).
- Node.js 22.12 ou mais novo. É o mínimo que o Electron 44 pede
  (`npm view electron engines`). Confira com `node --version`.
- Git, pra clonar. Ou baixe o ZIP pelo GitHub.

## 3. Instalar e abrir o app

```bat
git clone https://github.com/A2Reis/cade-meu-espaco.git
cd cade-meu-espaco
npm install
npm start
```

O `npm install` baixa o Electron (a única dependência). O `npm start` abre a
janela. Pra abrir de novo depois, só `npm start` dentro da pasta.

Se o `npm install` falhar por falta de espaço, volte pra seção 1.

## 4. Como usar, tela por tela

### Barra de cima

- **Disco**: lista com cada disco do PC e, ao lado, quanto tem livre, o total e
  a porcentagem cheia. Exemplo: `C:\   40,0 GB livres de 476 GB (92% cheio)`.
  A lista vem de `fs.statfsSync`, que no Windows usa a chamada
  `GetDiskFreeSpaceW` do sistema (ver Fontes).
- **Escolher pasta…**: abre o seletor de pastas do Windows pra varrer só uma
  pasta em vez do disco inteiro. A pasta escolhida entra na lista de discos
  marcada como "(pasta escolhida)".
- **Varrer**: começa. Num disco inteiro leva de um a alguns minutos, conforme
  a quantidade de arquivos (a varredura de 68 mil arquivos levou 3 segundos no
  teste em Linux; no Windows o acesso a disco costuma ser mais lento).
- **Parar**: aparece durante a varredura. Interrompe e deixa o que já foi
  varrido navegável, com aviso de que os números são parciais.
- Abaixo dos botões, em letra de máquina: `Vai varrer: C:\`.

### Durante a varredura

Uma faixa azul com barra em movimento e quatro contadores que atualizam a cada
0,4 s: pastas lidas, arquivos contados, bytes somados e itens sem permissão.
Embaixo, a pasta que está sendo lida naquele instante.

### Resumo (logo que termina)

- Linha em destaque: `C:\ tem 356 GB em 1.234.567 arquivos e 98.765 pastas.
  Varredura levou 2 min 13 s.`
- Se apertou Parar: `Varredura interrompida no Parar: os números são parciais.`
- Se houve item sem permissão: quantos ficaram fora da soma, com indicação da
  aba "Sem permissão".
- Se o alvo era um disco inteiro: `O disco diz: 476 GB no total, 356 GB
  usados, 120 GB livres (75% cheio).` E, quando a soma da varredura difere de
  mais de 1% do que o disco diz estar usado, uma explicação: soma menor quer
  dizer que tem coisa que o Windows não deixa ler (pagefile.sys, hiberfil.sys,
  pontos de restauração, lixeira de outros usuários) mais a reserva do sistema
  de arquivos. Soma maior quer dizer links físicos (mesmo arquivo com vários
  nomes, comum em `C:\Windows\WinSxS`) ou arquivos do OneDrive só na nuvem,
  que contam com o tamanho cheio.

### Aba "Pastas" (navegação)

É a tela principal. Mostra o conteúdo de uma pasta, da maior pra menor.

- **Subir um nível**: volta pra pasta de cima. Backspace ou Alt+Seta esquerda
  fazem o mesmo. Na raiz o botão fica desabilitado.
- **Trilha**: `C:\ › Users › augusto › AppData`. Cada pedaço é clicável e leva
  direto praquele nível.
- **Cabeçalho da pasta**: tamanho total em destaque, quantos arquivos e pastas
  tem dentro (em qualquer nível), o caminho completo, e o botão
  **Abrir no Explorer**, que abre essa pasta no Explorer do Windows.
- **Uma linha por subpasta**, com:
  - barra de fundo proporcional ao tamanho dela em relação à pasta aberta,
  - nome (passe o mouse pra ver o caminho completo),
  - tamanho (`27,0 MB`, `4,51 GB`), base 1024 igual ao Explorer,
  - porcentagem da pasta aberta,
  - quantos arquivos e pastas tem dentro,
  - botão **Abrir**, que abre a subpasta no Explorer.
  - Clicar na linha (ou Enter com ela focada) entra na subpasta.
  - Subpasta sem permissão aparece com aviso em amarelo escuro
    (`sem permissão (EPERM)`) e tamanho zero, porque não deu pra ler.
- **Linha "Arquivos soltos nesta pasta"** (fundo bege): soma dos arquivos que
  estão direto na pasta, sem contar subpastas. Clicar nela lista os arquivos
  (até os 500 maiores, com aviso se tem mais), cada um com barra, nome,
  tamanho, porcentagem, data de modificação e o botão **Mostrar**, que abre o
  Explorer já com aquele arquivo selecionado. Clicar de novo recolhe a lista.
  Essa lista é lida na hora, não na varredura, então reflete o disco agora.

### Aba "Maiores arquivos"

Os 200 maiores arquivos encontrados em qualquer pasta da varredura, numerados,
com nome, pasta onde está, tamanho e data de modificação. Botões:
**Mostrar** (Explorer com o arquivo selecionado) e **Ver pasta** (volta pra aba
Pastas já dentro da pasta dele). A barra de fundo é proporcional ao maior da
lista.

### Aba "Pastas mais pesadas"

As 200 pastas que mais pesam por conta dos arquivos soltos nelas, sem contar
subpastas. É esta aba que encontra o cache esquecido no fundo de
`AppData\Local`, porque uma pasta pequena no nome pode ter 30 GB de arquivos
direto nela. Cada linha tem caminho completo, tamanho dos arquivos soltos,
quantos são, e os botões **Abrir** (Explorer) e **Ver** (navegar até ela aqui
dentro). Clicar na linha também navega.

### Aba "Sem permissão"

Tudo que o Windows não deixou ler, com o código do erro (`EPERM`, `EACCES`,
`EBUSY`...). Até 1.000 itens. Botão **Abrir** tenta abrir no Explorer, que às
vezes consegue mostrar mesmo o que o programa não leu. Se está vazia, tudo
foi lido.

### Rodapé

Lembrete fixo: o programa só lê e mostra. Pra apagar, abra no Explorer.

## 5. Onde o espaço costuma se esconder no Windows

Use a aba "Pastas mais pesadas" e a "Maiores arquivos" pra confirmar. A tabela
abaixo junta o que a documentação da Microsoft e de cada ferramenta diz. Onde
está marcado "experiência comum", é o que costuma aparecer em PC de
desenvolvedor, sem documento oficial dizendo o tamanho: confira no seu.

| Onde | O que é | O que fazer | Fonte |
|---|---|---|---|
| `C:\hiberfil.sys` | Arquivo de hibernação. Segundo a Microsoft, o tamanho é aproximadamente igual à RAM instalada | Se não usa hibernar: `powercfg.exe /hibernate off` num prompt como administrador | [Microsoft: desabilitar hibernação](https://learn.microsoft.com/en-us/troubleshoot/windows-client/setup-upgrade-and-drivers/disable-and-re-enable-hibernation) |
| `C:\pagefile.sys` | Memória virtual | Não apagar. Tamanho se ajusta em Configurações avançadas do sistema > Desempenho | experiência comum |
| `C:\Windows\WinSxS` | Repositório de componentes do Windows. O tamanho aparente engana: muitos arquivos são links físicos contados mais de uma vez | Nunca apagar na mão. `Dism.exe /Online /Cleanup-Image /StartComponentCleanup` | [Microsoft: gerenciar o repositório de componentes](https://learn.microsoft.com/en-us/windows-hardware/manufacture/desktop/manage-the-component-store), [limpar a pasta WinSxS](https://learn.microsoft.com/en-us/windows-hardware/manufacture/desktop/clean-up-the-winsxs-folder) |
| `C:\Windows.old`, `C:\Windows\SoftwareDistribution\Download`, `%LOCALAPPDATA%\Temp`, `C:\Windows\Temp` | Instalação anterior do Windows, cache do Windows Update, temporários | Limpeza de Disco (`cleanmgr`) ou Sensor de Armazenamento em Configurações > Sistema > Armazenamento | [Microsoft: cleanmgr](https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/cleanmgr), [Sensor de Armazenamento](https://support.microsoft.com/en-us/windows/manage-drive-space-with-storage-sense-654f6ada-7bfc-45e5-966b-e24aded96ad5) |
| `C:\System Volume Information` | Pontos de restauração e cópias de sombra. Aparece em "Sem permissão" | Painel de Controle > Sistema > Proteção do Sistema > Configurar, ajustar o uso máximo | experiência comum |
| `C:\$Recycle.Bin` | Lixeira (de todos os usuários) | Esvaziar a lixeira | experiência comum |
| `%LOCALAPPDATA%\Docker\wsl\` (arquivo `ext4.vhdx`) | Disco virtual do Docker Desktop. Cresce e não encolhe sozinho | Docker Desktop > Settings > Resources > Advanced mostra o local. `docker system prune` limpa imagens, e o vhdx precisa ser compactado depois | [Docker Desktop: settings](https://docs.docker.com/desktop/settings-and-maintenance/settings/) |
| `%LOCALAPPDATA%\Packages\<distro>\LocalState\ext4.vhdx` | Disco virtual de cada distro WSL. Também não encolhe sozinho | Ver documento da Microsoft sobre espaço no WSL e como compactar o vhdx | [Microsoft: espaço em disco no WSL](https://learn.microsoft.com/en-us/windows/wsl/disk-space), [tamanho do VHD](https://learn.microsoft.com/en-us/windows/wsl/vhd-size) |
| `%LOCALAPPDATA%\npm-cache`, `%LOCALAPPDATA%\pnpm`, `%LOCALAPPDATA%\Yarn` | Caches dos gerenciadores de pacote do Node | `npm cache clean --force` (o npm avisa que raramente precisa, mas é o jeito de esvaziar) | [npm cache](https://docs.npmjs.com/cli/v10/commands/npm-cache) |
| `node_modules` espalhados pelos projetos | Dependências instaladas por projeto, fáceis de recriar com `npm install` | Apagar as pastas de projetos parados | experiência comum |
| `%LOCALAPPDATA%\Google\Chrome\User Data`, `%LOCALAPPDATA%\Microsoft\Edge\User Data` | Cache e perfis do navegador | Limpar dados de navegação dentro do navegador | experiência comum |
| `%USERPROFILE%\Downloads` | Downloads esquecidos, instaladores, ISOs | Olhar a aba "Maiores arquivos" | experiência comum |
| `%USERPROFILE%\OneDrive` | Arquivos do OneDrive. Os "somente na nuvem" aparecem aqui com tamanho cheio mas não ocupam o disco | Nada a fazer com eles. Pra liberar espaço dos que estão baixados, use "Liberar espaço" no menu de contexto | [Microsoft: Arquivos Sob Demanda](https://support.microsoft.com/en-us/office/save-disk-space-with-onedrive-files-on-demand-for-windows-0e6860d3-d9f3-4971-b321-7092438fb38e) |
| `C:\Program Files (x86)\Steam\steamapps\common` e bibliotecas da Epic, Xbox, etc. | Jogos | Desinstalar pela própria loja | experiência comum |
| `C:\ProgramData\Package Cache` | Instaladores guardados pelo Visual Studio e outros | Não apagar na mão (a desinstalação precisa deles) | experiência comum |

Atalhos usados acima: `%LOCALAPPDATA%` é `C:\Users\<você>\AppData\Local` e
`%USERPROFILE%` é `C:\Users\<você>`. A pasta `AppData` é oculta no Explorer.

## 6. O que ele faz e o que não faz

Faz:

- Lista discos com total, usado e livre.
- Varre um disco ou pasta e monta a árvore de pastas com tamanho de tudo que
  está dentro.
- Navega pasta por pasta, mostra arquivos soltos, os 200 maiores arquivos e as
  200 pastas mais pesadas.
- Abre pasta ou arquivo no Explorer.
- Interrompe a varredura no meio e deixa o parcial navegável.

Não faz, de propósito:

- **Não apaga, move nem altera nada.** Nem tem botão pra isso.
- **Não segue link simbólico nem junction.** Junction é o atalho de pasta que
  o Windows usa, por exemplo, em `C:\Users\<você>\Application Data` apontando
  pra `AppData\Roaming`. Seguir contaria a mesma coisa duas vezes e poderia
  entrar em laço. Eles contam zero byte e aparecem no total de links.
- **Não mede "tamanho em disco".** Mede o tamanho lógico do arquivo, o mesmo
  que o Explorer mostra em "Tamanho". Arquivo comprimido pelo NTFS ou
  arquivo esparso ocupa menos do que aparece aqui. Arquivo do OneDrive
  "somente na nuvem" aparece com o tamanho cheio e ocupa quase nada.
- **Não desconta link físico.** Um arquivo com vários nomes (comum em
  `C:\Windows\WinSxS`) conta uma vez por nome. É por isso que a soma pode dar
  mais do que o disco diz estar usado.
- **Não lê o que o Windows protege.** `pagefile.sys`, `hiberfil.sys`,
  `System Volume Information`, lixeira de outros usuários e pastas de outros
  usuários caem na aba "Sem permissão". Rodar como administrador lê mais, mas
  não tudo.
- **Caminhos com mais de 260 caracteres** podem falhar com erro e ir pra
  "Sem permissão" se o Windows não estiver com caminhos longos habilitados.
  Ver o documento da Microsoft nas fontes.

## 7. Como funciona por dentro

```
main.js          processo principal do Electron: janela, IPC, abrir no Explorer
preload.js       ponte segura: expõe window.cade com as funções que a página pode chamar
src/varredura.js núcleo: varre, monta a árvore, rankings, consultas (Node puro)
src/ranking.js   heap mínimo que guarda só os N maiores
src/worker.js    roda a varredura numa worker thread e responde consultas
src/motor.js     lado do principal: sobe a worker e casa pedidos com respostas
src/discos.js    lista discos com fs.statfsSync
src/formatar.js  bytes, números, porcentagem, duração e data em pt-BR
ui/              index.html, style.css, renderer.js (a página, sem Node)
cli.js           versão de terminal, usa o mesmo núcleo
tests/           contrato (node --test) e teste de fumaça da interface
```

Decisões que importam:

- **A árvore só guarda pastas.** Arquivo não vira nó. Cada pasta guarda
  quantos arquivos tem direto nela e quanto pesam. Assim a memória cresce com
  o número de pastas (dezenas ou centenas de milhares num C:), não com o de
  arquivos (milhões). Os maiores arquivos ficam num ranking de 200 posições
  (heap mínimo), sem guardar o resto. A lista de arquivos de uma pasta é lida
  na hora em que você clica.
- **Varredura síncrona numa worker thread.** Ler o disco arquivo por arquivo
  com promessas é bem mais lento do que síncrono. Como roda em outra thread
  (`worker_threads`), a janela não trava. A árvore fica na memória da worker
  e o processo principal só pede resumos pequenos (filhos de uma pasta,
  rankings). Parar é uma flag num `SharedArrayBuffer` que a worker confere a
  cada pasta.
- **Reparse points.** No Windows, o `readdir` do Node marca qualquer arquivo
  ou pasta com atributo de reparse point como link (código do libuv,
  `src/win/fs.c`). Isso inclui link simbólico e junction, mas também pasta
  do OneDrive e arquivo somente na nuvem. Aí a varredura faz `lstat`: o libuv
  só marca como link o que é link simbólico ou junction, e refaz como arquivo
  ou pasta normal o resto. Link de verdade é ignorado, o resto entra na conta.
- **Tamanho = `st.size`** da classe `fs.Stats`, que no Windows vem do campo
  `EndOfFile` do arquivo (tamanho lógico).
- **Segurança da janela.** `contextIsolation`, `sandbox` e `nodeIntegration`
  desligado, como a lista de segurança do Electron pede. A página não tem Node:
  só fala com o processo principal pelas funções nomeadas do `preload.js`.
  CSP sem script inline. Nome de arquivo nunca vira HTML, sempre `textContent`.
  Abrir no Explorer usa `shell.showItemInFolder` (arquivo) e `shell.openPath`
  (pasta).

## 8. Testes

```bat
npm test          contrato: varredura, ranking, formatação, discos, motor (worker)
npm run fumaca    interface real num Chromium via Playwright, com capturas de tela
```

O `npm test` usa o test runner do próprio Node, sem instalar nada. Cria uma
pasta temporária com tamanhos conhecidos (1000 + 2000 + 500 + 10 + 3000 bytes,
um link simbólico e uma pasta sem permissão), varre e confere cada número.
São 29 casos. O de pasta sem permissão é pulado quando roda como root ou no
Windows, porque nesses casos não dá pra simular pasta trancada com `chmod`.

O `npm run fumaca` precisa do Playwright instalado (global ou local) e abre
`ui/index.html` num Chromium ligado ao motor real. Clica em Varrer, entra em
pastas, abre a lista de arquivos, testa Subir, Backspace, as quatro abas, o
botão Mostrar e confere que não houve erro no console (o que pegaria bloqueio
da CSP). As capturas ficam em `tests/fumaca/saida/`.

## 9. Gerar um .exe

Tem uma configuração de `electron-builder` no `package.json` pra gerar um
executável portátil (sem instalador):

```bat
npm run empacotar
```

Sai em `dist/`. **Isso não foi testado**: o ambiente onde este projeto foi
escrito é Linux sem Wine, e o electron-builder precisa de Windows (ou Wine)
pra empacotar pra Windows. Se der erro, o documento do electron-builder pra
Windows está nas fontes. O `npm start` não depende disso.

## 10. O que foi testado e o que não foi

Testado, neste ambiente (Linux, Node 22.22, Chromium do Playwright):

- Núcleo de varredura, rankings, consultas, discos e motor com worker thread
  (`npm test`, 28 passando, 1 pulado por rodar como root).
- Velocidade: `/usr` com 68.134 arquivos e 7.843 pastas em 3 segundos.
- Interface completa no Chromium (mesmo motor de renderização do Electron),
  ligada ao motor real, incluindo a CSP com scripts carregados por `file://`
  como o Electron faz.
- CLI com listagem de discos e relatório completo.

Não testado, porque não dá pra rodar aqui:

- O Electron em si abrindo a janela no Windows (`npm start`). O código segue a
  documentação do Electron 44, mas ninguém apertou o botão ainda.
- `dialog.showOpenDialog`, `shell.openPath` e `shell.showItemInFolder` no
  Windows de verdade.
- Comportamento com OneDrive, junctions e `pagefile.sys` num C: real. A
  lógica foi conferida no código-fonte do libuv, não numa máquina Windows.
- Empacotamento em `.exe`.

Se alguma dessas partes falhar no seu PC, o erro aparece na faixa vermelha
da janela ou no terminal onde rodou `npm start`. Manda a mensagem que a gente
ajusta.

## 11. Fontes

Node.js

- `fs.statfsSync` (lista de discos): https://nodejs.org/api/fs.html#fsstatfssyncpath-options
- `dirent.isSymbolicLink()`: https://nodejs.org/api/fs.html#direntissymboliclink
- classe `fs.Stats` e o campo `size`: https://nodejs.org/api/fs.html#class-fsstats
- `worker_threads`: https://nodejs.org/api/worker_threads.html
- libuv, como o Windows classifica reparse points no `readdir` e no `lstat`: arquivo `src/win/fs.c` do repositório https://github.com/libuv/libuv (branch `v1.x`)

Electron

- Isolamento de contexto: https://www.electronjs.org/docs/latest/tutorial/context-isolation
- Sandbox do processo de renderização: https://www.electronjs.org/docs/latest/tutorial/sandbox
- Lista de segurança: https://www.electronjs.org/docs/latest/tutorial/security
- `shell.openPath` e `shell.showItemInFolder`: https://www.electronjs.org/docs/latest/api/shell
- electron-builder, alvo Windows: https://www.electron.build/win e configuração geral https://www.electron.build/configuration

Windows

- `GetDiskFreeSpaceW` (o que o `statfs` usa no Windows): https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-getdiskfreespacew
- Reparse points: https://learn.microsoft.com/en-us/windows/win32/fileio/reparse-points
- Links físicos e junctions: https://learn.microsoft.com/en-us/windows/win32/fileio/hard-links-and-junctions
- Limite de 260 caracteres no caminho e como habilitar caminhos longos: https://learn.microsoft.com/en-us/windows/win32/fileio/maximum-file-path-limitation
- Compressão de arquivos do NTFS (por que "tamanho" difere de "tamanho em disco"): https://learn.microsoft.com/en-us/windows/win32/fileio/file-compression-and-decompression
- Repositório de componentes (WinSxS): https://learn.microsoft.com/en-us/windows-hardware/manufacture/desktop/manage-the-component-store e https://learn.microsoft.com/en-us/windows-hardware/manufacture/desktop/clean-up-the-winsxs-folder
- Hibernação: https://learn.microsoft.com/en-us/troubleshoot/windows-client/setup-upgrade-and-drivers/disable-and-re-enable-hibernation
- Limpeza de Disco (`cleanmgr`): https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/cleanmgr
- Sensor de Armazenamento: https://support.microsoft.com/en-us/windows/manage-drive-space-with-storage-sense-654f6ada-7bfc-45e5-966b-e24aded96ad5
- OneDrive Arquivos Sob Demanda: https://support.microsoft.com/en-us/office/save-disk-space-with-onedrive-files-on-demand-for-windows-0e6860d3-d9f3-4971-b321-7092438fb38e
- Espaço em disco no WSL: https://learn.microsoft.com/en-us/windows/wsl/disk-space e https://learn.microsoft.com/en-us/windows/wsl/vhd-size

Outros

- Docker Desktop, local do disco virtual: https://docs.docker.com/desktop/settings-and-maintenance/settings/
- npm cache: https://docs.npmjs.com/cli/v10/commands/npm-cache
