import { z } from 'zod';

export const clueSendInput = z
  .object({
    id: z.string().uuid(),
    title: z.string().trim().min(1, '请填写线索标题').max(100),
    bodyMarkdown: z.string().max(30000).default(''),
    attachmentIds: z.array(z.string().min(1)).max(5).default([]),
    recipientUserIds: z.array(z.string().min(1)).min(1, '请选择接收人').max(20),
    gmNote: z.string().max(5000).default(''),
    associatedCharacterId: z.string().optional(),
    allowForward: z.boolean().default(false),
  })
  .superRefine((value, ctx) => {
    if (!value.bodyMarkdown.trim() && !value.attachmentIds.length)
      ctx.addIssue({ code: 'custom', message: '请填写正文或添加图片' });
    if (new Set(value.recipientUserIds).size !== value.recipientUserIds.length)
      ctx.addIssue({ code: 'custom', message: '接收人不能重复' });
    if (new Set(value.attachmentIds).size !== value.attachmentIds.length)
      ctx.addIssue({ code: 'custom', message: '附件不能重复' });
  });
export const clueForwardInput = z.object({
  id: z.string().uuid(),
  recipientUserIds: z.array(z.string().min(1)).min(1).max(20),
});

// Multipart filename headers may be decoded as Latin-1 even when browsers send UTF-8.
export function clueFilename(name: string) {
  const decoded = Buffer.from(name, 'latin1').toString('utf8');
  return !decoded.includes('\uFFFD') && Buffer.from(decoded, 'utf8').toString('latin1') === name ? decoded : name;
}
