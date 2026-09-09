declare module "markdown-it-emoji" {
  import type { MarkdownIt } from "markdown-it";

  interface EmojiPluginOptions {
    /** Shortcode name (without colons) to the character it renders as. */
    defs?: Record<string, string>;
    /** ASCII emoticon aliases, keyed by the shortcode name they map to. */
    shortcuts?: Record<string, string | readonly string[]>;
    /** Whitelist of shortcode names; empty means all of `defs`. */
    enabled?: readonly string[];
  }

  type EmojiPlugin = (md: MarkdownIt, options?: EmojiPluginOptions) => void;

  export const bare: EmojiPlugin;
  export const light: EmojiPlugin;
  export const full: EmojiPlugin;
}

declare module "markdown-it-emoji/lib/data/full.mjs" {
  const definitions: Record<string, string>;
  export default definitions;
}
