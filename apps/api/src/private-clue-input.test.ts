import { describe, it, expect } from 'vitest';
import { clueSendInput, clueFilename } from './private-clue-input.js';
const id = '798b47a4-158b-4cc9-b65c-d87a4566d2fd';
describe('私密线索内容与接收人', () => {
  it('恢复中文上传文件名，保留已正确解码的名称', () => {
    const name = '古书残页.png';
    expect(clueFilename(Buffer.from(name, 'utf8').toString('latin1'))).toBe(name);
    expect(clueFilename(name)).toBe(name);
    expect(clueFilename('café.png')).toBe('café.png');
  });
  it('允许文字或图片，默认禁止分享', () => {
    expect(
      clueSendInput.parse({ id, title: ' 文本 ', bodyMarkdown: '秘密', recipientUserIds: ['a'] }).allowForward,
    ).toBe(false);
    expect(
      clueSendInput.parse({ id, title: '图片', attachmentIds: ['image'], recipientUserIds: ['a', 'c'] }).title,
    ).toBe('图片');
  });
  it('拒绝空内容、空标题和重复接收人或附件', () => {
    for (const extra of [
      { bodyMarkdown: '  ' },
      { title: ' ' },
      { recipientUserIds: [] },
      { recipientUserIds: ['a', 'a'] },
      { attachmentIds: ['x', 'x'] },
      { attachmentIds: ['1', '2', '3', '4', '5', '6'] },
    ])
      expect(
        clueSendInput.safeParse({ id, title: '秘密', bodyMarkdown: '正文', recipientUserIds: ['a'], ...extra }).success,
      ).toBe(false);
  });
});
