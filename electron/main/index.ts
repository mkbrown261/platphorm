import { app, shell, BrowserWindow, ipcMain, dialog } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { spawn, ChildProcess } from 'child_process'
import Store from 'electron-store'

// ── Preview dev-server process registry ──────────────────────────────────────
// Tracks one running dev server (child process or built-in static server)
// per project root path.
import type { Server as HttpServer } from 'http'
const previewProcesses = new Map<string, { proc?: ChildProcess; server?: HttpServer; port: number; url: string }>()

function stopPreviewFor(projectPath: string): void {
  const existing = previewProcesses.get(projectPath)
  if (!existing) return
  killProcessTree(existing.proc)
  try { existing.server?.close() } catch {}
  previewProcesses.delete(projectPath)
}

/**
 * Kill a spawned dev server AND all its children.
 * With shell:true, proc.kill() only kills the shell — the actual dev server
 * (Metro, Vite, Next) keeps running as an orphan and squats on its port,
 * which then breaks every subsequent preview start ("port in use").
 * Spawning with detached:true puts the whole tree in its own process group,
 * killable atomically via the negative-PID convention on POSIX.
 */
function killProcessTree(proc?: ChildProcess): void {
  if (!proc || proc.pid == null) return
  try {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', String(proc.pid), '/T', '/F'], { stdio: 'ignore' })
    } else {
      // Negative PID = kill the entire process group (requires detached:true at spawn)
      try { process.kill(-proc.pid, 'SIGTERM') } catch { proc.kill('SIGTERM') }
      // Escalate if anything survives
      const pid = proc.pid
      setTimeout(() => {
        try { process.kill(-pid, 'SIGKILL') } catch {}
      }, 3000)
    }
  } catch {}
}

/**
 * Probe what a dev server actually serves at its root.
 * Detects the "Expo manifest JSON instead of a web page" failure mode —
 * Metro serves its native-app manifest at / when web output isn't properly
 * configured (e.g. deprecated webpack bundler in app.json), which would
 * otherwise render raw JSON in the preview.
 */
function probeRootContent(port: number): Promise<'html' | 'expo-manifest' | 'other' | 'unreachable'> {
  const http = require('http') as typeof import('http')
  return new Promise((resolve) => {
    const req = http.get(
      { host: '127.0.0.1', port, path: '/', headers: { Accept: 'text/html' }, timeout: 4000 },
      (res) => {
        let body = ''
        res.on('data', (d: Buffer) => { body += d.toString(); if (body.length > 4096) req.destroy() })
        res.on('end', () => {
          const ct = String(res.headers['content-type'] ?? '')
          if (ct.includes('text/html') || /^\s*<(!doctype|html)/i.test(body)) return resolve('html')
          if (body.includes('"expoClient"') || (body.includes('"runtimeVersion"') && body.includes('"launchAsset"'))) {
            return resolve('expo-manifest')
          }
          resolve('other')
        })
      }
    )
    req.on('error', () => resolve('unreachable'))
    req.on('timeout', () => { req.destroy(); resolve('unreachable') })
  })
}

/** Ask the OS for a free port. */
function getFreePort(): Promise<number> {
  const net = require('net') as typeof import('net')
  return new Promise((resolve, reject) => {
    const srv = net.createServer()
    srv.once('error', reject)
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address()
      if (addr && typeof addr === 'object') {
        const port = addr.port
        srv.close(() => resolve(port))
      } else {
        srv.close(); reject(new Error('no port'))
      }
    })
  })
}

/**
 * GUI-launched apps on macOS get a minimal PATH (/usr/bin:/bin:/usr/sbin:/sbin)
 * that often does NOT include npm/node (homebrew, nvm, volta, fnm installs).
 * Augment PATH with the common install locations so spawned commands work
 * whether PLATPHORM was launched from a terminal or by double-clicking.
 */
