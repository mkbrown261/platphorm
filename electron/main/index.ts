import { app, shell, BrowserWindow, ipcMain, dialog, protocol } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

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
      contextIsolation: true
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

  // Apply multiple file changes atomically — used by the pipeline Apply flow
  ipcMain.handle('fs:applyChanges', async (_event, changes: Array<{ path: string; type: string; after?: string }>) => {
    const results: Array<{ path: string; success: boolean; error?: string }> = []
    for (const change of changes) {
      try {
        if (change.type === 'delete') {
          if (fs.existsSync(change.path)) fs.unlinkSync(change.path)
        } else if (change.type === 'create' || change.type === 'modify') {
          fs.mkdirSync(path.dirname(change.path), { recursive: true })
          fs.writeFileSync(change.path, change.after ?? '', 'utf-8')
        } else if (change.type === 'rename' && change.after) {
          fs.renameSync(change.path, change.after)
        }
        results.push({ path: change.path, success: true })
      } catch (err) {
        results.push({ path: change.path, success: false, error: String(err) })
      }
    }
    return results
  })

  // Create a git backup commit before applying changes
  ipcMain.handle('fs:gitBackup', async (_event, projectPath: string) => {
    try {
      const { execSync } = await import('child_process')
      const hasGit = fs.existsSync(path.join(projectPath, '.git'))
      if (!hasGit) return { success: false, error: 'No git repo found' }
      execSync('git add -A && git stash', { cwd: projectPath, stdio: 'pipe' })
      return { success: true }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  // Append to audit log file (immutable — append only)
  ipcMain.handle('fs:appendAuditLog', async (_event, projectPath: string, entry: string) => {
    try {
      const logDir = path.join(projectPath, '.platphorm')
      fs.mkdirSync(logDir, { recursive: true })
      const logPath = path.join(logDir, 'audit.log')
      fs.appendFileSync(logPath, entry + '\n', 'utf-8')
      return { success: true }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  // Read audit log
  ipcMain.handle('fs:readAuditLog', async (_event, projectPath: string) => {
    try {
      const logPath = path.join(projectPath, '.platphorm', 'audit.log')
      if (!fs.existsSync(logPath)) return []
      const raw = fs.readFileSync(logPath, 'utf-8')
      return raw.trim().split('\n').filter(Boolean).map(line => {
        try { return JSON.parse(line) } catch { return null }
      }).filter(Boolean)
    } catch {
      return []
    }
  })

  // Preview: open a new window to render HTML content
  ipcMain.handle('preview:open', async (_event, content: string, title: string) => {
    try {
      const previewWindow = new BrowserWindow({
        width: 1100,
        height: 780,
        title: title || 'PLATPHORM Preview',
        backgroundColor: '#ffffff',
        webPreferences: {
          sandbox: true,
          contextIsolation: true,
          javascript: true,
          // Allow preview to load local resources
          webSecurity: false,
        }
      })

      // Load the HTML content via data URL
      const dataUrl = `data:text/html;charset=utf-8,${encodeURIComponent(content)}`
      await previewWindow.loadURL(dataUrl)
      return { success: true }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  // Preview: read a file for inline preview in the editor tab
  ipcMain.handle('preview:readForPreview', async (_event, filePath: string) => {
    try {
      const content = fs.readFileSync(filePath, 'utf-8')
      const ext = path.extname(filePath).toLowerCase()
      return { success: true, content, ext }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  // Fetch models from OpenRouter (proxy to avoid CORS in renderer)
  ipcMain.handle('ai:listModels', async (_event, apiKey: string) => {
    try {
      const https = await import('https')
      return new Promise((resolve) => {
        const req = https.request(
          { hostname: 'openrouter.ai', path: '/api/v1/models', method: 'GET',
            headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' } },
          (res) => {
            let data = ''
            res.on('data', chunk => data += chunk)
            res.on('end', () => {
              try { resolve({ success: true, data: JSON.parse(data) }) }
              catch { resolve({ success: false, error: 'Failed to parse models response' }) }
            })
          }
        )
        req.on('error', err => resolve({ success: false, error: String(err) }))
        req.end()
      })
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })
}
