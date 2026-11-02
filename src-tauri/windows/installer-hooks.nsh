; Tauri includes installerHooks after utils.nsh and before either check is expanded.
; Replace its termination macro for both installation and uninstallation.
!macroundef CheckIfAppIsRunning
!macro CheckIfAppIsRunning executableName productName
  nsis_tauri_utils::FindProcessCurrentUser "${executableName}"
  Pop $R0
  ${If} $R0 != 1
    SetErrorLevel 2
    Abort "Please close ${productName} and retry. The installer will not terminate a running application."
  ${EndIf}
!macroend
