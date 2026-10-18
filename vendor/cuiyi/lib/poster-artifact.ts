/** Extract complete HTML artifacts, never partial snippets or unfinished streams. */
export function posterArtifact(content: string): { html: string; markdown: string } | null {
  if (typeof content !== "string" || content.length > 2 * 1024 * 1024) return null;
  const blocks = [...content.matchAll(/```html[ \t]*\r?\n([\s\S]*?)\r?\n```/gi)]
    .filter((match) => /<html\b/i.test(match[1]) && /<body\b/i.test(match[1]) && /<\/html\s*>/i.test(match[1]));
  const latest = blocks.at(-1);
  if (!latest) return null;
  let markdown = content;
  for (const block of blocks) markdown = markdown.replace(block[0], "");
  return { html: latest[1].trim(), markdown: markdown.trim() };
}
