import MarkdownIt from "markdown-it";
import markdownItAnchor from "markdown-it-anchor";

export function createMarkdownRenderer(): MarkdownIt {
  return new MarkdownIt({
    breaks: false,
    html: false,
    linkify: true,
    typographer: true
  }).use(markdownItAnchor, {
    permalink: markdownItAnchor.permalink.headerLink()
  });
}

