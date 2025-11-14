import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  shell,
  Menu,
  clipboard,
  nativeImage,
  type MenuItemConstructorOptions
} from 'electron';
import { readFile } from 'node:fs/promises';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import type {
  ContextMenuPayload,
  LinkFollowPayload,
  MarkdownResource,
  MermaidZoomDirection,
  PrintPayload
} from '@common/types';

const isDev = !app.isPackaged;
const markdownExtensions = ['.md', '.markdown', '.mdown', '.mkdn', '.mkd', '.mdx'];
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const websiteUrl = 'https://www.bytecat.co.za';
const githubUrl = 'https://github.com/ByteCat-Digital';
const printStyles = `
  :root { color-scheme: light; }
  body {
    font-family: "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
    margin: 40px;
    color: #0f172a;
    background: #ffffff;
  }
  h1 {
    margin-top: 0;
    font-size: 1.6rem;
  }
  article {
    line-height: 1.6;
  }
  pre {
    background: #f3f4f6;
    padding: 0.85rem;
    border-radius: 8px;
    overflow: auto;
  }
  code {
    font-family: "JetBrains Mono", Menlo, monospace;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    margin: 1rem 0;
  }
  th, td {
    border: 1px solid #cbd5f5;
    padding: 0.5rem;
  }
  .mermaid-block,
  .mermaid-container {
    overflow: visible;
  }
`;
const windowsIconFile = 'cat_windows_icon.ico';
const defaultPngIconFile = 'cat_dark_green_512x512.png';

const resolveAssetPath = (...segments: string[]) => {
  const baseDir = app.isPackaged ? process.resourcesPath : process.cwd();
  return path.join(baseDir, ...segments);
};

const resolveIconPath = (filename: string) => {
  const candidate = resolveAssetPath('assets', 'icons', filename);
  return existsSync(candidate) ? candidate : null;
};

const getWindowIconPath = () =>
  resolveIconPath(process.platform === 'win32' ? windowsIconFile : defaultPngIconFile);

const getAboutIcon = () => {
  const iconPath = resolveIconPath(defaultPngIconFile);
  if (!iconPath) return undefined;
  const image = nativeImage.createFromPath(iconPath);
  return image.isEmpty() ? undefined : image;
};

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

const escapeHtml = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

type DependencyNotice = {
  name: string;
  version: string;
  license: string;
};

function readJsonSafe(target: string) {
  try {
    if (!existsSync(target)) return null;
    return JSON.parse(readFileSync(target, 'utf-8'));
  } catch {
    return null;
  }
}

function loadDependencyNotices(): DependencyNotice[] {
  try {
    const pkgPath = path.join(app.getAppPath(), 'package.json');
    const pkgJson = readJsonSafe(pkgPath);
    const dependencies = pkgJson?.dependencies ?? {};
    const names = Object.keys(dependencies);
    const notices: DependencyNotice[] = [];
    for (const name of names) {
      const candidatePaths = [
        path.join(app.getAppPath(), 'node_modules', name, 'package.json'),
        path.join(process.cwd(), 'node_modules', name, 'package.json')
      ];
      let depJson: any = null;
      for (const candidate of candidatePaths) {
        depJson = readJsonSafe(candidate);
        if (depJson) break;
      }
      notices.push({
        name,
        version: depJson?.version ?? dependencies[name] ?? 'unknown',
        license: depJson?.license ?? 'unknown'
      });
    }
    return notices;
  } catch {
    return [];
  }
}

function dependencyAcknowledgements() {
  const dependencyNotices = loadDependencyNotices();
  return dependencyNotices.length > 0
    ? dependencyNotices.map((dep) => `• ${dep.name}@${dep.version} (${dep.license})`).join('\n')
    : 'No external dependencies listed.';
}

const resolveHtml = () => {
  if (isDev && process.env.VITE_DEV_SERVER_URL) {
    return mainWindow?.loadURL(process.env.VITE_DEV_SERVER_URL);
  }
  return mainWindow?.loadFile(rendererHtml);
};

