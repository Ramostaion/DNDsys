import type { ReactNode } from 'react';
import { safeTagLink } from '@dnd/shared';
function inline(text: string): ReactNode[] {
  const pattern = /(\*\*[^*]+\*\*|\*[^*\n]+\*|\[[^\]\n]+\]\([^\s)]+\))/g;
  const output: ReactNode[] = [];
  let offset = 0;
  for (const match of text.matchAll(pattern)) {
    if (match.index! > offset) output.push(text.slice(offset, match.index));
    const token = match[0],
      key = String(match.index);
    if (token.startsWith('**')) output.push(<strong key={key}>{token.slice(2, -2)}</strong>);
    else if (token.startsWith('*')) output.push(<em key={key}>{token.slice(1, -1)}</em>);
    else {
      const parts = /^\[([^\]]+)\]\((.+)\)$/.exec(token)!;
      const href = safeTagLink(parts[2]);
      output.push(
        href ? (
          <a key={key} href={href} target="_blank" rel="noreferrer noopener">
            {parts[1]}
          </a>
        ) : (
          token
        ),
      );
    }
    offset = match.index! + token.length;
  }
  output.push(text.slice(offset));
  return output;
}
// React escapes all text; raw HTML is displayed as text, never injected into the page.
export default function TagMarkdown({ text }: { text: string }) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const blocks: ReactNode[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i],
      heading = /^(#{1,6})\s+(.+)$/.exec(line);
    if (heading) {
      blocks.push(
        <div
          key={i}
          role="heading"
          aria-level={heading[1].length}
          className={`tag-heading tag-heading-${heading[1].length}`}
        >
          {inline(heading[2])}
        </div>,
      );
      continue;
    }
    if (/^\s*([-*]|\d+\.)\s+/.test(line)) {
      const ordered = /^\s*\d+\./.test(line),
        items: ReactNode[] = [];
      const start = i;
      while (i < lines.length && (ordered ? /^\s*\d+\.\s+/ : /^\s*[-*]\s+/).test(lines[i])) {
        items.push(<li key={i}>{inline(lines[i].replace(/^\s*([-*]|\d+\.)\s+/, ''))}</li>);
        i++;
      }
      i--;
      blocks.push(ordered ? <ol key={start}>{items}</ol> : <ul key={start}>{items}</ul>);
      continue;
    }
    if (/^>\s?/.test(line)) blocks.push(<blockquote key={i}>{inline(line.replace(/^>\s?/, ''))}</blockquote>);
    else blocks.push(line ? <p key={i}>{inline(line)}</p> : <div key={i} className="tag-paragraph-gap" />);
  }
  return <div className="tag-markdown">{text ? blocks : <p className="subtle">尚未填写详情。</p>}</div>;
}
