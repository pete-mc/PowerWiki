// Emoji shortcodes (`:green_circle:`, `:tada:`) for the Markdown pipeline.
//
// markdown-it-emoji's "full" dataset is GitHub's set: every one of its 1903
// names appears in https://api.github.com/emojis, and the only Unicode names
// GitHub has that it lacks are ten `u5272`-style aliases for the Japanese
// squared symbols. `supplementalEmoji` closes that gap and adds the emoji
// standardised after either list was generated (Unicode 15.1 and 16.0), so
// every standardised emoji has a shortcode here. GitHub's two dozen *custom*
// shortcodes (`:octocat:`, `:shipit:`) are images on GitHub's own CDN rather
// than characters, and are deliberately not reproduced.
//
// The plugin also ships ASCII emoticon shortcuts (`:)`, `:/`, `8-)`), and they
// are switched off: a wiki full of paths, ranges and version strings would get
// punctuation silently rewritten into faces that nobody typed. Only an explicit
// `:name:` is an emoji.

import { full as markdownItEmoji } from "markdown-it-emoji";
// The package's exports map publishes its data files, and the plugin replaces
// the whole `defs` map when given one - so the built-in definitions have to be
// imported to be extended rather than overwritten.
import fullEmojiDefinitions from "markdown-it-emoji/lib/data/full.mjs";
import type { MarkdownIt } from "markdown-it";

/**
 * Carries the authored shortcode on an emoji rendered for the rich text
 * editor, so saving from WYSIWYG writes `:tada:` back rather than the
 * character.
 */
export const EMOJI_ATTR = "data-powerwiki-emoji";

// Escape sequences rather than literal characters, so the invisible parts of a
// sequence - zero-width joiners, variation selectors - stay reviewable.
const supplementalEmoji: Record<string, string> = {
  // GitHub aliases for the Japanese squared symbols.
  u5272: "\u{1F239}",
  u5408: "\u{1F234}",
  u55b6: "\u{1F23A}",
  u6307: "\u{1F22F}",
  u6708: "\u{1F237}",
  u6709: "\u{1F236}",
  u7121: "\u{1F21A}",
  u7533: "\u{1F238}",
  u7981: "\u{1F232}",
  u7a7a: "\u{1F233}",

  // Unicode 15.1 (2023).
  broken_chain: "\u{26D3}\u{FE0F}\u{200D}\u{1F4A5}",
  brown_mushroom: "\u{1F344}\u{200D}\u{1F7EB}",
  head_shaking_horizontally: "\u{1F642}\u{200D}\u{2194}\u{FE0F}",
  head_shaking_vertically: "\u{1F642}\u{200D}\u{2195}\u{FE0F}",
  lime: "\u{1F34B}\u{200D}\u{1F7E9}",
  phoenix: "\u{1F426}\u{200D}\u{1F525}",

  // Unicode 16.0 (2024).
  face_with_bags_under_eyes: "\u{1FAE9}",
  fingerprint: "\u{1FAC6}",
  harp: "\u{1FA89}",
  leafless_tree: "\u{1FABE}",
  root_vegetable: "\u{1FADC}",
  shovel: "\u{1FA8F}",
  splatter: "\u{1FADF}"
};

/** Every shortcode PowerWiki understands, keyed by name without the colons. */
export const emojiDefinitions: Record<string, string> = {
  ...fullEmojiDefinitions,
  ...supplementalEmoji
};

/** The character a `:name:` shortcode renders as, or undefined if unknown. */
export function emojiForShortcode(shortcode: string): string | undefined {
  const name = /^:([^\s:]+):$/.exec(shortcode)?.[1];
  return name ? emojiDefinitions[name] : undefined;
}

/** Renders `:name:` as the emoji character. */
export function emojiPlugin(md: MarkdownIt): void {
  md.use(markdownItEmoji, { defs: emojiDefinitions, shortcuts: {} });
}

/**
 * The same, but wrapped so the rich text editor can turn the character back
 * into the shortcode the author wrote (see the `wikiEmoji` Turndown rule).
 */
export function editableEmojiPlugin(md: MarkdownIt): void {
  emojiPlugin(md);
  md.renderer.rules.emoji = (tokens, index) => {
    const token = tokens[index];
    return `<span ${EMOJI_ATTR}=":${token.markup}:">${token.content}</span>`;
  };
}
