@echo off
setlocal enabledelayedexpansion

echo ============================================
echo   NoteSnap - Android Emulator Launcher
echo ============================================
echo.

:: ------------------------------------------------------------------
:: 1. Locate the Android SDK
:: ------------------------------------------------------------------
echo [1/5] Locating Android SDK...

set "SDK_ROOT="

:: Check ANDROID_HOME / ANDROID_SDK_ROOT first
if defined ANDROID_HOME (
    if exist "%ANDROID_HOME%\platform-tools\adb.exe" (
        set "SDK_ROOT=%ANDROID_HOME%"
    )
)
if defined ANDROID_SDK_ROOT (
    if not defined SDK_ROOT (
        if exist "%ANDROID_SDK_ROOT%\platform-tools\adb.exe" (
            set "SDK_ROOT=%ANDROID_SDK_ROOT%"
        )
    )
)

:: Fall back to %LOCALAPPDATA%\Android\Sdk
if not defined SDK_ROOT (
    if exist "%LOCALAPPDATA%\Android\Sdk\platform-tools\adb.exe" (
        set "SDK_ROOT=%LOCALAPPDATA%\Android\Sdk"
    )
)

:: Fall back to %APPDATA%\..\Local\Android\Sdk (unexpanded form)
if not defined SDK_ROOT (
    if exist "%APPDATA%\..\Local\Android\Sdk\platform-tools\adb.exe" (
        pushd "%APPDATA%\..\Local\Android\Sdk"
        for /f "delims=" %%i in ('cd') do set "SDK_ROOT=%%i"
        popd
    )
)

if not defined SDK_ROOT (
    echo ERROR: Could not find Android SDK.
    echo        Make sure Android Studio is installed and the SDK is present.
    echo        Expected at: %%LOCALAPPDATA%%\Android\Sdk
    echo.
    pause
    exit /b 1
)

echo        Found SDK at: %SDK_ROOT%

set "EMULATOR=%SDK_ROOT%\emulator\emulator.exe"
set "ADB=%SDK_ROOT%\platform-tools\adb.exe"

if not exist "%EMULATOR%" (
    echo ERROR: emulator.exe not found at %EMULATOR%
    echo        Is the Android Emulator component installed?
    pause
    exit /b 1
)

if not exist "%ADB%" (
    echo ERROR: adb.exe not found at %ADB%
    echo        Is the Android SDK Platform-Tools installed?
    pause
    exit /b 1
)

echo        emulator.exe OK
echo        adb.exe OK
echo.

:: ------------------------------------------------------------------
:: 2. Find the AVD
:: ------------------------------------------------------------------
echo [2/5] Finding Android Virtual Device...

set "AVD_NAME="

:: Check if Pixel_8_Pro exists
"%EMULATOR%" -list-avds > "%TEMP%\notesnap_avds.txt" 2>nul

for /f "usebackq delims=" %%a in ("%TEMP%\notesnap_avds.txt") do (
    if /i "%%a"=="Pixel_8_Pro" (
        set "AVD_NAME=Pixel_8_Pro"
    )
)

:: If not found, use the first available AVD
if not defined AVD_NAME (
    for /f "usebackq delims=" %%a in ("%TEMP%\notesnap_avds.txt") do (
        if not defined AVD_NAME (
            set "AVD_NAME=%%a"
        )
    )
)

del "%TEMP%\notesnap_avds.txt" 2>nul

if not defined AVD_NAME (
    echo ERROR: No Android Virtual Devices found.
    echo        Create one in Android Studio ^(AVD Manager^) first.
    echo        Recommended name: Pixel_8_Pro
    pause
    exit /b 1
)

echo        Using AVD: %AVD_NAME%
echo.

:: ------------------------------------------------------------------
:: 3. Start the emulator
:: ------------------------------------------------------------------
echo [3/5] Starting emulator ^(%AVD_NAME%^)...

:: Check if the emulator is already running
"%ADB%" devices 2>nul | findstr /r /c:"emulator.*device" >nul 2>&1
if not errorlevel 1 (
    echo        Emulator is already running!
    goto :check_boot
)

:: Launch the emulator in the background
start "" "%EMULATOR%" -avd "%AVD_NAME%" -no-snapshot-load

echo        Waiting for emulator to appear in adb...

:: Wait up to 120 seconds for the emulator to register with adb
set "WAIT_COUNT=0"
:wait_adb
timeout /t 2 /nobreak >nul
set /a WAIT_COUNT+=2

"%ADB%" devices 2>nul | findstr /r /c:"emulator.*device" >nul 2>&1
if not errorlevel 1 (
    echo        Emulator registered with adb.
    goto :check_boot
)

if %WAIT_COUNT% lss 120 (
    goto :wait_adb
)

echo ERROR: Emulator did not appear in adb after 120 seconds.
echo        Check the emulator window for errors.
pause
exit /b 1

:: ------------------------------------------------------------------
:: 4. Wait for boot to finish
:: ------------------------------------------------------------------
:check_boot
echo [4/5] Waiting for emulator to finish booting...

set "BOOT_WAIT=0"
:wait_boot
timeout /t 2 /nobreak >nul
set /a BOOT_WAIT+=2

for /f "usebackq delims=" %%b in (`"%ADB%" shell getprop sys.boot_completed 2^>nul`) do (
    set "BOOT_STATUS=%%b"
)

:: Strip carriage returns / whitespace
set "BOOT_STATUS=%BOOT_STATUS: =%"
set "BOOT_STATUS=%BOOT_STATUS:    =%"

if "!BOOT_STATUS!"=="1" (
    echo        Boot complete!
    goto :boot_done
)

if %BOOT_WAIT% lss 180 (
    goto :wait_boot
)

echo ERROR: Emulator did not finish booting after 180 seconds.
echo        Try checking the emulator manually.
pause
exit /b 1

:boot_done
echo.

:: ------------------------------------------------------------------
:: 5. Launch Expo and open on emulator
:: ------------------------------------------------------------------
echo [5/5] Starting Expo and opening app on emulator...
echo.
echo        Press 'a' will be sent automatically once Metro is ready.
echo        Press Ctrl+C to stop the dev server.
echo.

:: Start expo — we pipe 'a' to stdin after a delay so the bundler
:: has time to start before we send the key
(
    timeout /t 8 /nobreak >nul
    echo a
) | npx expo start

endlocal
