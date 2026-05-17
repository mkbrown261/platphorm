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
const previewProcesses = new Map<string, { proc: ChildProcess; port: number }>()

/** Find a free TCP port in the 3100-4200 range. */
async function findFreePort(start = 3100): Promise<number> {
  const net = await import('net')
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.unref()
    server.on('error', () => resolve(findFreePort(start + 1)))
    server.listen(start, '127.0.0.1', () => {
      const addr = server.address() as any
      server.close(() => resolve(addr.port))
    })
  })
}

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
      existing.proc.kill('SIGTERM')
      previewProcesses.delete(projectPath)
    }

    const port = await findFreePort()
    const { cmd, args } = detectDevCommand(projectPath)

    const env = {
      ...process.env,
      PORT: String(port),
      VITE_PORT: String(port),
      // Tell vite/CRA/etc. to use the assigned port and not open a browser
      BROWSER: 'none',
      VITE_OPEN: 'false'
    }

    const proc = spawn(cmd, args, {
      cwd: projectPath,
      env,
      shell: true,
      stdio: ['ignore', 'pipe', 'pipe']
    })

    previewProcesses.set(projectPath, { proc, port })

    // Wait up to 20s for the dev server to become reachable
    const ready = await new Promise<boolean>((resolve) => {
      const deadline = setTimeout(() => resolve(false), 20_000)
      const check = async () => {
        try {
          const net = await import('net')
          const sock = net.createConnection({ port, host: '127.0.0.1' })
          sock.on('connect', () => { sock.destroy(); clearTimeout(deadline); resolve(true) })
          sock.on('error', () => setTimeout(check, 400))
        } catch {
          setTimeout(check, 400)
        }
      }
      // Give the process 1s to start before polling
      setTimeout(check, 1000)

      proc.on('error', () => { clearTimeout(deadline); resolve(false) })
      proc.on('exit', () => { clearTimeout(deadline); resolve(false) })
    })

    if (!ready) {
      proc.kill('SIGTERM')
      previewProcesses.delete(projectPath)
      return { success: false, error: 'Dev server did not start within 20s. Is npm install complete?' }
    }

    return { success: true, port, url: `http://localhost:${port}` }
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
    return { running: true, port: existing.port, url: `http://localhost:${existing.port}` }
  })

  // Kill all preview servers on app quit
  app.on('before-quit', () => {
    for (const { proc } of previewProcesses.values()) {
      try { proc.kill('SIGTERM') } catch {}
    }
  })

  // ── Shell utilities ───────────────────────────────────────────────────────
  // electronAPI from @electron-toolkit/preload does NOT expose shell.
  // We route openExternal through a safe IPC handler here instead.
  ipcMain.handle('shell:openExternal', async (_event, url: string) => {
    // Only allow http/https to prevent arbitrary protocol abuse
    if (/^https?:\/\//i.test(url)) {
      await shell.openExternal(url)
      return { success: true }
    }
    return { success: false, error: 'Only http/https URLs are supported' }
  })
}
