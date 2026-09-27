; Acréscimo ao instalador NSIS do electron-builder (package.json, build.nsis.include).
;
; Com oneClick desligado, o instalador padrão pergunta "pra todos os usuários
; ou só pra mim", e a primeira opção pede administrador. Aqui a instalação é
; sempre só pro usuário atual, em %LOCALAPPDATA%\Programs: pula essa pergunta
; e nunca pede administrador. A escolha da pasta continua disponível.

!macro customInstallMode
  StrCpy $isForceCurrentInstall "1"
!macroend