function processEnvWithFullPath(): NodeJS.ProcessEnv {
  const home = os.homedir()
  const extras = [
    '/usr/local/bin',
    '/opt/homebrew/bin',
    '/opt/homebrew/sbin',
    path.join(home, '.volta', 'bin'),
    path.join(home, '.fnm'),
    path.join(home, 'n', 'bin'),
    path.join(home, '.local', 'bin')
  ]
  // nvm: add the most recent installed node version's bin
  try {
    const nvmVersions = path.join(home, '.nvm', 'versions', 'node')
    if (fs.existsSync(nvmVersions)) {
      const versions = fs.readdirSync(nvmVersions).sort().reverse()
      if (versions[0]) extras.unshift(path.join(nvmVersions, versions[0], 'bin'))
    }
  } catch {}
  const current = process.env.PATH ?? ''
  const merged = [...new Set([...current.split(':'), ...extras])].filter(Boolean).join(':')
  return { ...process.env, PATH: merged }
}

/**
 * Run `npm install` in a directory and wait for it to finish.
 * Used by preview:start to auto-install deps before starting the dev server.
 * Timeout: 5 min — cold-cache installs legitimately take minutes; warm installs return fast.
 */
function runNpmInstall(
  cwd: string,
  onOutput?: (line: string) => void
): Promise<{ success: boolean; error?: string }> {
  return new Promise((resolve) => {
    const proc = spawn('npm', ['install', '--prefer-offline', '--no-audit', '--no-fund'], {
      cwd,
      shell: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...processEnvWithFullPath(),
        // Suppress npm funding/audit noise so we get clean output
        NPM_CONFIG_FUND: '0',
        NPM_CONFIG_AUDIT: '0',
        NPM_CONFIG_LOGLEVEL: 'error'
      }
    })

    let output = ''
    const capture = (d: Buffer) => {
      const text = d.toString()
      output += text
      const lastLine = text.trim().split('\n').pop()
      if (lastLine && onOutput) onOutput(lastLine.slice(0, 120))
    }
    proc.stdout?.on('data', capture)
    proc.stderr?.on('data', capture)

    const timeout = setTimeout(() => {
      try { proc.kill('SIGTERM') } catch {}
      resolve({ success: false, error: `npm install timed out after 5 minutes.\n${output.slice(-500)}` })
    }, 300_000)

    proc.on('close', (code) => {
      clearTimeout(timeout)
      if (code === 0) {
        resolve({ success: true })
      } else {
        resolve({ success: false, error: `npm install exited with code ${code}.\n${output.slice(0, 800)}` })
      }
    })

    proc.on('error', (err) => {
      clearTimeout(timeout)
      resolve({ success: false, error: String(err) })
    })
  })
}

/** Detect the dev-script to run for a given project (npm run dev, yarn dev, etc.). */
/**
 * Find the best runnable project root — checks the given path first, then
 * one level of subfolders. Returns the path + command to run, or null if
 * nothing runnable is found anywhere.
 */
type RunnableProject =
  | { kind: 'script'; cwd: string; cmd: string; args: string[] }
  | { kind: 'static'; cwd: string }
  | { kind: 'unsupported'; reason: string }

