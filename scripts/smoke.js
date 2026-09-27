#!/usr/bin/env node
/* Cross-platform launcher for the end-to-end smoke suite (`npm test`).

   The old script was `set MARGO_SMOKE=1&& electron .`, which only works in
   cmd.exe: everywhere else `set` does nothing useful and Electron started a
   normal, interactive Margo. This sets the environment itself, spawns the
   Electron binary directly, and on Linux without a display wraps it in
   `xvfb-run` so CI and containers can run it headless. The exit code is the
   suite's own: 0 when every check passed, non-zero otherwise.

   Options (environment):
     MARGO_SMOKE_TIMEOUT_MS   hard cap for the whole run (default 10 minutes)
     MARGO_SMOKE_LOG          also write the full output to this file */
const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');

function electronBinary() {
  try {
    // The electron package's main export is the path to its binary.
    return require('electron');
  } catch (err) {
    console.error('smoke: electron is not installed - run `npm install` first.');
    process.exit(2);
  }
  return null;
}

function hasCommand(cmd) {
  const probe = spawnSync(process.platform === 'win32' ? 'where' : 'which', [cmd], { stdio: 'ignore' });
  return probe.status === 0;
}

function buildCommand() {
  const electron = electronBinary();
  const args = ['.'];
  // Chromium refuses to start its sandbox as root (containers, most CI
  // images), and Margo's own renderer sandbox still applies per window.
  const isRoot = typeof process.getuid === 'function' && process.getuid() === 0;
  if (process.platform === 'linux' && (isRoot || process.env.CI)) args.push('--no-sandbox');

  if (process.platform === 'linux' && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) {
    if (!hasCommand('xvfb-run')) {
      console.error('smoke: no display and xvfb-run is missing. Install xvfb (e.g. `apt-get install xvfb`) or set DISPLAY.');
      process.exit(2);
    }
    return { cmd: 'xvfb-run', args: ['-a', electron, ...args] };
  }
  return { cmd: electron, args };
}

function main() {
  try { require('./stamp-electron-icon').stampElectronIcon(); } catch {}

  const { cmd, args } = buildCommand();
  const env = Object.assign({}, process.env, { MARGO_SMOKE: '1' });
  // A leftover ELECTRON_RUN_AS_NODE would start Electron as plain Node.
  delete env.ELECTRON_RUN_AS_NODE;

  const logFile = process.env.MARGO_SMOKE_LOG ? fs.createWriteStream(process.env.MARGO_SMOKE_LOG) : null;
  const child = spawn(cmd, args, { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });

  let sawDone = false;
  let passedLine = '';
  const pipe = (stream, out) => {
    stream.on('data', (chunk) => {
      const text = chunk.toString();
      out.write(text);
      if (logFile) logFile.write(text);
      const m = /SMOKE done: (\d+)\/(\d+) passed/.exec(text);
      if (m) { sawDone = true; passedLine = m[0]; }
    });
  };
  pipe(child.stdout, process.stdout);
  pipe(child.stderr, process.stderr);

  const timeoutMs = Number(process.env.MARGO_SMOKE_TIMEOUT_MS) || 10 * 60 * 1000;
  const timer = setTimeout(() => {
    console.error(`smoke: no result after ${Math.round(timeoutMs / 1000)}s - killing Electron.`);
    try { child.kill('SIGKILL'); } catch {}
  }, timeoutMs);

  const forward = (sig) => { try { child.kill(sig); } catch {} };
  process.on('SIGINT', () => forward('SIGINT'));
  process.on('SIGTERM', () => forward('SIGTERM'));

  child.on('error', (err) => {
    clearTimeout(timer);
    console.error('smoke: could not start Electron:', err.message);
    process.exit(2);
  });
  child.on('exit', (code, signal) => {
    clearTimeout(timer);
    if (logFile) logFile.end();
    // Electron exits 0 only after printing its summary with no failures; a
    // run that died before the summary is a failure whatever its exit code.
    let status = code == null ? 1 : code;
    if (!sawDone && status === 0) status = 1;
    if (!sawDone) console.error(`smoke: Electron exited (${signal || code}) before the suite finished.`);
    else console.log(`smoke: ${passedLine}${status ? ' - FAILED' : ''}`);
    process.exit(status);
  });
}

main();
