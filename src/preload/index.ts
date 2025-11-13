import { contextBridge, ipcRenderer } from 'electron';
import type {
  ContextMenuPayload,
  LinkFollowPayload,
  MarkdownResource,
  MermaidZoomMessage
} from '@common/types';

const api = {
  openFileDialog: (): Promise<MarkdownResource[]> => ipcRenderer.invoke('dialog:open-file'),
  openUrl: (url: string): Promise<MarkdownResource> => ipcRenderer.invoke('resource:open-url', url),
  openReference: (payload: LinkFollowPayload): Promise<MarkdownResource> =>
    ipcRenderer.invoke('resource:open-reference', payload),
  openExternal: (url: string) => ipcRenderer.invoke('link:external', url),
  showContextMenu: (payload: ContextMenuPayload) => ipcRenderer.invoke('context-menu', payload),
  onResourceOpened: (callback: (resource: MarkdownResource) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, resource: MarkdownResource) => callback(resource);
    ipcRenderer.on('resource-opened', listener);
    return () => ipcRenderer.removeListener('resource-opened', listener);
  },
  onResourceError: (callback: (message: string) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, message: string) => callback(message);
    ipcRenderer.on('resource-error', listener);
    return () => ipcRenderer.removeListener('resource-error', listener);
  },
  onMermaidZoom: (callback: (message: MermaidZoomMessage) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: MermaidZoomMessage) => callback(payload);
    ipcRenderer.on('mermaid-zoom', listener);
    return () => ipcRenderer.removeListener('mermaid-zoom', listener);
  },
  signalReady: () => ipcRenderer.send('renderer-ready')
};

contextBridge.exposeInMainWorld('api', api);
