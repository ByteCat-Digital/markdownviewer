import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  shell,
  Menu,
  clipboard,
  type MenuItemConstructorOptions
} from 'electron';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import type {
  ContextMenuPayload,
  LinkFollowPayload,
  MarkdownResource,
  MermaidZoomDirection
} from '@common/types';

const isDev = !app.isPackaged;
const markdownExtensions = ['.md', '.markdown', '.mdown', '.mkdn', '.mkd', '.mdx'];
const __dirname = path.dirname(fileURLToPath(import.meta.url));

type ResourceDescriptor = MarkdownResource;

let mainWindow: BrowserWindow | null = null;
let rendererReady = false;
const pendingResources: ResourceDescriptor[] = [];

if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

const isMarkdownPath = (target: string) => {
  const normalized = target.split('?')[0].split('#')[0];
  return markdownExtensions.some((ext) => normalized.toLowerCase().endsWith(ext));
};

const preloadFile = path.join(__dirname, '../preload/index.cjs');
const rendererHtml = path.join(__dirname, '../renderer/index.html');

const resolveHtml = () => {
  if (isDev && process.env.VITE_DEV_SERVER_URL) {
    return mainWindow?.loadURL(process.env.VITE_DEV_SERVER_URL);
  }
  return mainWindow?.loadFile(rendererHtml);
};

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    show: false,
    title: 'Markdown Viewer',
    webPreferences: {
      preload: preloadFile,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false
    }
  });

  mainWindow.once('ready-to-show', () => mainWindow?.show());

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url !== mainWindow?.webContents.getURL()) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  await resolveHtml();
}

async function readMarkdownFile(targetPath: string): Promise<ResourceDescriptor> {
  const absolute = path.resolve(targetPath);
  const content = await readFile(absolute, 'utf-8');
  return {
    id: randomUUID(),
    kind: 'file',
    path: absolute,
    title: path.basename(absolute),
    content,
    openedAt: Date.now(),
    basePath: path.dirname(absolute)
  };
}

async function fetchMarkdownUrl(targetUrl: string): Promise<ResourceDescriptor> {
  const response = await fetch(targetUrl);
  if (!response.ok) {
    throw new Error(`Failed to load ${targetUrl}: ${response.status} ${response.statusText}`);
  }
  const text = await response.text();
  const finalUrl = response.url || targetUrl;
  const parsed = new URL(finalUrl);
  const title = parsed.pathname.split('/').filter(Boolean).pop() || parsed.host;
  return {
    id: randomUUID(),
    kind: 'url',
    url: targetUrl,
    finalUrl,
    title,
    content: text,
    openedAt: Date.now(),
    baseUrl: finalUrl
  };
}

async function handleOpenDialog(): Promise<ResourceDescriptor[]> {
  if (!mainWindow) return [];
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    title: 'Open Markdown',
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Markdown', extensions: markdownExtensions.map((ext) => ext.replace('.', '')) }]
  });
  if (canceled || filePaths.length === 0) return [];
  return Promise.all(filePaths.map((file) => readMarkdownFile(file)));
}

function publishResource(resource: ResourceDescriptor) {
  if (rendererReady && mainWindow) {
    mainWindow.webContents.send('resource-opened', resource);
  } else {
    pendingResources.push(resource);
  }
}

async function deliverResource(loader: Promise<ResourceDescriptor>) {
  try {
    const resource = await loader;
    publishResource(resource);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    mainWindow?.webContents.send('resource-error', message);
  }
}

function flushPending() {
  if (!rendererReady || !mainWindow) return;
  while (pendingResources.length) {
    const resource = pendingResources.shift();
    if (resource) {
      mainWindow.webContents.send('resource-opened', resource);
    }
  }
}

function parseArgTargets(argv: string[]) {
  const sliceFrom = app.isPackaged ? 1 : 2;
  const candidates = argv.slice(sliceFrom).filter((arg) => !arg.startsWith('--'));
  candidates.forEach((arg) => {
    if (/^https?:\/\//i.test(arg)) {
      deliverResource(fetchMarkdownUrl(arg));
    } else if (isMarkdownPath(arg)) {
      deliverResource(readMarkdownFile(arg));
    }
  });
}

