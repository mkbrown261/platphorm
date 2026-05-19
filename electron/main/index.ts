import { app, shell, BrowserWindow, ipcMain, dialog } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { spawn, ChildProcess } from 'child_process'
import Store from 'electron-store'

// ── Preview dev-server process registry ──────────────────────────────────────
// Tracks one running dev server per project root path.
const previewProcesses = new Map<string, { proc: ChildProcess; port: number; url: string }>()

/**
 * Run `npm install` in a directory and wait for it to finish.
 * Used by preview:start to auto-install deps before starting the dev server.
 * Timeout: 60s — --prefer-offline + --no-audit + --no-fund hits local cache fast.
 */
function runNpmInstall(cwd: string): Promise<{ success: boolean; error?: string }> {
  return new Promise((resolve) => {
    const proc = spawn('npm', ['install', '--prefer-offline', '--no-audit', '--no-fund'], {
      cwd,
      shell: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        // Suppress npm funding/audit noise so we get clean output
        NPM_CONFIG_FUND: '0',
        NPM_CONFIG_AUDIT: '0',
        NPM_CONFIG_LOGLEVEL: 'error'
      }
    })

    let output = ''
    proc.stdout?.on('data', (d: Buffer) => { output += d.toString() })
    proc.stderr?.on('data', (d: Buffer) => { output += d.toString() })

    const timeout = setTimeout(() => {
      try { proc.kill('SIGTERM') } catch {}
      resolve({ success: false, error: `npm install timed out after 60s.\n${output.slice(0, 500)}` })
    }, 60_000)

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
function findRunnableProject(projectPath: string): {
  cwd: string; cmd: string; args: string[]
} | null {
  const PREFERRED = ['dev', 'start', 'serve', 'preview']

  const tryPath = (dir: string): { cwd: string; cmd: string; args: string[] } | null => {
    const pkgPath = path.join(dir, 'package.json')
    if (!fs.existsSync(pkgPath)) return null
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'))
      const scripts: Record<string, string> = pkg.scripts ?? {}
      for (const name of PREFERRED) {
        if (scripts[name]) {
          const useYarn = fs.existsSync(path.join(dir, 'yarn.lock'))
          const usePnpm = fs.existsSync(path.join(dir, 'pnpm-lock.yaml'))
          const pm = useYarn ? 'yarn' : usePnpm ? 'pnpm' : 'npm'
          return { cwd: dir, cmd: pm, args: ['run', name] }
        }
      }
      // package.json exists but no script — check for local vite binary
      const viteLocal = path.join(dir, 'node_modules', '.bin', 'vite')
      if (fs.existsSync(viteLocal)) return { cwd: dir, cmd: viteLocal, args: [] }
    } catch {}
    return null
  }

  // 1. Try the root first
  const root = tryPath(projectPath)
  if (root) return root

  // 2. Search one level of subfolders (website/, client/, app/, frontend/, etc.)
  try {
    const entries = fs.readdirSync(projectPath, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue
      const sub = tryPath(path.join(projectPath, entry.name))
      if (sub) return sub
    }
  } catch {}

  return null
}

function detectDevCommand(projectPath: string): { cmd: string; args: string[] } {
  const result = findRunnableProject(projectPath)
  if (result) return { cmd: result.cmd, args: result.args }
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

/**
 * Poll a list of common dev-server ports until one responds or timeout.
 * Returns the first open port, or null.
 * Vite default: 5173. Next: 3000. CRA: 3000. Most others: 3000/8080/4000.
 */
async function detectOpenPort(timeoutMs: number): Promise<number | null> {
  const PORTS = [5173, 3000, 3001, 4000, 4173, 8080, 8000, 8888, 5000, 5001, 4321]
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    for (const port of PORTS) {
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
      webviewTag: false,        // using iframe instead of webview for preview
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
  ipcMain.handle('preview:start', async (_event, projectPath: string) => {
    // Kill any existing server for this project
    const existing = previewProcesses.get(projectPath)
    if (existing) {
      try { existing.proc.kill('SIGTERM') } catch {}
      previewProcesses.delete(projectPath)
    }

    const runnable = findRunnableProject(projectPath)
    if (!runnable) {
      return {
        success: false,
        error: 'No runnable project found. Make sure the project has a package.json with a "dev" or "start" script and dependencies are installed (npm install).'
      }
    }

    const { cwd: runnableCwd, cmd, args } = runnable

    // Auto-install dependencies if node_modules is missing.
    // The user should never have to run npm install manually — we do it for them.
    const nodeModulesPath = path.join(runnableCwd, 'node_modules')
    if (!fs.existsSync(nodeModulesPath)) {
      const installResult = await runNpmInstall(runnableCwd)
      if (!installResult.success) {
        return {
          success: false,
          error: `Auto-install failed in ${runnableCwd}:\n${installResult.error}`
        }
      }
    }

    let startupError = ''
    const proc = spawn(cmd, args, {
      cwd: runnableCwd,
      env: {
        ...process.env,
        BROWSER: 'none',
        VITE_OPEN: 'false',
        NEXT_TELEMETRY_DISABLED: '1'
      },
      shell: true,
      stdio: ['ignore', 'pipe', 'pipe']
    })

    // Capture startup output so we can report errors if the server never opens a port
    proc.stdout?.on('data', (d: Buffer) => { startupError += d.toString().slice(0, 500) })
    proc.stderr?.on('data', (d: Buffer) => { startupError += d.toString().slice(0, 500) })
    proc.on('error', () => {})   // prevent unhandled error crashes

    // Give the process 1.5s to start, then poll common ports every 500ms.
    // This works regardless of what the server prints — Vite (5173), Next (3000),
    // CRA (3000), Express, etc. We just find whatever port opened.
    await new Promise(r => setTimeout(r, 1500))

    const port = await detectOpenPort(28_500)   // 1.5s already spent above = 30s total

    if (!port) {
      try { proc.kill('SIGTERM') } catch {}
      const detail = startupError.trim()
        ? `\n\nServer output:\n${startupError.slice(0, 600).trim()}`
        : ''
      return {
        success: false,
        error: `Dev server did not open a port within 30s. Make sure npm install is complete and the project has a dev script in package.json.${detail}`
      }
    }

    const url = `http://localhost:${port}`
    previewProcesses.set(projectPath, { proc, port, url })
    return { success: true, port, url }
  })

  // ── Live preview: stop dev server ─────────────────────────────────────────
  ipcMain.handle('preview:stop', async (_event, projectPath: string) => {
    const existing = previewProcesses.get(projectPath)
    if (existing) {
      existing.proc.kill('SIGTERM')
      previewProcesses.delete(projectPath)
    }
    return { success: true }
  })

  // ── Live preview: status ──────────────────────────────────────────────────
  ipcMain.handle('preview:status', async (_event, projectPath: string) => {
    const existing = previewProcesses.get(projectPath)
    if (!existing) return { running: false }
    return { running: true, port: existing.port, url: existing.url }
  })

  // Kill all preview servers on app quit
  app.on('before-quit', () => {
    for (const { proc } of previewProcesses.values()) {
      try { proc.kill('SIGTERM') } catch {}
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
  // Used by the agent for: npm run build, npx tsc --noEmit, git status, etc.
  // Allowlisted commands only — no arbitrary shell access.
  const ALLOWED_COMMAND_PREFIXES = [
    'npm ', 'npx ', 'yarn ', 'pnpm ',
    'git status', 'git diff', 'git log',
    'node --version', 'node -v',
    'node ', 'which ', 'ls ', 'cat ',
    'curl ', 'wget ',
    'mkdir ', 'cp ', 'mv ', 'rm ',
    'touch ', 'echo ', 'find ', 'grep '
  ]

  ipcMain.handle('shell:runCommand', async (_event, cwd: string, command: string) => {
    const allowed = ALLOWED_COMMAND_PREFIXES.some(p => command.trimStart().startsWith(p))
    if (!allowed) {
      return { success: false, error: `Command not in allowlist: ${command}` }
    }

    return new Promise<{ success: boolean; output?: string; error?: string }>((resolve) => {
      const proc = spawn(command, [], {
        cwd,
        shell: true,
        stdio: ['ignore', 'pipe', 'pipe']
      })

      let output = ''
      proc.stdout?.on('data', (d: Buffer) => { output += d.toString() })
      proc.stderr?.on('data', (d: Buffer) => { output += d.toString() })

      // 60s timeout — warm cache installs are fast; cold installs should still complete.
      const timeout = setTimeout(() => {
        proc.kill('SIGTERM')
        resolve({ success: false, error: 'Command timed out after 60s', output: output.slice(0, 2000) })
      }, 60_000)

      proc.on('close', (code) => {
        clearTimeout(timeout)
        resolve({ success: true, output: output.slice(0, 3000) })
      })

      proc.on('error', (err) => {
        clearTimeout(timeout)
        resolve({ success: false, error: String(err), output })
      })
    })
  })
}
