import type {
  ContextMenuPayload,
  LinkFollowPayload,
  MarkdownResource,
  MermaidZoomMessage,
  PrintPayload
} from '@common/types';

declare global {
  interface Window {
    api: {
      openFileDialog(): Promise<MarkdownResource[]>;
      openUrl(url: string): Promise<MarkdownResource>;
      openReference(payload: LinkFollowPayload): Promise<MarkdownResource>;
      openExternal(url: string): Promise<void>;
      showContextMenu(payload: ContextMenuPayload): Promise<void>;
      getAppVersion(): Promise<string>;
      printDocument(payload: PrintPayload): Promise<void>;
      onResourceOpened(callback: (resource: MarkdownResource) => void): () => void;
      onResourceError(callback: (message: string) => void): () => void;
      onMermaidZoom(callback: (payload: MermaidZoomMessage) => void): () => void;
      onPrintRequest(callback: () => void): () => void;
      signalReady(): void;
    };
  }
}

export {};
