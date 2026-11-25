import { createServer, type Server } from "node:http";

export interface WorkerHealthServerOptions {
  port: number;
  host?: string;
  isReady: () => boolean;
}

export interface WorkerHealthServerHandle {
  server: Server;
  listen(): Promise<void>;
  close(): Promise<void>;
}

function sendJson(
  response: import("node:http").ServerResponse,
  statusCode: number,
  body: { status: string },
  extraHeaders: Record<string, string> = {},
): void {
  response.writeHead(statusCode, {
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8",
    ...extraHeaders,
  });
  response.end(JSON.stringify(body));
}

/**
 * Private-network health probes for the long-running BullMQ process.
 * Responses intentionally contain no environment, queue, tenant, or secret data.
 */
export function createWorkerHealthServer(
  options: WorkerHealthServerOptions,
): WorkerHealthServerHandle {
  if (
    !Number.isInteger(options.port) ||
    options.port < 0 ||
    options.port > 65_535
  ) {
    throw new Error("Worker health port must be an integer from 0 to 65535");
  }

  const server = createServer((request, response) => {
    const pathname = (request.url ?? "/").split("?", 1)[0];

    if (request.method !== "GET") {
      sendJson(response, 405, { status: "method_not_allowed" }, { allow: "GET" });
      return;
    }

    if (pathname === "/live") {
      sendJson(response, 200, { status: "alive" });
      return;
    }

    if (pathname === "/ready") {
      let ready = false;
      try {
        ready = options.isReady();
      } catch {
        ready = false;
      }
      sendJson(response, ready ? 200 : 503, {
        status: ready ? "ready" : "not_ready",
      });
      return;
    }

    sendJson(response, 404, { status: "not_found" });
  });

  return {
    server,
    listen: () =>
      new Promise<void>((resolve, reject) => {
        if (server.listening) {
          resolve();
          return;
        }

        const onError = (error: Error) => {
          server.off("listening", onListening);
          reject(error);
        };
        const onListening = () => {
          server.off("error", onError);
          resolve();
        };

        server.once("error", onError);
        server.once("listening", onListening);
        server.listen(options.port, options.host ?? "0.0.0.0");
      }),
    close: () =>
      new Promise<void>((resolve, reject) => {
        if (!server.listening) {
          resolve();
          return;
        }
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      }),
  };
}
