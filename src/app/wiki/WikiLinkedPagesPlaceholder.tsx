/**
 * What the work item form's Power Wiki tab shows when the item has no wiki page
 * linked to it.
 *
 * It used to land on the wiki's home page instead. That is worse than showing
 * nothing: the home page looks like documentation for this work item when it is
 * merely the front of the wiki, and nothing on screen says which of the two you
 * are reading. An explicit placeholder says what the tab is for and how to fill
 * it, and it is the only honest thing to render when there is genuinely nothing
 * linked.
 *
 * Lives above the host boundary and is rendered only where the `linkedPages`
 * capability is on, so the hub — where an unselected page really does mean
 * "pick one from the tree" — is unaffected.
 */
export function WikiLinkedPagesPlaceholder() {
  return (
    <section className="powerwiki-panel powerwiki-linked-placeholder" role="status">
      <h2>No wiki page is linked to this work item yet</h2>
      <p>
        Choose <strong>Add</strong> in the <strong>Linked pages</strong> rail to link one, and it will
        open here.
      </p>
      <p>
        Linking records the page as a <em>Wiki Page</em> link on the work item, so it also appears on
        the item&rsquo;s own Links tab and travels with it.
      </p>
      <p className="powerwiki-linked-placeholder-note">
        Links are added to the open form, so <strong>save the work item</strong> to keep them.
      </p>
    </section>
  );
}
