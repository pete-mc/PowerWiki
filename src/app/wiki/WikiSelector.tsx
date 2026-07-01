import type { WikiSummary } from "../../wiki/WikiPage";

interface WikiSelectorProps {
  readonly activeWikiId?: string;
  readonly disabled?: boolean;
  readonly onWikiSelected: (wikiId: string) => void;
  readonly wikis: readonly WikiSummary[];
}

export function WikiSelector({
  activeWikiId,
  disabled,
  onWikiSelected,
  wikis
}: WikiSelectorProps) {
  return (
    <label className="wiki-selector">
      <span>Wiki</span>
      <select
        disabled={disabled || wikis.length === 0}
        onChange={(event) => onWikiSelected(event.target.value)}
        value={activeWikiId ?? ""}
      >
        {wikis.map((wiki) => (
          <option key={wiki.id} value={wiki.id}>
            {wiki.name}
          </option>
        ))}
      </select>
    </label>
  );
}

