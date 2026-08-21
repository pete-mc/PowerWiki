// Reading an `ArtifactUriQuery` response.
//
// The response is a map keyed by artifact URI, and the key is not reliably the
// string that was sent: Azure DevOps echoes back whatever casing it received,
// and it matches URIs case-insensitively when resolving them. Measured against a
// real organisation, sending a fully lower-cased URI returns the same work items
// under a lower-cased key. Looking the result up with `result[uri]` therefore
// works right up until a caller normalises casing anywhere along the way, so the
// lookup here is deliberately case-insensitive too.

/** The shape of `ArtifactUriQueryResult` that matters here. */
export interface ArtifactUriQueryResultLike {
  readonly artifactUrisQueryResult?: {
    readonly [artifactUri: string]: readonly { readonly id: number }[] | undefined;
  };
}

/**
 * The ids of the work items linking to one artifact URI, in the order Azure
 * DevOps returned them. Empty when nothing links to it.
 */
export function workItemIdsForArtifactUri(
  result: ArtifactUriQueryResultLike | undefined,
  artifactUri: string
): readonly number[] {
  const entries = result?.artifactUrisQueryResult;
  if (!entries) {
    return [];
  }

  const wanted = artifactUri.toLowerCase();
  for (const [key, references] of Object.entries(entries)) {
    if (key.toLowerCase() !== wanted) {
      continue;
    }
    // Duplicate ids would render as duplicate rows; the query has been seen to
    // return one reference per relation, and a work item may hold two links to
    // the same page if the paths differ only by encoding.
    return [...new Set((references ?? []).map((reference) => reference.id))];
  }

  return [];
}
