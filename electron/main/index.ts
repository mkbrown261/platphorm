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

/** Detect the dev-script to run for a given project (npm run dev, yarn dev, etc.). */
function detectDevCommand(projectPath: string): { cmd: string; args: string[] } {
  const pkgPath = path.join(projectPath, 'package.json')
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'))
      const scripts: Record<string, string> = pkg.scripts ?? {}
      // Prefer explicit dev/start scripts
      const preferred = ['dev', 'start', 'serve', 'preview']
      for (const name of preferred) {
        if (scripts[name]) {
          const useYarn = fs.existsSync(path.join(projectPath, 'yarn.lock'))
          const usePnpm = fs.existsSync(path.join(projectPath, 'pnpm-lock.yaml'))
          const pm = useYarn ? 'yarn' : usePnpm ? 'pnpm' : 'npm'
          return { cmd: pm, args: ['run', name] }
        }
      }
    } catch {}
  }
  // Fallback: vite if installed locally
  const viteLocal = path.join(projectPath, 'node_modules', '.bin', 'vite')
  if (fs.existsSync(viteLocal)) return { cmd: viteLocal, args: [] }
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
      webviewTag: true          // required for <webview> in PreviewPanel
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

    const { cmd, args } = detectDevCommand(projectPath)

    const proc = spawn(cmd, args, {
      cwd: projectPath,
      env: {
        ...process.env,
        BROWSER: 'none',
        VITE_OPEN: 'false',
        NEXT_TELEMETRY_DISABLED: '1'
      },
      shell: true,
      stdio: 'ignore'   // don't capture — just let it run
    })

    proc.on('error', () => {})   // prevent unhandled error crashes

    // Give the process 1.5s to start, then poll common ports every 500ms.
    // This works regardless of what the server prints — Vite (5173), Next (3000),
    // CRA (3000), Express, etc. We just find whatever port opened.
    await new Promise(r => setTimeout(r, 1500))

    const port = await detectOpenPort(28_500)   // 1.5s already spent above = 30s total

    if (!port) {
      try { proc.kill('SIGTERM') } catch {}
      return {
        success: false,
        error: 'Dev server did not start within 30s. Make sure npm install is complete and the project has a dev script in package.json.'
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
    'node --version', 'node -v'
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

      const timeout = setTimeout(() => {
        proc.kill('SIGTERM')
        resolve({ success: false, error: 'Command timed out after 30s', output: output.slice(0, 2000) })
      }, 30_000)

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
