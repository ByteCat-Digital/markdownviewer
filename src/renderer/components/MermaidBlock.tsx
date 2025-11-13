import { useEffect, useMemo, useRef, useState } from 'react';
import mermaid from 'mermaid';

mermaid.initialize({ startOnLoad: false, securityLevel: 'loose', theme: 'default' });

let mermaidCounter = 0;
const nextId = () => `mermaid-${mermaidCounter++}`;

interface Props {
  code?: string;
}

const escapeHtml = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function MermaidBlock({ code = '' }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const renderId = useMemo(() => nextId(), []);
  const [scale, setScale] = useState(1);

  useEffect(() => {
    setScale(1);
  }, [code]);

  useEffect(() => {
    let cancelled = false;

    const render = async () => {
      if (!code.trim()) {
        if (containerRef.current) containerRef.current.textContent = '';
        return;
      }
      try {
        const { svg } = await mermaid.render(renderId, code);
        if (!cancelled && containerRef.current) {
          containerRef.current.innerHTML = svg;
        }
      } catch (error) {
        if (!cancelled && containerRef.current) {
          const message = error instanceof Error ? error.message : String(error);
          containerRef.current.innerHTML = `<pre class="mermaid-error">${escapeHtml(message)}</pre>`;
        }
      }
    };

    render();

    return () => {
      cancelled = true;
    };
  }, [code, renderId]);

  useEffect(() => {
    if (!window.api?.onMermaidZoom) return undefined;
    const unsubscribe = window.api.onMermaidZoom(({ id, direction }) => {
      if (id !== renderId) return;
      setScale((current) => {
        const factor = direction === 'in' ? 1.2 : 1 / 1.2;
        const next = current * factor;
        return Math.min(Math.max(next, 0.5), 4);
      });
    });
    return unsubscribe;
  }, [renderId]);

  const style =
    scale !== 1
      ? {
          transform: `scale(${scale})`,
          transformOrigin: '0 0'
        }
      : undefined;

  return (
    <div className="mermaid-container" data-mermaid-id={renderId}>
      <div className="mermaid-block" ref={containerRef} role="img" aria-label="Mermaid diagram" style={style} />
    </div>
  );
}