async function createWindow() {
  const iconPath = getWindowIconPath();
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    show: false,
    title: 'Markdown Viewer',
    icon: iconPath ?? undefined,
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

  ipcMain.handle('app:get-version', () => app.getVersion());

  ipcMain.handle('print-document', async (_event, payload: PrintPayload) => {
    await printDocument(payload);
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

function requestPrintFromRenderer() {
  mainWindow?.webContents.send('request-print');
}

const buildPrintHtml = (payload: PrintPayload) => `<!doctype html>
<html>
  <head>
    <meta charset="UTF-8" />
    <title>${escapeHtml(payload.title)}</title>
    <style>${printStyles}</style>
  </head>
  <body>
    <h1>${escapeHtml(payload.title)}</h1>
    <article>
      ${payload.html}
    </article>
  </body>
</html>`;

async function printDocument(payload: PrintPayload) {
  const printWindow = new BrowserWindow({
    show: false,
    width: 1024,
    height: 768,
    webPreferences: {
      sandbox: true
    }
  });

  try {
    const htmlContent = buildPrintHtml(payload);
    await printWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(htmlContent)}`);
    await new Promise<void>((resolve, reject) => {
      printWindow.webContents.print(
        {
          printBackground: true
        },
        (success, errorType) => {
          if (!success) {
            reject(new Error(errorType || 'Printing was cancelled or failed'));
          } else {
            resolve();
          }
        }
      );
    });
  } finally {
    if (!printWindow.isDestroyed()) {
      printWindow.close();
    }
  }
}

async function openAboutDialog() {
  const version = app.getVersion();
  const aboutIcon = getAboutIcon();
  const detailLines = [
    `Version ${version}`,
    websiteUrl,
    githubUrl,
    '',
    'Developed with assistance from OpenAI Codex.',
    'Code review and fixes by Claude Code.',
    '',
    'Acknowledgements:',
    dependencyAcknowledgements(),
    '',
    'License: Apache License 2.0'
  ].join('\n');

  const options: Electron.MessageBoxOptions = {
    type: 'info',
    buttons: ['OK', 'Visit Website', 'GitHub'],
    defaultId: 0,
    cancelId: 0,
    title: 'About',
    message: 'ByteCat Digital (Pty) Ltd Markdown Reader',
    detail: detailLines,
    icon: aboutIcon
  } as const;
  const result = mainWindow
    ? await dialog.showMessageBox(mainWindow, options)
    : await dialog.showMessageBox(options);
  const { response } = result;
  if (response === 1) {
    await shell.openExternal(websiteUrl);
  } else if (response === 2) {
    await shell.openExternal(githubUrl);
  }
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
              {
                label: 'About Markdown Viewer',
                click: () => openAboutDialog().catch(console.error)
              },
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
        {
          label: 'Print…',
          accelerator: 'CmdOrCtrl+P',
          click: () => {
            requestPrintFromRenderer();
          }
        },
        { type: 'separator' as const },
        isMac ? { role: 'close' as const } : { role: 'quit' as const }
      ]
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' as const },
        { role: 'forceReload' as const },
        { type: 'separator' as const },
        {
          label: 'Toggle Developer Tools',
          accelerator: isMac ? 'Alt+Command+I' : 'Ctrl+Shift+I',
          click: () => {
            if (!mainWindow || mainWindow.isDestroyed()) return;
            if (mainWindow.webContents.isDevToolsOpened()) {
              mainWindow.webContents.closeDevTools();
            } else {
              mainWindow.webContents.openDevTools({ mode: 'detach' });
            }
          }
        }
      ] as MenuItemConstructorOptions[]
    },
    {
      label: 'Window',
      submenu: isMac
        ? [{ role: 'minimize' as const }, { role: 'zoom' as const }, { type: 'separator' as const }, { role: 'front' as const }]
        : [{ role: 'minimize' as const }, { role: 'close' as const }]
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'About Markdown Viewer',
          click: () => openAboutDialog().catch(console.error)
        },
        {
          label: 'Visit Website',
          click: () => shell.openExternal(websiteUrl)
        },
        {
          label: 'GitHub',
          click: () => shell.openExternal(githubUrl)
        }
      ]
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
