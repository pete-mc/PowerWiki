/**
 * Waits for a host-service promise, giving up after `timeoutMs`.
 *
 * Azure DevOps extension SDK calls such as `SDK.getService()` only *reject* on an
 * explicit failure. When the host handshake never completes — the normal case
 * outside a real hub iframe, including the local sandbox, and a possibility if the
 * host stalls — the returned promise never settles at all. Awaiting one on a
 * critical path therefore hangs the UI silently, with no error to render and no
 * fallback reachable.
 *
 * Resolving to `undefined` rather than throwing is deliberate: an absent host
 * service is a degraded-but-usable state (navigation falls back to
 * `window.location.hash`), not an error worth showing the user.
 */
export function resolveWithinTimeout<T>(
  pending: Promise<T>,
  timeoutMs: number
): Promise<T | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined;

  return Promise.race([
    // A rejection is also "no service": callers cannot use one either way.
    pending.catch(() => undefined),
    new Promise<undefined>((resolve) => {
      timer = setTimeout(() => resolve(undefined), timeoutMs);
    })
  ]).finally(() => {
    // Always clear it. Left pending, a long timer keeps the event loop alive,
    // which in Node (tests, tooling) delays exit.
    clearTimeout(timer);
  });
}