function setupIpc() {
  ipcMain.on('renderer-ready', () => {
    rendererReady = true;
    flushPending();
  });

  ipcMain.handle('dialog:open-file', async () => handleOpenDialog());

  ipcMain.handle('resource:open-url', async (_event, url: string) => {
    if (!/^https?:\/\//i.test(url)) {
      throw new Error('Only http(s) urls are supported');
    }
    return fetchMarkdownUrl(url);
  });

  ipcMain.handle('resource:open-reference', async (_event, payload: LinkFollowPayload) => {
    const { href, origin, base } = payload;
    if (origin === 'file') {
      if (!base) throw new Error('Missing base path');
      return readMarkdownFile(path.resolve(base, href));
    }
    if (!base) throw new Error('Missing base url');
    const resolved = new URL(href, base).toString();
    return fetchMarkdownUrl(resolved);
  });

  ipcMain.handle('link:external', async (_event, url: string) => {
    await shell.openExternal(url);
  });

  ipcMain.handle('context-menu', (event, payload: ContextMenuPayload) => {
    const targetWindow = BrowserWindow.fromWebContents(event.sender) ?? mainWindow;
    if (!targetWindow) return;
    const template: MenuItemConstructorOptions[] = [];

    if (payload.selectionText) {
      template.push({
        label: 'Copy',
        accelerator: 'CmdOrCtrl+C',
        click: () => clipboard.writeText(payload.selectionText ?? '')
      });
    }

    if (payload.link) {
      template.push({
        label: template.length ? 'Copy Link' : 'Copy Link',
        click: () => clipboard.writeText(payload.link ?? '')
      });
    }

    if (payload.mermaidId) {
      template.push({
        type: 'separator'
      });
      const zoom = (direction: MermaidZoomDirection) => () => sendMermaidZoom(payload.mermaidId!, direction);
      template.push(
        {
          label: 'Zoom In',
          click: zoom('in')
        },
        {
          label: 'Zoom Out',
          click: zoom('out')
        }
      );
    }

    if (template.length === 0) {
      template.push({
        label: 'No actions',
        enabled: false
      });
    }

    const menu = Menu.buildFromTemplate(template);
    menu.popup({
      window: targetWindow
    });
  });
}

function sendMermaidZoom(id: string, direction: MermaidZoomDirection) {
  if (!mainWindow) return;
  mainWindow.webContents.send('mermaid-zoom', { id, direction });
}

async function openFilesFromMenu() {
  try {
    const resources = await handleOpenDialog();
    resources.forEach((resource) => publishResource(resource));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    mainWindow?.webContents.send('resource-error', message);
  }
}

function setupMenu() {
  const isMac = process.platform === 'darwin';

  const template: MenuItemConstructorOptions[] = [
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: 'about' as const },
              { type: 'separator' as const },
              { role: 'services' as const },
              { type: 'separator' as const },
              { role: 'hide' as const },
              { role: 'hideOthers' as const },
              { role: 'unhide' as const },
              { type: 'separator' as const },
              { role: 'quit' as const }
            ]
          }
        ]
      : []),
    {
      label: 'File',
      submenu: [
        {
          label: 'Open…',
          accelerator: 'CmdOrCtrl+O',
          click: () => {
            openFilesFromMenu().catch((error) => {
              const message = error instanceof Error ? error.message : String(error);
              mainWindow?.webContents.send('resource-error', message);
            });
          }
        },
        { type: 'separator' as const },
        isMac ? { role: 'close' as const } : { role: 'quit' as const }
      ]
    },
    {
      label: 'Window',
      submenu: isMac
        ? [{ role: 'minimize' as const }, { role: 'zoom' as const }, { type: 'separator' as const }, { role: 'front' as const }]
        : [{ role: 'minimize' as const }, { role: 'close' as const }]
    }
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

function registerAppEvents() {
  app.on('open-file', (event, filePath) => {
    event.preventDefault();
    deliverResource(readMarkdownFile(filePath));
  });

  app.on('second-instance', (_event, argv) => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
    parseArgTargets(argv);
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow().catch((error) => console.error(error));
    }
  });
}

app.whenReady().then(async () => {
  setupIpc();
  setupMenu();
  registerAppEvents();
  await createWindow();
  parseArgTargets(process.argv);
});
