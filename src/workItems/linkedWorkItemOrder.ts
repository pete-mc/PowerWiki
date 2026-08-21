// Which linked work items are finished, and what order to show them in.
//
// "Closed" is not a state name. Every process names its states differently — the
// Basic process this project uses calls them To Do / Doing / Done, Agile uses
// New / Active / Resolved / Closed, and a customised process can call them
// anything at all. What is stable is the state *category*, which Azure DevOps
// assigns to every state in every process: Proposed, InProgress, Resolved,
// Completed, Removed. So the test is on the category, and a work item whose
// category could not be resolved is treated as open rather than hidden away at
// the bottom of the list.

import type { LinkedWorkItem } from "./LinkedWorkItem";

/** State categories that mean the work is over, one way or the other. */
const CLOSED_CATEGORIES = new Set(["Completed", "Removed"]);

/** True when this work item's state means it is finished. */
export function isClosedWorkItem(item: LinkedWorkItem): boolean {
  return item.stateCategory !== undefined && CLOSED_CATEGORIES.has(item.stateCategory);
}

/**
 * Open work items first, newest first within each group.
 *
 * The artifact query returns relation order, which is the order the links
 * happened to be made in and means nothing to a reader. Closed items are kept
 * rather than filtered: "this page documents something that shipped" is worth
 * knowing, it is just not what you are looking for first.
 */
export function orderLinkedWorkItems(items: readonly LinkedWorkItem[]): readonly LinkedWorkItem[] {
  return [...items].sort((left, right) => {
    const leftClosed = isClosedWorkItem(left);
    const rightClosed = isClosedWorkItem(right);
    if (leftClosed !== rightClosed) {
      return leftClosed ? 1 : -1;
    }
    return right.id - left.id;
  });
}
