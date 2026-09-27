; Acréscimo ao instalador NSIS do electron-builder (package.json, build.nsis.include).
;
; Com oneClick desligado, o instalador padrão pergunta "pra todos os usuários
; ou só pra mim", e a primeira opção pede administrador. Aqui a instalação é
; sempre só pro usuário atual, em %LOCALAPPDATA%\Programs: pula essa pergunta
; e nunca pede administrador. A escolha da pasta continua disponível.

!macro customInstallMode
  StrCpy $isForceCurrentInstall "1"
!macroend

; O CadeMeuEspaco.exe é o electron.exe oficial sem edição (win.signAndEditExecutable:
; false): editado, ele perde a reputação e o Controle Inteligente de Aplicativos
; do Windows barra. Então o ícone dele é o do Electron, e o nosso vai à parte em
; resources\icone.ico (build.extraResources). Depois que o instalador padrão cria
; os atalhos, recria os mesmos (mesmo nome, mesmo alvo) apontando pra esse ícone,
; e troca o ícone de "Aplicativos instalados". Só mexe no atalho que existe: numa
; atualização que manteve os atalhos, quem apagou um não ganha ele de volta.

!define CADE_ICONE "$INSTDIR\resources\icone.ico"

!macro customInstall
  ${if} ${FileExists} "$newStartMenuLink"
    CreateShortCut "$newStartMenuLink" "$INSTDIR\${APP_EXECUTABLE_FILENAME}" "" "${CADE_ICONE}" 0 "" "" "${APP_DESCRIPTION}"
    ClearErrors
    WinShell::SetLnkAUMI "$newStartMenuLink" "${APP_ID}"
  ${endIf}

  ${if} ${FileExists} "$newDesktopLink"
    CreateShortCut "$newDesktopLink" "$INSTDIR\${APP_EXECUTABLE_FILENAME}" "" "${CADE_ICONE}" 0 "" "" "${APP_DESCRIPTION}"
    ClearErrors
    WinShell::SetLnkAUMI "$newDesktopLink" "${APP_ID}"
  ${endIf}

  WriteRegStr SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}" "DisplayIcon" "${CADE_ICONE}"
  ; o Explorer relê os ícones dos atalhos
  System::Call 'Shell32::SHChangeNotify(i 0x8000000, i 0, i 0, i 0)'
!macroend
