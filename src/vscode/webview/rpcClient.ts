// The webview half of the extension bridge.
//
// One pending-promise table, one message listener. The `WikiRepositoryClient`
// proxy it builds is not a partial reimplementation: every method forwards by
// name, so a method added to the interface works here without being listed
// anywhere — which is the point, since the whole reason the VS Code host is
// cheap is that it implements one interface rather than reimplementing an app.

import { BINARY_WIKI_METHODS, type ExtensionMessage, type HostMethod, type StateMessage } from "../protocol";
import type { WikiRepositoryClient } from "../../wiki/WikiRepositoryClient";

interface VsCodeApi {
  postMessage(message: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

type PendingCall = {
  readonly resolve: (value: unknown) => void;
  readonly reject: (error: Error) => void;
  readonly method: HostMethod;
  readonly wikiMethod?: string;
};

export class ExtensionBridge {
  private readonly api = acquireVsCodeApi();
  private readonly pending = new Map<number, PendingCall>();
  private nextId = 1;
  private readonly listeners = new Set<(message: ExtensionMessage) => void>();

  public constructor() {
    window.addEventListener("message", (event: MessageEvent<ExtensionMessage>) => {
      const message = event.data;
      if (message?.type === "response") {
        this.settle(message.id, message.value, message.error);
        return;
      }

      for (const listener of this.listeners) {
        listener(message);
      }
    });
  }

  public onMessage(listener: (message: ExtensionMessage) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  public call<T>(method: HostMethod, ...args: unknown[]): Promise<T> {
    return this.request<T>(method, args);
  }

  /** Tells the extension the listener is attached and init can be sent. */
  public signalReady(): void {
    this.api.postMessage({ type: "ready" });
  }

  /** Reports what is on screen: an edit-in-progress guard, and the test hook. */
  public postState(state: Omit<StateMessage, "type">): void {
    this.api.postMessage({ type: "state", ...state });
  }

  /**
   * A `WikiRepositoryClient` that forwards every call to the extension host.
   *
   * The Proxy is what keeps this honest — a hand-written class of 20 forwarding
   * methods would be one `git log` away from missing one.
   */
  public createWikiClient(): WikiRepositoryClient {
    return new Proxy({} as WikiRepositoryClient, {
      get: (_target, property: string) => {
        return (...args: unknown[]) => this.request("wiki", [property, ...args], property);
      }
    });
  }

  private request<T>(method: HostMethod, args: readonly unknown[], wikiMethod?: string): Promise<T> {
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, {
        method,
        wikiMethod,
        resolve: resolve as (value: unknown) => void,
        reject
      });
      this.api.postMessage({ type: "request", id, method, args });
    });
  }

  private settle(id: number, value: unknown, error: string | undefined): void {
    const call = this.pending.get(id);
    if (!call) {
      return;
    }
    this.pending.delete(id);

    if (error !== undefined) {
      call.reject(new Error(error));
      return;
    }

    // Bytes crossed as base64 because postMessage to a webview is JSON; decode
    // them back into the ArrayBuffer the interface promises.
    if (call.method === "wiki" && call.wikiMethod && BINARY_WIKI_METHODS.has(call.wikiMethod)) {
      call.resolve(base64ToArrayBuffer(String(value ?? "")));
      return;
    }

    call.resolve(value);
  }
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes.buffer;
}