function findRunnableProject(projectPath: string): RunnableProject | null {
  const PREFERRED = ['dev', 'start', 'serve', 'preview']

  const tryPath = (dir: string): RunnableProject | null => {
    const pkgPath = path.join(dir, 'package.json')
    if (!fs.existsSync(pkgPath)) {
      // No package.json — a plain HTML site is still previewable via the
      // built-in static server.
      if (fs.existsSync(path.join(dir, 'index.html'))) return { kind: 'static', cwd: dir }
      return null
    }
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'))
      const deps: Record<string, string> = { ...pkg.dependencies, ...pkg.devDependencies }
      const scripts: Record<string, string> = pkg.scripts ?? {}

      // React Native / Expo detection — Metro is a MOBILE bundler, not a web
      // server. Running 'react-native start' renders nothing in a browser.
      if (deps['react-native'] || deps['expo']) {
        if (deps['expo'] && (deps['react-native-web'] || deps['react-dom'])) {
          // Expo with web support — previewable in a browser. Port is chosen
          // dynamically at start time (PORT_PLACEHOLDER substituted with a
          // free port) — a hardcoded port breaks as soon as one zombie/other
          // window holds it, because npx expo can't prompt in non-interactive mode.
          return { kind: 'script', cwd: dir, cmd: 'npx', args: ['expo', 'start', '--web', '--port', 'PORT_PLACEHOLDER'] }
        }
        return {
          kind: 'unsupported',
          reason: 'This is a React Native MOBILE app — it cannot render in a browser preview. ' +
            'Ask the AI to either (a) convert it to an Expo app with web support ' +
            '(npx expo install react-dom react-native-web), or (b) build it as a web app instead.'
        }
      }

      for (const name of PREFERRED) {
        if (scripts[name]) {
          const useYarn = fs.existsSync(path.join(dir, 'yarn.lock'))
          const usePnpm = fs.existsSync(path.join(dir, 'pnpm-lock.yaml'))
          const pm = useYarn ? 'yarn' : usePnpm ? 'pnpm' : 'npm'
          return { kind: 'script', cwd: dir, cmd: pm, args: ['run', name] }
        }
      }
      // package.json exists but no script — check for local vite binary
      const viteLocal = path.join(dir, 'node_modules', '.bin', 'vite')
      if (fs.existsSync(viteLocal)) return { kind: 'script', cwd: dir, cmd: viteLocal, args: [] }
      // Last resort: static index.html next to a script-less package.json
      if (fs.existsSync(path.join(dir, 'index.html'))) return { kind: 'static', cwd: dir }
    } catch {}
    return null
  }

  // 1. Try the root first
  const root = tryPath(projectPath)
  if (root) return root

  // 2. Search one level of subfolders (website/, client/, app/, frontend/, etc.)
  // Prefer runnable projects over unsupported ones across subfolders.
  let fallback: RunnableProject | null = null
  try {
    const entries = fs.readdirSync(projectPath, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue
      const sub = tryPath(path.join(projectPath, entry.name))
      if (sub && sub.kind !== 'unsupported') return sub
      if (sub && !fallback) fallback = sub
    }
  } catch {}

  return fallback
}

/**
 * Built-in zero-dependency static file server for plain HTML projects.
 * Serves the directory on an OS-assigned free port.
 */
function startStaticServer(dir: string): Promise<{ server: HttpServer; port: number }> {
  const http = require('http') as typeof import('http')
  const MIME: Record<string, string> = {
    '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript',
    '.mjs': 'text/javascript', '.json': 'application/json', '.svg': 'image/svg+xml',
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
    '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2',
    '.ttf': 'font/ttf', '.mp4': 'video/mp4', '.mp3': 'audio/mpeg', '.wasm': 'application/wasm',
    '.txt': 'text/plain', '.xml': 'application/xml', '.pdf': 'application/pdf'
  }
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      try {
        const urlPath = decodeURIComponent((req.url ?? '/').split('?')[0])
        let filePath = path.join(dir, path.normalize(urlPath).replace(/^(\.\.[/\\])+/, ''))
        // Containment: never serve outside the project dir
        if (!filePath.startsWith(dir)) { res.writeHead(403); res.end('Forbidden'); return }
        if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
          filePath = path.join(filePath, 'index.html')
        }
        if (!fs.existsSync(filePath)) {
          // SPA-style fallback to root index.html
          const fallback = path.join(dir, 'index.html')
          if (fs.existsSync(fallback)) filePath = fallback
          else { res.writeHead(404); res.end('Not found'); return }
        }
        res.writeHead(200, {
          'Content-Type': MIME[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream',
          'Cache-Control': 'no-store'   // always fresh — the AI edits files live
        })
        fs.createReadStream(filePath).pipe(res)
      } catch {
        res.writeHead(500); res.end('Server error')
      }
    })
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address()
      if (addr && typeof addr === 'object') resolve({ server, port: addr.port })
      else reject(new Error('Static server failed to bind a port'))
    })
  })
}

function detectDevCommand(projectPath: string): { cmd: string; args: string[] } {
  const result = findRunnableProject(projectPath)
  if (result && result.kind === 'script') return { cmd: result.cmd, args: result.args }
  return { cmd: 'npm', args: ['run', 'dev'] }
}

/** Check if a TCP port is accepting connections on localhost */
function isPortOpen(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const net = require('net')
    const sock = net.createConnection({ port, host: '127.0.0.1' })
    sock.setTimeout(300)
    sock.on('connect', () => { sock.destroy(); resolve(true) })
    sock.on('error', () => resolve(false))
    sock.on('timeout', () => { sock.destroy(); resolve(false) })
  })
}

