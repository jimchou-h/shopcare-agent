import { z } from 'zod';

/** 回答所依据的 FAQ 出处，字段来自同一条语料。换货摘要也复用它引用政策。 */
export const faqSourceSchema = z.object({
  /** 稳定条目 ID，后续换货 Flow 也用它引用政策。 */
  id: z.string(),
  title: z.string(),
  /** 直接支持结论的政策原文摘录。 */
  excerpt: z.string(),
  /** 语料版本，便于演示环境核对回答依据。 */
  version: z.string()
});

export type FaqSource = z.infer<typeof faqSourceSchema>;
