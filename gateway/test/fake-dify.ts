import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface RecordedRequest {
  method: string;
  url: string;
  headers: IncomingMessage['headers'];
  body: unknown;
}

export type FakeHandler = (req: RecordedRequest, res: ServerResponse) => unknown;

/** Minimal HTTP server standing in for Dify. Each test sets `handler`. */
export class FakeDify {
  readonly requests: RecordedRequest[] = [];
  handler: FakeHandler = (_req, res) => res.writeHead(500).end();
  /** Resolves when the gateway closes the upstream connection mid-stream. */
  readonly closedConnections: string[] = [];
  #server: Server | undefined;

  async start(): Promise<string> {
    this.#server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        const recorded: RecordedRequest = {
          method: req.method ?? '',
          url: req.url ?? '',
          headers: req.headers,
          body: text ? (JSON.parse(text) as unknown) : undefined,
        };
        this.requests.push(recorded);
        res.on('close', () => {
          if (!res.writableFinished) this.closedConnections.push(recorded.url);
        });
        void this.handler(recorded, res);
      });
    });
    await new Promise<void>((resolve) => this.#server?.listen(0, '127.0.0.1', resolve));
    const { port } = this.#server.address() as AddressInfo;
    return `http://127.0.0.1:${port}/v1`;
  }

  async stop(): Promise<void> {
    this.#server?.closeAllConnections();
    await new Promise<void>((resolve) => {
      this.#server?.close(() => {
        resolve();
      });
    });
  }
}

export function sse(res: ServerResponse): void {
  res.writeHead(200, { 'content-type': 'text/event-stream' });
}

export const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));
