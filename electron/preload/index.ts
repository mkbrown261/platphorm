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
    getHome: (): Promise<string> => ipcRenderer.invoke('fs:getHome')
  },
  // Persistent settings — API keys survive app restarts.
  // Stored in OS user-data dir via electron-store, never in source control.
  store: {
    get:    (key: string): Promise<unknown>                      => ipcRenderer.invoke('store:get', key),
    set:    (key: string, value: unknown): Promise<{ success: boolean }> => ipcRenderer.invoke('store:set', key, value),
    delete: (key: string): Promise<{ success: boolean }>         => ipcRenderer.invoke('store:delete', key),
    getAll: (): Promise<Record<string, unknown>>                  => ipcRenderer.invoke('store:getAll')
  },
  // Live preview — spawns the project's dev server as a child process and
  // returns the localhost URL so a WebView can point at it.
  preview: {
    start:  (projectPath: string): Promise<{ success: boolean; port?: number; url?: string; error?: string }> =>
      ipcRenderer.invoke('preview:start', projectPath),
    stop:   (projectPath: string): Promise<{ success: boolean }> =>
      ipcRenderer.invoke('preview:stop', projectPath),
    status: (projectPath: string): Promise<{ running: boolean; port?: number; url?: string }> =>
      ipcRenderer.invoke('preview:status', projectPath)
  },
  // Shell utilities — electronAPI from @electron-toolkit/preload doesn't expose shell,
  // so we route safe operations through IPC instead.
  shell: {
    openExternal: (url: string): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('shell:openExternal', url)
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
