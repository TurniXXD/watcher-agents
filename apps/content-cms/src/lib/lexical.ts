/**
 * Minimal conversions between plain text and Payload's Lexical JSON. Bots send
 * plain text; the public API returns plain text so descriptions are always
 * safe to render without HTML sanitisation on the consumer side.
 */
export type LexicalState = {
  root: {
    type: 'root';
    children: unknown[];
    direction: 'ltr' | 'rtl' | null;
    format: '';
    indent: number;
    version: number;
  };
};

const textNode = (text: string) => ({
  type: 'text',
  detail: 0,
  format: 0,
  mode: 'normal',
  style: '',
  text,
  version: 1,
});

export const textToLexical = (text: string): LexicalState => ({
  root: {
    type: 'root',
    direction: 'ltr',
    format: '',
    indent: 0,
    version: 1,
    children: text
      .replace(/\r\n?/gu, '\n')
      .split(/\n{2,}/u)
      .map((paragraph) => paragraph.trim())
      .filter(Boolean)
      .map((paragraph) => ({
        type: 'paragraph',
        direction: 'ltr',
        format: '',
        indent: 0,
        textFormat: 0,
        textStyle: '',
        version: 1,
        children: paragraph
          .split('\n')
          .flatMap((line, index) =>
            index === 0
              ? [textNode(line)]
              : [{ type: 'linebreak', version: 1 }, textNode(line)],
          ),
      })),
  },
});

type LexicalNode = {
  type?: unknown;
  text?: unknown;
  children?: unknown;
};

const BLOCK_TYPES = new Set([
  'paragraph',
  'heading',
  'quote',
  'listitem',
  'list',
  'code',
]);

const collect = (node: LexicalNode): string => {
  if (node.type === 'text' && typeof node.text === 'string') return node.text;
  if (node.type === 'linebreak') return '\n';
  if (!Array.isArray(node.children)) return '';
  const children = node.children as LexicalNode[];
  const blockChildren = children.some(
    (child) => typeof child.type === 'string' && BLOCK_TYPES.has(child.type),
  );
  return children
    .map(collect)
    .filter((part) => !blockChildren || part.trim().length > 0)
    .join(blockChildren ? '\n\n' : '');
};

export const lexicalToText = (value: unknown): string | null => {
  if (!value || typeof value !== 'object') return null;
  const root = (value as { root?: LexicalNode }).root;
  if (!root) return null;
  const text = collect(root)
    // Strip control characters other than tab/newline.
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, '')
    .replace(/\n{3,}/gu, '\n\n')
    .trim();
  return text.length > 0 ? text : null;
};
