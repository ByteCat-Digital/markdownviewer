import type {
  ContextMenuPayload,
  LinkFollowPayload,
  MarkdownResource,
  MermaidZoomMessage
} from '@common/types';

declare global {
  interface Window {
    api: {
      openFileDialog(): Promise<MarkdownResource[]>;
      openUrl(url: string): Promise<MarkdownResource>;
      openReference(payload: LinkFollowPayload): Promise<MarkdownResource>;
      openExternal(url: string): Promise<void>;
      showContextMenu(payload: ContextMenuPayload): Promise<void>;
      onResourceOpened(callback: (resource: MarkdownResource) => void): () => void;
      onResourceError(callback: (message: string) => void): () => void;
      onMermaidZoom(callback: (payload: MermaidZoomMessage) => void): () => void;
      signalReady(): void;
    };
  }
}

export {};
