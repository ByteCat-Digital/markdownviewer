export type ResourceKind = 'file' | 'url';

export interface MarkdownResource {
  id: string;
  title: string;
  content: string;
  openedAt: number;
  kind: ResourceKind;
  path?: string;
  url?: string;
  finalUrl?: string;
  basePath?: string;
  baseUrl?: string;
}

export interface LinkFollowPayload {
  href: string;
  origin: ResourceKind;
  base?: string;
}

export interface ContextMenuPayload {
  selectionText?: string;
  link?: string;
  mermaidId?: string;
}

export type MermaidZoomDirection = 'in' | 'out';

export interface MermaidZoomMessage {
  id: string;
  direction: MermaidZoomDirection;
}
