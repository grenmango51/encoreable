/**
 * Locating a Chromium-family browser and launching two isolated windows.
 *
 * Two separate `--user-data-dir` profiles are what make two independent logins
 * possible on one machine. The server hard-blocks a single user from holding two
 * battle slots (`server/room-battle.ts:665`), so one profile per side is the only
 * way to sit on both sides of a battle.
 */

import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

export function findBrowser() {
  const candidates = [
    { type: 'chrome', path: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' },
    { type: 'chrome', path: 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe' },
    { type: 'chrome', path: path.join(os.homedir(), 'AppData\\Local\\Google\\Chrome\\Application\\chrome.exe') },
    { type: 'edge', path: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe' },
    { type: 'edge', path: 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe' },
    { type: 'firefox', path: 'C:\\Program Files\\Mozilla Firefox\\firefox.exe' },
  ];
  for (const item of candidates) {
    if (fs.existsSync(item.path)) return item;
  }
  return null;
}

/**
 * Opens `left` and `right` URLs side by side, each in its own profile.
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
    spawn(browser.path, [
      `--user-data-dir=${profileRight}`, ...common,
      '--window-position=960,10', '--window-size=940,1020', right,
    ], { detached: true, stdio: 'ignore' }).unref();

    await new Promise(r => setTimeout(r, 600));

    spawn(browser.path, [
      `--user-data-dir=${profileLeft}`, ...common,
      '--window-position=10,10', '--window-size=940,1020', left,
    ], { detached: true, stdio: 'ignore' }).unref();

    return browser.type;
  }

  if (browser && browser.type === 'firefox') {
    spawn(browser.path, ['-new-instance', '-profile', profileRight, right], { detached: true, stdio: 'ignore' }).unref();
    await new Promise(r => setTimeout(r, 600));
    spawn(browser.path, ['-new-instance', '-profile', profileLeft, left], { detached: true, stdio: 'ignore' }).unref();
    return 'firefox';
  }

  spawn('cmd.exe', ['/c', 'start', '', right], { detached: true, stdio: 'ignore' }).unref();
  await new Promise(r => setTimeout(r, 600));
  spawn('cmd.exe', ['/c', 'start', '', left], { detached: true, stdio: 'ignore' }).unref();
  return 'default';
}