// Common dev-server ports. Vite: 5173 (+5174... when busy). Next/CRA: 3000.
const CANDIDATE_PORTS = [5173, 5174, 5175, 3000, 3001, 3002, 4000, 4173, 8080, 8000, 8888, 5000, 5001, 4321, 19006]

/** Snapshot which candidate ports are ALREADY open (e.g. PLATPHORM's own dev server). */
async function snapshotOpenPorts(): Promise<Set<number>> {
  const open = new Set<number>()
  await Promise.all(CANDIDATE_PORTS.map(async (p) => {
    if (await isPortOpen(p)) open.add(p)
  }))
  return open
}

/** Try to parse the dev server's printed URL (Vite/Next/CRA all print one). */
function parsePortFromOutput(output: string): number | null {
  const m = output.match(/https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0):(\d{2,5})/)
  if (m) {
    const port = parseInt(m[1], 10)
    if (port > 0 && port < 65536) return port
  }
  return null
}

/**
 * Poll for a NEWLY opened dev-server port until timeout.
 * `ignore` is the set of ports that were already open before we spawned the
 * server — critically, this excludes PLATPHORM's own dev server (5173 in dev
 * mode), which previously caused the preview to "detect" PLATPHORM itself and
 * render a blank screen.
 * `getOutput` lets us check the server's own printed URL first — the most
 * reliable signal, and it catches ports outside the candidate list.
 */
async function detectNewPort(
  timeoutMs: number,
  ignore: Set<number>,
  getOutput: () => string
): Promise<number | null> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    // 1. Most reliable: the URL the server itself printed
    const printed = parsePortFromOutput(getOutput())
    if (printed && !ignore.has(printed) && await isPortOpen(printed)) return printed
    // 2. Fallback: scan candidate ports, skipping pre-existing ones
    for (const port of CANDIDATE_PORTS) {
      if (ignore.has(port)) continue
      if (await isPortOpen(port)) return port
    }
    await new Promise(r => setTimeout(r, 500))
  }
  return null
}

// Persistent settings store — lives in the OS user-data directory,
// never in source control. API keys are stored here so they survive restarts.
const store = new Store<{
  providers: { openrouter?: string; anthropic?: string; openai?: string }
  preferredProvider: string
  fontSize: number
  fontFamily: string
}>({
  name: 'platphorm-settings',
  defaults: {
    providers: {},
    preferredProvider: 'openrouter',
    fontSize: 14,
    fontFamily: "'JetBrains Mono', 'Fira Code', monospace"
  }
})

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1600,
    height: 1000,
    minWidth: 1200,
    minHeight: 700,
    show: false,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#0a0a0f',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      webviewTag: true,         // <webview> renders the live preview in-app (own process, no cross-origin iframe limits)
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.platphorm.app')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  registerIpcHandlers()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

