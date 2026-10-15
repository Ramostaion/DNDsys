import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import TagMarkdown from './TagMarkdown';
describe('受控备注预览', () => {
  it('保留长普通文本、换行和 Markdown 常用元素', () => {
    const long = '中文长备注'.repeat(1000);
    const html = renderToStaticMarkup(<TagMarkdown text={`# 标题\n**粗体** *斜体*\n- 清单\n> 引用\n${long}`} />);
    expect(html).toContain('role="heading"');
    expect(html).toContain('<strong>粗体</strong>');
    expect(html).toContain('<em>斜体</em>');
    expect(html).toContain('<li>清单</li>');
    expect(html).toContain('<blockquote>引用</blockquote>');
    expect(html).toContain(long);
  });
  it('HTML 作为文字，危险链接不生成可点击 href', () => {
    const html = renderToStaticMarkup(
      <TagMarkdown text={'<script>alert(1)</script>\n[危险](javascript:alert(1))\n[有效](https://example.com)'} />,
    );
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('href="javascript:');
    expect(html).toContain('href="https://example.com/"');
  });
});
