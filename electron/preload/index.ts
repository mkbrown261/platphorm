import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

const api = {
  fs: {
    openFolder: (): Promise<string | null> => ipcRenderer.invoke('fs:openFolder'),
    readFile: (filePath: string): Promise<string | null> =>
      ipcRenderer.invoke('fs:readFile', filePath),
    writeFile: (filePath: string, content: string): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('fs:writeFile', filePath, content),
    readDir: (
      dirPath: string
    ): Promise<Array<{ name: string; isDirectory: boolean; path: string }>> =>
      ipcRenderer.invoke('fs:readDir', dirPath),
    exists: (filePath: string): Promise<boolean> => ipcRenderer.invoke('fs:exists', filePath),
    mkdir: (dirPath: string): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('fs:mkdir', dirPath),
    getHome: (): Promise<string> => ipcRenderer.invoke('fs:getHome'),
    applyChanges: (
      changes: Array<{ path: string; type: string; after?: string }>
    ): Promise<Array<{ path: string; success: boolean; error?: string }>> =>
      ipcRenderer.invoke('fs:applyChanges', changes),
    gitBackup: (projectPath: string): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('fs:gitBackup', projectPath),
    appendAuditLog: (projectPath: string, entry: string): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('fs:appendAuditLog', projectPath, entry),
    readAuditLog: (projectPath: string): Promise<unknown[]> =>
      ipcRenderer.invoke('fs:readAuditLog', projectPath)
  },
  ai: {
    listModels: (apiKey: string): Promise<{ success: boolean; data?: unknown; error?: string }> =>
      ipcRenderer.invoke('ai:listModels', apiKey)
  },
  preview: {
    open: (content: string, title?: string): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('preview:open', content, title ?? 'PLATPHORM Preview'),
    readForPreview: (filePath: string): Promise<{ success: boolean; content?: string; ext?: string; error?: string }> =>
      ipcRenderer.invoke('preview:readForPreview', filePath)
  }
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore
  window.electron = electronAPI
  // @ts-ignore
  window.api = api
}
