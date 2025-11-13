import { useCallback, useEffect, useMemo, useState } from 'react';
import type { MouseEvent as ReactMouseEvent, ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Components } from 'react-markdown';
import type { MarkdownResource } from '@common/types';
import remarkMermaid from './lib/remarkMermaid';
import { MermaidBlock } from './components/MermaidBlock';
import './styles/app.css';

const markdownExtensions = ['.md', '.markdown', '.mdown', '.mkdn', '.mkd', '.mdx'];
const isMarkdownLink = (href: string) => {
  const sanitized = href.split('#')[0].split('?')[0];
  return markdownExtensions.some((ext) => sanitized.toLowerCase().endsWith(ext));
};

function normalizeUrl(input: string) {
  if (/^https?:\/\//i.test(input)) return input;
  return `https://${input}`;
}

export function App() {
  const [tabs, setTabs] = useState<MarkdownResource[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [urlMode, setUrlMode] = useState(false);
  const [urlValue, setUrlValue] = useState('');

  const activeTab = tabs.find((tab) => tab.id === activeId) ?? tabs[0] ?? null;

  const applyResource = useCallback((resource: MarkdownResource) => {
    let resolvedId = resource.id;
    setTabs((prev) => {
      const next = [...prev];
      const matchIndex = next.findIndex((entry) => {
        if (entry.kind !== resource.kind) return false;
        if (entry.kind === 'file') {
          return entry.path === resource.path;
        }
        const currentUrl = entry.finalUrl ?? entry.url;
        const incomingUrl = resource.finalUrl ?? resource.url;
        return currentUrl && incomingUrl ? currentUrl === incomingUrl : false;
      });

      if (matchIndex >= 0) {
        resolvedId = next[matchIndex].id;
        next[matchIndex] = { ...resource, id: resolvedId };
        return next;
      }

      next.push(resource);
      return next;
    });
    setActiveId(resolvedId);
    setStatus(null);
  }, []);

  const addResource = useCallback(
    (incoming: MarkdownResource | MarkdownResource[]) => {
      const list = Array.isArray(incoming) ? incoming : [incoming];
      list.forEach((item) => applyResource(item));
    },
    [applyResource]
  );

  const closeTab = useCallback((id: string) => {
    let fallback: string | null = null;
    setTabs((prev) => {
      const index = prev.findIndex((tab) => tab.id === id);
      if (index === -1) return prev;
      const next = prev.filter((tab) => tab.id !== id);
      const neighbour = next[index] ?? next[index - 1] ?? next[0] ?? null;
      fallback = neighbour?.id ?? null;
      return next;
    });
    setActiveId((current) => {
      if (current === id) {
        return fallback;
      }
      return current;
    });
  }, []);

  const handleOpenFile = useCallback(async () => {
    try {
      const resources = await window.api.openFileDialog();
      if (resources && resources.length > 0) {
        addResource(resources);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStatus(message);
    }
  }, [addResource]);

  const handleUrlSubmit = useCallback(async () => {
    if (!urlValue.trim()) return;
    try {
      const normalized = normalizeUrl(urlValue.trim());
      const resource = await window.api.openUrl(normalized);
      addResource(resource);
      setUrlMode(false);
      setUrlValue('');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStatus(message);
    }
  }, [addResource, urlValue]);

  const handleLinkActivation = useCallback(
    async (href: string): Promise<boolean> => {
      if (!activeTab) return false;
      const trimmed = href.trim();
      if (!trimmed || trimmed.startsWith('#')) {
        return false;
      }

      if (/^(https?:)?\/\//i.test(trimmed)) {
        const absolute = trimmed.startsWith('http') ? trimmed : `https:${trimmed}`;
        if (isMarkdownLink(absolute)) {
          try {
            const resource = await window.api.openUrl(absolute);
            addResource(resource);
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            setStatus(message);
          }
        } else {
          await window.api.openExternal(absolute);
        }
        return true;
      }

      if (/^[a-zA-Z]+:/i.test(trimmed)) {
        await window.api.openExternal(trimmed);
        return true;
      }

      if (!isMarkdownLink(trimmed)) {
        if (activeTab.kind === 'url') {
          const base = activeTab.baseUrl ?? activeTab.finalUrl ?? activeTab.url;
          if (base) {
            const destination = new URL(trimmed, base).toString();
            await window.api.openExternal(destination);
            return true;
          }
        }
        return false;
      }

      const base =
        activeTab.kind === 'file'
          ? activeTab.basePath
          : activeTab.baseUrl ?? activeTab.finalUrl ?? activeTab.url;

      if (!base) {
        setStatus('Unable to resolve markdown reference without a base path.');
        return true;
      }

      try {
        const resource = await window.api.openReference({ href: trimmed, origin: activeTab.kind, base });
        addResource(resource);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setStatus(message);
      }
      return true;
    },
    [activeTab, addResource]
  );

  useEffect(() => {
    const unsubscribe = window.api.onResourceOpened((resource) => addResource(resource));
    const unsubscribeError = window.api.onResourceError((message) => setStatus(message));
    window.api.signalReady();
    return () => {
      unsubscribe();
      unsubscribeError();
    };
  }, [addResource]);

  useEffect(() => {
    const handler = (event: MouseEvent) => {
      event.preventDefault();
      const target = event.target as HTMLElement | null;
      const selection = window.getSelection();
      const selectionText = selection && !selection.isCollapsed ? selection.toString() : '';
      let editableSelection = '';
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
        const start = target.selectionStart ?? 0;
        const end = target.selectionEnd ?? start;
        if (end > start) {
          editableSelection = target.value.slice(start, end);
        }
      }
      const anchor = target?.closest('a[href]');
      const link = anchor instanceof HTMLAnchorElement ? anchor.href : undefined;
      const mermaidEl = target?.closest<HTMLElement>('[data-mermaid-id]');
      const mermaidId = mermaidEl?.getAttribute('data-mermaid-id') ?? undefined;

      const textToCopy = editableSelection || selectionText;

      window.api.showContextMenu({
        selectionText: textToCopy,
        link,
        mermaidId
      });
    };
    window.addEventListener('contextmenu', handler);
    return () => window.removeEventListener('contextmenu', handler);
  }, []);

  const markdownComponents = useMemo<Components>(() => {
    type CodeRendererProps = {
      inline?: boolean;
      children?: ReactNode;
      className?: string;
      node?: {
        value?: string;
        lang?: string;
        data?: { isMermaid?: boolean };
      };
    };

    const codeRenderer = ((props: unknown) => {
      const { inline, children, className, node } = props as CodeRendererProps;
      const typedNode = node ?? {};

      const codeValue =
        typeof typedNode?.value === 'string'
          ? typedNode.value
          : typeof children === 'string'
            ? children
            : Array.isArray(children)
              ? children.join('')
              : '';

      const isMermaid =
        Boolean(typedNode?.data?.isMermaid) ||
        (!inline &&
          ((typedNode?.lang ?? '').toLowerCase() === 'mermaid' || className?.includes('language-mermaid')));

      if (!inline && isMermaid) {
        return <MermaidBlock code={codeValue} />;
      }

      if (inline) {
        return <code className={className}>{children}</code>;
      }
      return (
        <pre className={className}>
          <code>{children}</code>
        </pre>
      );
    }) as NonNullable<Components['code']>;

    return {
    a({ href, children, ...rest }) {
      const target = href ?? '';
      const intercept = target && !target.startsWith('#');
      const handleClick = (event: ReactMouseEvent<HTMLAnchorElement>) => {
          if (!target) return;
          if (intercept) {
            event.preventDefault();
            handleLinkActivation(target).catch((error) => {
              const message = error instanceof Error ? error.message : String(error);
              setStatus(message);
            });
          }
        };
        return (
          <a {...rest} href={href} onClick={handleClick}>
            {children}
          </a>
        );
      },
      code: codeRenderer
    };
  }, [handleLinkActivation]);

  const markdownPlugins = useMemo(() => [remarkGfm, remarkMermaid], []);

  const secondaryLabel = activeTab
    ? activeTab.kind === 'file'
      ? activeTab.path
      : activeTab.finalUrl ?? activeTab.url
    : null;

  return (
    <div className="app-shell">
      <header className="app-toolbar">
        <div className="toolbar-row">
          <div className="toolbar-actions">
            <button type="button" onClick={handleOpenFile}>Open File</button>
            <button type="button" onClick={() => setUrlMode((value) => !value)}>Open URL</button>
          </div>
          <div className="tab-strip" role="tablist">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                role="tab"
                aria-selected={tab.id === activeTab?.id}
                className={`tab-item ${tab.id === activeTab?.id ? 'active' : ''}`}
                onClick={() => setActiveId(tab.id)}
              >
                <span className="tab-title">{tab.title || (tab.kind === 'file' ? tab.path : tab.url)}</span>
                <span
                  role="button"
                  tabIndex={0}
                  aria-label={`Close ${tab.title}`}
                  className="tab-close"
                  onClick={(event) => {
                    event.stopPropagation();
                    closeTab(tab.id);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      closeTab(tab.id);
                    }
                  }}
                >
                  ×
                </span>
              </button>
            ))}
          </div>
        </div>
        {urlMode && (
          <div className="url-form">
            <input
              type="url"
              placeholder="https://example.com/readme.md"
              value={urlValue}
              onChange={(event) => setUrlValue(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  handleUrlSubmit();
                }
              }}
            />
            <button type="button" onClick={handleUrlSubmit}>Open</button>
            <button type="button" onClick={() => {
              setUrlMode(false);
              setUrlValue('');
            }}>Cancel</button>
          </div>
        )}
        {status && (
          <div className="status-banner">
            <span>{status}</span>
            <button type="button" onClick={() => setStatus(null)}>Dismiss</button>
          </div>
        )}
        {secondaryLabel && <div className="source-label">{secondaryLabel}</div>}
      </header>
      <main className="content-area">
        {activeTab ? (
          <article className="markdown-pane">
            <ReactMarkdown remarkPlugins={markdownPlugins} components={markdownComponents}>
              {activeTab.content}
            </ReactMarkdown>
          </article>
        ) : (
          <div className="empty-state">
            <p>Select “Open File” or “Open URL” to view a markdown document. Command line paths are opened automatically.</p>
          </div>
        )}
      </main>
    </div>
  );
}
