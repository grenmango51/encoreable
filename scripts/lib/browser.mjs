/**
 * Locating a Chromium-family browser and launching two isolated windows.
 *
 * Two separate `--user-data-dir` profiles are what make two independent logins
 * possible on one machine. The server hard-blocks a single user from holding two
 * battle slots (`server/room-battle.ts:666`), so one profile per side is the only
 * way to sit on both sides of a battle.
 */

import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

export function findBrowser() {
  // A concrete override also supports CI and installations outside the usual
  // locations. Do not silently use another executable when it is misspelled.
  if (process.env.ENCOREABLE_BROWSER) {
    const browserPath = process.env.ENCOREABLE_BROWSER;
    if (!fs.existsSync(browserPath) || !fs.statSync(browserPath).isFile()) {
      throw new Error(`ENCOREABLE_BROWSER is not a browser executable: ${browserPath}`);
    }
    return { type: /firefox/i.test(path.basename(browserPath)) ? 'firefox' : 'chrome', path: browserPath };
  }
  const candidates = [
    { type: 'chrome', path: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' },
    { type: 'chrome', path: 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe' },
    { type: 'chrome', path: path.join(os.homedir(), 'AppData\\Local\\Google\\Chrome\\Application\\chrome.exe') },
    { type: 'edge', path: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe' },
    { type: 'edge', path: 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe' },
    { type: 'firefox', path: 'C:\\Program Files\\Mozilla Firefox\\firefox.exe' },
    ...['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium',
      '/usr/bin/chromium-browser', '/snap/bin/chromium',
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    ].map(browserPath => ({ type: 'chrome', path: browserPath })),
  ];
  // Reuse a locally installed Playwright Chromium; no download or persistent
  // service is started by discovery. Prefer it to a Firefox-only fallback.
  const cache = path.join(os.homedir(), '.cache', 'ms-playwright');
  if (fs.existsSync(cache)) {
    for (const entry of fs.readdirSync(cache).filter(name => /^chromium-\d+$/.test(name)).sort().reverse()) {
      for (const executable of ['chrome-linux64/chrome', 'chrome-linux/chrome']) {
        candidates.push({ type: 'chrome', path: path.join(cache, entry, executable) });
      }
    }
  }
  candidates.push({ type: 'firefox', path: '/usr/bin/firefox' });
  for (const item of candidates) {
    if (fs.existsSync(item.path)) return item;
  }
  return null;
}

/** Open a URL with the host's default browser. */
export function openBrowser(url) {
  const command = process.platform === 'win32' ? 'cmd.exe' : process.platform === 'darwin' ? 'open' : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
  const proc = spawn(command, args, { detached: true, stdio: 'ignore' });
  proc.on('error', err => console.error(`Could not open browser: ${err.message}. Open ${url}`));
  proc.unref();
}

/**
 * PowerShell that waits for each process's window and lays the pair out as the
 * left and right halves of the work area of the monitor under the cursor - where
 * Windows Snap puts a window dragged to either edge. Browsers draw an invisible
 * resize border outside the visible frame, so each window is grown by that border
 * to make the visible edges meet. Every window is placed twice: moving onto a
 * monitor with a different scale makes the browser rescale itself after the move.
 */
const arrangeScript = (leftPid, rightPid) => `
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class Win {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }
  [StructLayout(LayoutKind.Sequential)] public struct MONITORINFO { public int cbSize; public RECT rcMonitor; public RECT rcWork; public uint dwFlags; }
  [DllImport("user32.dll")] public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr ctx);
  [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT p);
  [DllImport("user32.dll")] public static extern IntPtr MonitorFromPoint(POINT p, uint flags);
  [DllImport("user32.dll")] public static extern bool GetMonitorInfo(IntPtr m, ref MONITORINFO mi);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr h, int attr, out RECT r, int size);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int w, int hgt, uint flags);
}
'@
[void][Win]::SetThreadDpiAwarenessContext([IntPtr]-4)

function Find-Window([int]$procId) {
  $deadline = (Get-Date).AddSeconds(20)
  while ((Get-Date) -lt $deadline) {
    $p = Get-Process -Id $procId -ErrorAction SilentlyContinue
    if ($p -and $p.MainWindowHandle -ne [IntPtr]::Zero) { return $p.MainWindowHandle }
    Start-Sleep -Milliseconds 100
  }
  throw "no window for pid $procId"
}

function Place([IntPtr]$h, [int]$x, [int]$y, [int]$w, [int]$hgt) {
  [void][Win]::ShowWindow($h, 9)
  [void][Win]::SetWindowPos($h, [IntPtr]::Zero, $x, $y, $w, $hgt, 0x14)
  $outer = New-Object Win+RECT; $visible = New-Object Win+RECT
  [void][Win]::GetWindowRect($h, [ref]$outer)
  [void][Win]::DwmGetWindowAttribute($h, 9, [ref]$visible, 16)
  $l = $visible.L - $outer.L; $t = $visible.T - $outer.T; $r = $outer.R - $visible.R; $b = $outer.B - $visible.B
  [void][Win]::SetWindowPos($h, [IntPtr]::Zero, $x - $l, $y - $t, $w + $l + $r, $hgt + $t + $b, 0x14)
}

$cursor = New-Object Win+POINT
[void][Win]::GetCursorPos([ref]$cursor)
$info = New-Object Win+MONITORINFO
$info.cbSize = [Runtime.InteropServices.Marshal]::SizeOf($info)
[void][Win]::GetMonitorInfo([Win]::MonitorFromPoint($cursor, 2), [ref]$info)
$work = $info.rcWork
$half = [int][Math]::Floor(($work.R - $work.L) / 2)
$height = $work.B - $work.T

$left = Find-Window ${leftPid}
$right = Find-Window ${rightPid}
foreach ($pass in 1, 2) {
  Place $left $work.L $work.T $half $height
  Place $right ($work.L + $half) $work.T ($work.R - $work.L - $half) $height
}
`;

/**
 * Runs `arrangeScript` and resolves when it is done, whether or not it managed.
 * It is not detached: a detached PowerShell has no console and exits without
 * running, and an attached one dies with this process, so the caller waits.
 */
function arrangeHalves(leftPid, rightPid) {
  if (process.platform !== 'win32') return Promise.resolve();
  const encoded = Buffer.from(arrangeScript(leftPid, rightPid), 'utf16le').toString('base64');
  return new Promise(resolve => {
    spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], {
      stdio: 'ignore', windowsHide: true,
    }).on('exit', resolve).on('error', resolve);
  });
}

/**
 * Opens `left` and `right` URLs side by side, each in its own profile, each
 * filling one half of the screen.
 * @param {{left: string, right: string, tag: string}} opts
 */
export async function launchPair({ left, right, tag }) {
  const browser = findBrowser();
  const profileLeft = path.join(os.tmpdir(), `encoreable_left_${tag}`);
  const profileRight = path.join(os.tmpdir(), `encoreable_right_${tag}`);
  fs.mkdirSync(profileLeft, { recursive: true });
  fs.mkdirSync(profileRight, { recursive: true });

  const common = ['--no-first-run', '--no-default-browser-check'];

  if (browser && (browser.type === 'chrome' || browser.type === 'edge')) {
    const rightProc = spawn(browser.path, [
      `--user-data-dir=${profileRight}`, ...common, right,
    ], { detached: true, stdio: 'ignore' });
    rightProc.unref();

    await new Promise(r => setTimeout(r, 600));

    const leftProc = spawn(browser.path, [
      `--user-data-dir=${profileLeft}`, ...common, left,
    ], { detached: true, stdio: 'ignore' });
    leftProc.unref();

    await arrangeHalves(leftProc.pid, rightProc.pid);
    return browser.type;
  }

  if (browser && browser.type === 'firefox') {
    const rightProc = spawn(browser.path, ['-new-instance', '-profile', profileRight, right], { detached: true, stdio: 'ignore' });
    rightProc.unref();
    await new Promise(r => setTimeout(r, 600));
    const leftProc = spawn(browser.path, ['-new-instance', '-profile', profileLeft, left], { detached: true, stdio: 'ignore' });
    leftProc.unref();
    await arrangeHalves(leftProc.pid, rightProc.pid);
    return 'firefox';
  }

  openBrowser(right);
  await new Promise(r => setTimeout(r, 600));
  openBrowser(left);
  return 'default';
}
