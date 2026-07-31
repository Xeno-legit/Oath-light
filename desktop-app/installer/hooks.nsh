; Oath Light - NSIS installer hooks
;
; Wired in via tauri.conf.json -> bundle.windows.nsis.installerHooks. Tauri
; inserts these macros into the generated installer.nsi (see
; target/release/nsis/x64/installer.nsi): NSIS_HOOK_PREUNINSTALL is the FIRST
; statement inside `Section Uninstall`, before any Delete, and
; NSIS_HOOK_POSTUNINSTALL is the last.
;
; ============================================================================
; What this fixes
; ============================================================================
;
; The stock uninstall section had two defects that combined into one bad state.
;
;   1. It never consulted the app. The 24-hour cool-off in uninstall.rs guarded
;      only the in-app "Remove Oath Light" button, so Settings -> Apps ->
;      Uninstall was an unguarded parallel removal path.
;
;   2. `CheckIfAppIsRunning "${MAINBINARYNAME}.exe"` knows nothing about
;      oathlightguard.exe. The uninstaller killed the main app; the guardian
;      resurrected it ~1-3s later; the resurrected app re-registered its Run key
;      and browser policies. NSIS's `Delete` calls against the relocked
;      executables then failed SILENTLY (Delete only sets an error flag, which
;      the template never checks), while `Delete uninstall.exe` and the
;      Add/Remove Programs `DeleteRegKey` - which nothing held open - succeeded.
;
; The result was an install with no uninstaller, no Add/Remove Programs entry,
; and every protection still running: unremovable by any supported path.
;
; The rule these hooks enforce is that the uninstaller is ALL-OR-NOTHING. It
; either refuses and touches nothing, or it completes fully - including the
; machine state Tauri's template knows nothing about (autostart task, browser
; policy, native messaging hosts, DNS, watchdog sentinels).
;
; ============================================================================
; The third outcome: an upgrade
; ============================================================================
;
; Installing a newer build over an older one runs the OLD uninstall.exe first
; (installer.nsi -> PageLeaveReinstall -> reinst_uninstall; it is the
; default-selected choice on the reinstall page). To the gate that looks exactly
; like Settings -> Apps -> Uninstall, so a naive gate turns "update Oath Light"
; into "you cannot update Oath Light" - and shipping a blocker nobody can patch
; is its own security bug.
;
; What it is NOT gated on is $UpdateMode. That flag would make
; `uninstall.exe /UPDATE` a one-word bypass of the entire cool-off, and
; knowledge barriers are finished (docs/HARDENING.md). It is also not set on
; the path that matters: un.onInit only raises it when the PARENT installer was
; itself launched with /UPDATE, and in that case PageLeaveReinstall skips the
; old uninstaller entirely.
;
; The authorization is an active update window (update.json) - opened from
; inside the app, behind the master password, capped at fifteen minutes,
; re-validated on every read, logged, and backed by a recovery task. It is not
; an extra hurdle either: an upgrade cannot physically complete without one,
; because both binaries are running and locked until the watchdog stands down,
; and the update window is the only thing that stands it down.
;
; So there are three shapes of run, not two:
;
;   BLOCK    refuse, touch nothing
;   ALLOW    delete the files AND reverse every machine state (a real removal)
;   UPGRADE  delete the files, reverse NOTHING (a new install inherits it all)

!include "LogicLib.nsh"

; The OathLight browser extension id, used to identify our own force-install
; policy entries in the fallback sweep. MUST match browsers.rs.
!define OL_EXT_ID "oigdpcdgmldgjalfnlgekcbkmniplnad"
!define OL_GUARDIAN_EXE "oathlightguard.exe"
!define OL_HOST_EXE "oath-light-host.exe"

; Exit codes from `${MAINBINARYNAME}.exe --uninstall-check`. Contract with
; src/cli.rs - if these change, change them there in the same commit.
!define OL_ALLOW   0
!define OL_BLOCK   1
!define OL_UNKNOWN 2
!define OL_UPGRADE 3

Var OLAppData     ; the installing user's app-data dir
Var OLGate        ; exit code from --uninstall-check
Var OLTornDown    ; 1 if the app's own teardown ran (so it cleaned up precisely)
Var OLUpgrade     ; 1 if this run is a version replacement, not a removal