function registerIpcHandlers(): void {
  // File system operations
  ipcMain.handle('fs:openFolder', async () => {
    const result = await dialog.showOpenDialog({ properties: ['openDirectory'] })
    if (result.canceled || !result.filePaths.length) return null
    return result.filePaths[0]
  })

  ipcMain.handle('fs:readFile', async (_event, filePath: string) => {
    try {
      return fs.readFileSync(filePath, 'utf-8')
    } catch {
      return null
    }
  })

  ipcMain.handle('fs:writeFile', async (_event, filePath: string, content: string) => {
    try {
      fs.mkdirSync(path.dirname(filePath), { recursive: true })
      fs.writeFileSync(filePath, content, 'utf-8')
      return { success: true }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  ipcMain.handle('fs:readDir', async (_event, dirPath: string) => {
    try {
      const entries = fs.readdirSync(dirPath, { withFileTypes: true })
      return entries.map((e) => ({
        name: e.name,
        isDirectory: e.isDirectory(),
        path: path.join(dirPath, e.name)
      }))
    } catch {
      return []
    }
  })

  ipcMain.handle('fs:exists', async (_event, filePath: string) => {
    return fs.existsSync(filePath)
  })

  ipcMain.handle('fs:mkdir', async (_event, dirPath: string) => {
    try {
      fs.mkdirSync(dirPath, { recursive: true })
      return { success: true }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  ipcMain.handle('fs:getHome', async () => {
    return os.homedir()
  })

  // ── Persistent settings (electron-store) ──────────────────────────────────
  // API keys are stored in the OS user-data directory — never in source control.

  ipcMain.handle('store:get', (_event, key: string) => {
    return store.get(key)
  })

  ipcMain.handle('store:set', (_event, key: string, value: unknown) => {
    store.set(key, value)
    return { success: true }
  })

  ipcMain.handle('store:delete', (_event, key: string) => {
    store.delete(key as any)
    return { success: true }
  })

  ipcMain.handle('store:getAll', () => {
    return store.store
  })

  // ── Live preview: spawn dev server ────────────────────────────────────────
  ipcMain.handle('preview:start', async (event, projectPath: string) => {
    // Progress reporting — the renderer shows these so the user never stares
    // at a dead spinner wondering what's happening.
    const progress = (stage: string, detail?: string) => {
      try { event.sender.send('preview:progress', { stage, detail }) } catch {}
    }

    // Kill any existing server for this project
    stopPreviewFor(projectPath)

    progress('Scanning project for a runnable dev script…')
    const runnable = findRunnableProject(projectPath)
    if (!runnable) {
      return {
        success: false,
        error: 'No runnable project found. The project needs either an index.html or a package.json with a "dev", "start", "serve" or "preview" script. Ask the AI to set one up.'
      }
    }

    // Unsupported project types (e.g. bare React Native) — explain instead of
    // spawning a doomed Metro process.
    if (runnable.kind === 'unsupported') {
      return { success: false, error: runnable.reason }
    }

    // Plain HTML projects — serve them with the built-in static server.
    // Instant, zero dependencies, no npm needed.
    if (runnable.kind === 'static') {
      progress('Starting built-in static server…')
      try {
        const { server, port } = await startStaticServer(runnable.cwd)
        const url = `http://127.0.0.1:${port}`
        previewProcesses.set(projectPath, { server, port, url })
        return { success: true, port, url }
      } catch (err) {
        return { success: false, error: `Static server failed to start: ${String(err)}` }
      }
    }

    const { cwd: runnableCwd, cmd } = runnable
    let args = runnable.args

    // Dynamic port substitution — commands that need an explicit port (Expo web)
    // get a fresh OS-assigned free port every start. Hardcoded ports break the
    // moment a zombie process or another window holds them, and CLIs like
    // 'npx expo' cannot prompt for an alternative in non-interactive mode.
    let expectedPort: number | null = null
    if (args.includes('PORT_PLACEHOLDER')) {
      expectedPort = await getFreePort()
      args = args.map(a => a === 'PORT_PLACEHOLDER' ? String(expectedPort) : a)
    }

    // Auto-install dependencies if node_modules is missing.
    // The user should never have to run npm install manually — we do it for them.
    const nodeModulesPath = path.join(runnableCwd, 'node_modules')
    if (!fs.existsSync(nodeModulesPath)) {
      progress('Installing dependencies (npm install)…', 'first run can take a few minutes')
      const installResult = await runNpmInstall(runnableCwd, (line) => {
        progress('Installing dependencies…', line)
      })
      if (!installResult.success) {
        return {
          success: false,
          error: `Auto-install failed in ${runnableCwd}:\n${installResult.error}`
        }
      }
    }

    progress(`Starting dev server (${cmd} ${args.join(' ')})…`)

    // Snapshot ports that are already open BEFORE spawning — anything in this
    // set (including PLATPHORM's own dev server) must not be mistaken for the
    // user's server.
    const preExistingPorts = await snapshotOpenPorts()

    let startupError = ''
    let procExited = false
    let procExitCode: number | null = null
    const proc = spawn(cmd, args, {
      cwd: runnableCwd,
      env: {
        ...processEnvWithFullPath(),
        BROWSER: 'none',
        VITE_OPEN: 'false',
        NEXT_TELEMETRY_DISABLED: '1',
        // NOTE: deliberately NOT CI=1 — Metro reads CI and disables file
        // watching ("reloads are disabled"), which kills hot reload. Expo is
        // already non-interactive because stdin is not a TTY; prompt-deaths
        // are prevented by assigning a guaranteed-free port up front.
        EXPO_NO_TELEMETRY: '1'
      },
      shell: true,
      // Own process group — lets stopPreviewFor kill the WHOLE tree (shell +
      // Metro/Vite/Next). Without this, killing the shell leaks an orphaned
      // dev server that squats on its port and breaks the next preview start.
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe']
    })
    proc.on('close', (code) => { procExited = true; procExitCode = code })

    // Capture startup output — used both to parse the server's printed URL and
    // to report errors if the server never opens a port.
    proc.stdout?.on('data', (d: Buffer) => { startupError += d.toString().slice(0, 500) })
    proc.stderr?.on('data', (d: Buffer) => { startupError += d.toString().slice(0, 500) })
    proc.on('error', () => {})   // prevent unhandled error crashes

    // Give the process 1.5s to start, then detect the NEW port (parsed from the
    // server's own output first, then candidate-port scan excluding ports that
    // were already open — e.g. PLATPHORM's own dev server).
    await new Promise(r => setTimeout(r, 1500))

    // If the process already died (command not found, crash on boot), fail
    // fast with its output instead of polling ports for 30 futile seconds.
    if (procExited && procExitCode !== 0) {
      return {
        success: false,
        error: `Dev server exited immediately (code ${procExitCode}).\n\nServer output:\n${startupError.slice(0, 800).trim() || '(no output — the command may not exist on PATH)'}`
      }
    }

    progress('Waiting for the dev server to open a port…')
    // If we assigned the port ourselves, check it directly first — fastest and
    // unambiguous. Fall back to output-parsing + candidate scan.
    let port: number | null = null
    if (expectedPort) {
      const deadline = Date.now() + 28_500
      while (Date.now() < deadline && !port) {
        if (await isPortOpen(expectedPort)) { port = expectedPort; break }
        if (procExited) break
        await new Promise(r => setTimeout(r, 500))
      }
    }
    if (!port) {
      port = await detectNewPort(expectedPort ? 3_000 : 28_500, preExistingPorts, () => startupError)
    }

    if (!port) {
      killProcessTree(proc)   // kill the whole tree — a leaked Metro/Vite squats on the port forever
      const detail = startupError.trim()
        ? `\n\nServer output:\n${startupError.slice(0, 600).trim()}`
        : ''
      return {
        success: false,
        error: `Dev server did not open a port within 30s.${procExited ? ` (process exited with code ${procExitCode})` : ''}${detail}`
      }
    }

    // Content sanity check — catching Metro's native manifest JSON here turns
    // "the preview shows gibberish JSON" into an actionable error message.
    progress('Checking the server is serving a web page…')
    let content = await probeRootContent(port)
    if (content === 'expo-manifest') {
      // Give the web bundle a few more seconds — first web build can lag behind
      // the manifest endpoint coming up.
      for (let i = 0; i < 5 && content === 'expo-manifest'; i++) {
        await new Promise(r => setTimeout(r, 2000))
        content = await probeRootContent(port)
      }
    }
    if (content === 'expo-manifest') {
      killProcessTree(proc)
      return {
        success: false,
        error: 'The server is serving Expo\'s native-app manifest instead of a web page — web output is not configured correctly. ' +
          'Ask the AI to: (1) set "web": { "bundler": "metro" } in app.json (webpack is deprecated and serves no web page), ' +
          '(2) run npx expo install @expo/metro-runtime react-dom react-native-web, ' +
          '(3) verify with npx expo export --platform web that the web build compiles.'
      }
    }

    const url = `http://localhost:${port}`
    previewProcesses.set(projectPath, { proc, port, url })
    return { success: true, port, url }
  })

  // ── Live preview: stop dev server ─────────────────────────────────────────
  ipcMain.handle('preview:stop', async (_event, projectPath: string) => {
    stopPreviewFor(projectPath)
    return { success: true }
  })

  // ── Live preview: status ──────────────────────────────────────────────────
  ipcMain.handle('preview:status', async (_event, projectPath: string) => {
    const existing = previewProcesses.get(projectPath)
    if (!existing) return { running: false }
    return { running: true, port: existing.port, url: existing.url }
  })

  // Kill all preview servers (and their process trees) on app quit —
  // leaked dev servers squat on ports and break future preview starts.
  app.on('before-quit', () => {
    for (const { proc, server } of previewProcesses.values()) {
      killProcessTree(proc)
      try { server?.close() } catch {}
    }
  })

  // ── Shell utilities ───────────────────────────────────────────────────────
  // electronAPI from @electron-toolkit/preload does NOT expose shell.
  // We route safe operations through IPC handlers instead.

  ipcMain.handle('shell:openExternal', async (_event, url: string) => {
    if (/^https?:\/\//i.test(url)) {
      await shell.openExternal(url)
      return { success: true }
    }
    return { success: false, error: 'Only http/https URLs are supported' }
  })

  // ── shell:runCommand — executes a shell command in a project directory ────
  // Used by the agent for: npm install, npx tsc --noEmit, git status, etc.
  //
  // Security model:
  // 1. The command is split on shell separators (&&, ||, ;, |) and EVERY
  //    segment must start with an allowlisted prefix — a single allowed prefix
  //    can no longer smuggle a second arbitrary command behind it.
  // 2. Destructive patterns are explicitly blocked regardless of allowlist
  //    (rm targeting paths outside cwd, sudo, shutdown, eval-style node, etc.).
  // 3. Real exit codes are reported. A non-zero exit is success:false — the
  //    agent must never be told a failed install/build succeeded.
  const ALLOWED_COMMAND_PREFIXES = [
    'npm ', 'npx ', 'yarn ', 'pnpm ', 'node ',
    'git status', 'git diff', 'git log', 'git add', 'git commit', 'git init',
    'which ', 'ls', 'cat ', 'head ', 'tail ', 'wc ',
    'curl ', 'wget ',
    'mkdir ', 'cp ', 'mv ', 'rm ',
    'touch ', 'echo ', 'find ', 'grep '
  ]

  // Patterns that are never allowed, regardless of prefix allowlist.
  const BLOCKED_PATTERNS: Array<{ re: RegExp; reason: string }> = [
    { re: /\bsudo\b/,                          reason: 'sudo is not allowed' },
    // rm is validated per-segment with cwd-aware containment in validateCommand —
    // absolute paths INSIDE the project root are allowed, everything else blocked.
    { re: /\bnode\s+(-e|--eval|-p|--print)\b/, reason: 'node eval flags are not allowed — write a script file and run it' },
    { re: /\b(shutdown|reboot|halt|mkfs|dd)\b/, reason: 'system-level commands are not allowed' },
    { re: />\s*\/(etc|usr|bin|sbin|var|boot)\//, reason: 'redirecting output into system directories is not allowed' },
    { re: /\bchmod\s+777\b/,                   reason: 'chmod 777 is not allowed' },
    { re: /\$\(|`/,                            reason: 'command substitution is not allowed' }
  ]

  function validateCommand(command: string, cwd: string): { ok: boolean; reason?: string } {
    for (const { re, reason } of BLOCKED_PATTERNS) {
      if (re.test(command)) return { ok: false, reason }
    }
    // Validate every segment of a chained command, not just the first.
    const segments = command.split(/&&|\|\||;|\|/).map(s => s.trim()).filter(Boolean)
    if (!segments.length) return { ok: false, reason: 'empty command' }
    for (const seg of segments) {
      // `cd` segments: relative paths are always fine (cwd is already contained),
      // absolute paths are allowed ONLY if they resolve inside the project root.
      // rm segments: every non-flag argument must resolve inside the project
      // root. Relative paths are fine (cwd is contained); absolute paths are
      // allowed only within the root; ~ and the root itself are blocked.
      const rmMatch = seg.match(/^rm\s+(.+)$/)
      if (rmMatch) {
        const targets = rmMatch[1].split(/\s+/)
          .map(t => t.replace(/^["']|["']$/g, ''))
          .filter(t => t && !t.startsWith('-'))
        if (!targets.length) return { ok: false, reason: 'rm with no target' }
        const resolvedRoot = path.resolve(cwd)
        for (const target of targets) {
          if (target.startsWith('~')) {
            return { ok: false, reason: `rm on home-relative path is not allowed: "${target}"` }
          }
          // Resolve relative targets against cwd; strip a trailing glob for the check.
          const globless = target.replace(/[*?].*$/, '')
          const resolved = path.resolve(path.isAbsolute(target) ? globless : path.join(cwd, globless))
          const inside = resolved === resolvedRoot || resolved.startsWith(resolvedRoot + path.sep)
          if (!inside) {
            return { ok: false, reason: `rm outside the project root is not allowed: "${target}"` }
          }
          if (resolved === resolvedRoot && !/[*?]/.test(target)) {
            return {
              ok: false,
              reason: `rm of the project root itself is not allowed — it is open in the editor. ` +
                `Delete its CONTENTS instead (e.g. "rm -rf ./src ./App.tsx") or convert the project in place.`
            }
          }
        }
        continue
      }
      const cdMatch = seg.match(/^cd\s+("[^"]+"|'[^']+'|\S+)$/)
      if (cdMatch) {
        const target = cdMatch[1].replace(/^["']|["']$/g, '')
        if (target.startsWith('~')) {
          return { ok: false, reason: `cd into home-relative path is not allowed: "${target}"` }
        }
        if (path.isAbsolute(target)) {
          const resolvedTarget = path.resolve(target)
          const resolvedRoot = path.resolve(cwd)
          if (resolvedTarget !== resolvedRoot && !resolvedTarget.startsWith(resolvedRoot + path.sep)) {
            return {
              ok: false,
              reason: `cd outside the project root is not allowed: "${target}". ` +
                `Commands already run from the project root (${cwd}) — use relative paths, e.g. "cd subfolder && npm install".`
            }
          }
        }
        continue
      }
      const allowed = ALLOWED_COMMAND_PREFIXES.some(p =>
        seg.startsWith(p) || seg === p.trim()
      )
      if (!allowed) return { ok: false, reason: `segment not in allowlist: "${seg.slice(0, 60)}"` }
    }
    return { ok: true }
  }

  // Long-running operations (installs, builds) legitimately exceed 60s on cold
  // caches. 5 minutes for those; 90s for everything else.
  function commandTimeout(command: string): number {
    return /\b(install|build|create|init|add)\b/.test(command) ? 300_000 : 90_000
  }

  ipcMain.handle('shell:runCommand', async (_event, cwd: string, command: string) => {
    const verdict = validateCommand(command, cwd)
    if (!verdict.ok) {
      return { success: false, error: `Command rejected: ${verdict.reason}` }
    }
    // Containment: cwd must exist and be a directory.
    if (!fs.existsSync(cwd) || !fs.statSync(cwd).isDirectory()) {
      return { success: false, error: `Working directory does not exist: ${cwd}` }
    }

    return new Promise<{ success: boolean; output?: string; error?: string; exitCode?: number }>((resolve) => {
      const proc = spawn(command, [], {
        cwd,
        shell: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...processEnvWithFullPath(), NPM_CONFIG_FUND: '0', NPM_CONFIG_AUDIT: '0' }
      })

      let output = ''
      proc.stdout?.on('data', (d: Buffer) => { output += d.toString() })
      proc.stderr?.on('data', (d: Buffer) => { output += d.toString() })

      const ms = commandTimeout(command)
      const timeout = setTimeout(() => {
        try { proc.kill('SIGTERM') } catch {}
        resolve({
          success: false,
          error: `Command timed out after ${Math.round(ms / 1000)}s`,
          output: output.slice(-2000)
        })
      }, ms)

      proc.on('close', (code) => {
        clearTimeout(timeout)
        // Honest exit codes — a non-zero exit is a FAILURE. The agent must see
        // the real outcome or it will build on top of broken installs.
        if (code === 0) {
          resolve({ success: true, output: output.slice(-3000), exitCode: 0 })
        } else {
          resolve({
            success: false,
            exitCode: code ?? -1,
            error: `Command exited with code ${code}`,
            output: output.slice(-3000)
          })
        }
      })

      proc.on('error', (err) => {
        clearTimeout(timeout)
        resolve({ success: false, error: String(err), output: output.slice(-2000) })
      })
    })
  })
}
