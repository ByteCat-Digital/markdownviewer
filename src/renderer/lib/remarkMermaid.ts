import type { Plugin } from 'unified';
import { visit } from 'unist-util-visit';

type CodeNode = {
  type: 'code';
  lang?: string;
  value?: string;
  data?: Record<string, unknown>;
};

const remarkMermaid: Plugin = () => (tree) => {
  visit(tree, 'code', (node: CodeNode) => {
    if ((node.lang || '').toLowerCase() !== 'mermaid') return;
    node.data = {
      ...node.data,
      isMermaid: true
    };
  });
};

export default remarkMermaid;