; Resolve the *user's* roaming app-data dir.
;
; `SetShellVarContext current` matters: this is a perMachine install, so the
; uninstaller runs elevated and un.onInit has already set the "all users"
; context. Reading $APPDATA in that context would name the wrong directory
; entirely, and the friction state we must consult lives in the user's.
; (Tauri's own app-data cleanup does the same thing for the same reason.)
;
; And then it must be put BACK, which is why this is a macro and not two lines
; inline. The context is process-wide and sticky: between PREUNINSTALL and the
; template's own app-data cleanup sit the shortcut deletes (installer.nsi's
; `$SMPROGRAMS` / `$DESKTOP` blocks), and a perMachine install put those
; shortcuts in the all-users locations. Leaving the context on "current" points
; them at the wrong profile, they quietly fail to match, and the uninstall
; finishes with a Start Menu and desktop full of shortcuts to a deleted exe.
; `SetContext` is the template's own macro, so it stays right if INSTALLMODE
; ever changes.
!macro OL_ResolveAppData
  SetShellVarContext current
  StrCpy $OLAppData "$APPDATA\${BUNDLEID}"
  !insertmacro SetContext
!macroend

; ============================================================================
; PRE-UNINSTALL - the gate
; ============================================================================
!macro NSIS_HOOK_PREUNINSTALL
  !insertmacro OL_ResolveAppData
  StrCpy $OLTornDown 0
  StrCpy $OLUpgrade 0
  StrCpy $OLGate ${OL_UNKNOWN}

  ; Ask the app whether removal is authorized. The decision lives in Rust
  ; (friction::FrictionStore is the single source of truth for an elapsed
  ; cool-off) and travels back as an exit code, so the installer never has to
  ; re-implement clock arithmetic it cannot do safely.
  ;
  ; Check mode alters nothing about the install. It is not literally write-free -
  ; see cli::decide's "the one thing this writes" - but the single exception is a
  ; one-time migration of the user's own pending request between two of their own
  ; files, and it cannot change the answer.
  ${If} ${FileExists} "$INSTDIR\${MAINBINARYNAME}.exe"
    ClearErrors
    ExecWait '"$INSTDIR\${MAINBINARYNAME}.exe" --uninstall-check --app-data "$OLAppData"' $OLGate
    ${If} ${Errors}
      ; Could not even launch the check: treat as UNKNOWN, never as authorized
      ; silence. See the UNKNOWN branch below for why that still proceeds.
      StrCpy $OLGate ${OL_UNKNOWN}
    ${EndIf}
  ${Else}
    ; No main binary: this install is already broken (exactly the state the old
    ; uninstaller produced). Removal must stay possible, or the user is stuck
    ; with an unremovable install forever.
    StrCpy $OLGate ${OL_UNKNOWN}
  ${EndIf}

  ${If} $OLGate = ${OL_BLOCK}
    ; Refuse, and touch NOTHING. This macro runs before the first Delete in the
    ; uninstall section, so quitting here leaves the install exactly as it was -
    ; which is the entire point: a refusal must never be a partial uninstall.
    ;
    ; The message names both doors, because this dialog is what a user sees when
    ; they run a NEW INSTALLER without opening an update window first - and
    ; being told only about removal, when they were trying to update, reads as a
    ; broken product rather than a working guard.
    ${IfNot} ${Silent}
      MessageBox MB_OK|MB_ICONSTOP \
        "Oath Light can't be removed from here.$\n$\n\
         Removing it goes through the app itself: open Oath Light, go to \
         Settings and choose Remove Oath Light. There's a waiting period before \
         removal unlocks, and the app stays fully protective until then.$\n$\n\
         Installing an update? Open Oath Light and start the update from \
         Settings first, then run this installer again.$\n$\n\
         Nothing on your system has been changed."
    ${EndIf}
    Quit
  ${EndIf}

  ${If} $OLGate = ${OL_UPGRADE}
    ; A newer version is replacing this one. The files must come off; nothing
    ; else may. Skipping the teardown here and the entire sweep in
    ; POSTUNINSTALL is what keeps browser policy, DNS, autostart, the recovery
    ; task and the app's data intact across the gap between the two installs.
    StrCpy $OLUpgrade 1

    ; Force the "Delete app data" checkbox off for this run, whatever the
    ; confirm page collected. That page is shown by the OLD uninstaller in the
    ; middle of what the user asked to be an UPDATE, and honoring the tick there
    ; would silently destroy settings, the streak, the hash-chained event log,
    ; any pending friction request, and the very update.json that authorized
    ; this run - none of which the user meant to trade for a new version.
    ; (Reaches into a Tauri template variable by name; if the template ever
    ; renames it, this fails to compile, which is the failure mode we want.)
    StrCpy $DeleteAppDataCheckboxState 0
  ${Else}
    ; Authorized (ALLOW), or unreadable state on an already-broken install
    ; (UNKNOWN). Either way we are now committed to removing everything.
    ;
    ; Have the app reverse its own machine state first. It knows precisely which
    ; policy entries are its own (browsers.rs deletes only its own forcelist
    ; values, never a co-existing managed extension's), which adapters it took
    ; over, and how to stand the watchdog down. It also writes the shutdown
    ; sentinel, without which the guardian would resurrect the app mid-uninstall
    ; and we would reproduce the original bug.
    ${If} ${FileExists} "$INSTDIR\${MAINBINARYNAME}.exe"
      ExecWait '"$INSTDIR\${MAINBINARYNAME}.exe" --uninstall-teardown --app-data "$OLAppData"' $0
      ${If} $0 = ${OL_ALLOW}
        StrCpy $OLTornDown 1
      ${EndIf}
      Sleep 1200
    ${EndIf}
  ${EndIf}

  ; Now stop the processes - all three images in ONE taskkill invocation. This
  ; runs on the upgrade path too: the app and guardian have usually already
  ; exited by then (opening an update window is what stands them down), but
  ; oath-light-host.exe has not - see below.
  ;
  ; This ordering is load-bearing. watchdog.rs documents that the dual-process
  ; watchdog only fails when both processes die within one poll interval; a
  ; sequential kill lets whichever survives resurrect the other. One taskkill
  ; with three /IM arguments terminates them back-to-back, well inside the 1s
  ; poll. oath-light-host.exe is included because the browser owns that process
  ; over native messaging - it does not exit just because the app did, and it
  ; would hold $INSTDIR open against the deletes that follow.
  nsExec::Exec '"$SYSDIR\taskkill.exe" /F /IM "${MAINBINARYNAME}.exe" /IM "${OL_GUARDIAN_EXE}" /IM "${OL_HOST_EXE}"'
  Pop $0
  Sleep 2000
!macroend

; ============================================================================
; POST-UNINSTALL - the sweep
; ============================================================================
;
; Everything here is idempotent and must run even when the teardown above could
; not (a missing or corrupt binary). This is what guarantees the "or it
; completes fully" half of the all-or-nothing rule.
;
; ...and none of it may run on an upgrade, which is the "reverse NOTHING" half.
; Every line below answers the question "how does Oath Light stop being present
; on this machine", and during a version replacement Oath Light is not leaving.
; Sweeping here would strip browser policy, delete both autostart registrations,
; kill the recovery task that is the only thing bringing the app back if the new
; installer is cancelled, and reset the friction state - handing anyone who can
; open an update window a complete, cool-off-free disarm. So: one guard, at the
; top, covering the whole macro.
!macro NSIS_HOOK_POSTUNINSTALL
 ${If} $OLUpgrade <> 1
  !insertmacro OL_ResolveAppData

  ; ---- Autostart: both registrations -------------------------------------
  ; The template already deletes the Run value, but only when not updating.
  ; Repeating it is free, and missing either path means an uninstalled app
  ; returns at the next logon - which reads as malware, not tamper-resistance.
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "${PRODUCTNAME}"
  nsExec::Exec 'schtasks /Delete /TN "OathLight Autostart" /F'
  Pop $0
  nsExec::Exec 'schtasks /Delete /TN "OathLight Update Recovery" /F'
  Pop $0
  nsExec::Exec 'schtasks /Delete /TN "OathLightElevated" /F'
  Pop $0

  ; ---- Native messaging host registrations --------------------------------
  ; Left behind, these point every browser at a host binary that no longer
  ; exists.
  DeleteRegKey HKCU "Software\Google\Chrome\NativeMessagingHosts\com.oathlight.companion"
  DeleteRegKey HKLM "Software\Google\Chrome\NativeMessagingHosts\com.oathlight.companion"
  DeleteRegKey HKCU "Software\Microsoft\Edge\NativeMessagingHosts\com.oathlight.companion"
  DeleteRegKey HKLM "Software\Microsoft\Edge\NativeMessagingHosts\com.oathlight.companion"
  DeleteRegKey HKCU "Software\Mozilla\NativeMessagingHosts\com.oathlight.companion"
  DeleteRegKey HKLM "Software\Mozilla\NativeMessagingHosts\com.oathlight.companion"
  DeleteRegKey HKCU "Software\BraveSoftware\Brave\NativeMessagingHosts\com.oathlight.companion"
  DeleteRegKey HKLM "Software\BraveSoftware\Brave\NativeMessagingHosts\com.oathlight.companion"

  ; ---- Browser policy, only if the app could not clean up after itself -----
  ;
  ; When the teardown ran, browsers::remove_policy already did this precisely -
  ; deleting only the forcelist values whose data is our own entry, and pruning
  ; the list key only when empty. Repeating a blunter version here would risk
  ; deleting a co-existing managed extension's policy, so it is skipped.
  ;
  ; When the teardown could NOT run, leaving the policy behind would keep the
  ; extension force-installed and incognito disabled after the app is gone. The
  ; PowerShell pass below reproduces remove_policy's filtering: scalar values we
  ; are known to own are dropped outright, list entries only when their data
  ; names our extension id, and a list key only when nothing else remains.
  ${If} $OLTornDown <> 1
    nsExec::Exec 'powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -Command "$$ErrorActionPreference=$\'SilentlyContinue$\'; foreach ($$r in @($\'HKCU:\SOFTWARE\Policies$\',$\'HKLM:\SOFTWARE\Policies$\')) { foreach ($$b in @($\'Google\Chrome$\',$\'Microsoft\Edge$\',$\'BraveSoftware\Brave$\')) { $$p = Join-Path $$r $$b; if (-not (Test-Path $$p)) { continue }; foreach ($$v in @($\'IncognitoModeAvailability$\',$\'BrowserGuestModeEnabled$\',$\'DnsOverHttpsMode$\')) { Remove-ItemProperty -Path $$p -Name $$v }; foreach ($$s in @($\'ExtensionInstallForcelist$\',$\'ExtensionInstallAllowlist$\')) { $$k = Join-Path $$p $$s; if (-not (Test-Path $$k)) { continue }; foreach ($$n in (Get-Item $$k).Property) { if ((Get-ItemProperty -Path $$k -Name $$n).$$n -match $\'${OL_EXT_ID}$\') { Remove-ItemProperty -Path $$k -Name $$n } }; if (-not (Get-Item $$k).Property) { Remove-Item $$k } } } }"'
    Pop $0
  ${EndIf}

  ; ---- Watchdog sentinels --------------------------------------------------
  ; A stale sentinel in TEMP would stand down a FUTURE install's watchdog before
  ; it ever started guarding. These must not survive the uninstall.
  Delete "$TEMP\oathlight.watchdog.shutdown"
  Delete "$TEMP\oathlight.watchdog.update"
  Delete "$TEMP\${OL_GUARDIAN_EXE}"

  ; ---- Friction state ------------------------------------------------------
  ; Deleted even when the user chose to KEEP their app data.
  ;
  ; Otherwise uninstall -> reinstall would carry an already-elapsed removal
  ; request across, and the very first --uninstall-check on the new install
  ; would return ALLOW - turning the cool-off into a one-time cost that a
  ; reinstall permanently buys off. Clearing them restarts every protection in
  ; its default-on state, which is the safe direction; the cost is only that
  ; other pending friction requests are forgotten, and those are meaningless
  ; once the app they belonged to is gone.
  Delete "$OLAppData\uninstall.json"
  Delete "$OLAppData\friction.json"
  RMDir "$OLAppData"
 ${EndIf}
!macroend

; ============================================================================
; Install-side hooks - nothing to do.
; ============================================================================
;
; The logon task is deliberately NOT created here. The app registers it itself
; on every launch (watchdog::register_autostart), which self-heals a task the
; user deletes; creating it here as well would be a second code path that only
; runs at install time and would drift.
!macro NSIS_HOOK_PREINSTALL
!macroend

!macro NSIS_HOOK_POSTINSTALL
!macroend
