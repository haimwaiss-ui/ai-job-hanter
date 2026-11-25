import { loadEnvConfig } from "@next/env";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createRedisConnection } from "@/lib/queues/connection";
import { AwsSecretsManagerTokenVault } from "@/lib/workers/token-vault";
import { createWorkerRuntime, type WorkerHandlers } from "@/lib/workers/runtime";
import { createWorkerHealthServer } from "./health-server";

loadEnvConfig(process.cwd());

async function main(): Promise<void> {
  let connection: ReturnType<typeof createRedisConnection> | undefined;
  let runtime: ReturnType<typeof createWorkerRuntime> | undefined;
  let healthServer: ReturnType<typeof createWorkerHealthServer> | undefined;

  try {
    const handlerModulePath = process.env.WORKER_HANDLER_MODULE ??
      resolve(process.cwd(), "src/workers/handlers.ts");

    const handlerModule = await import(pathToFileURL(resolve(handlerModulePath)).href) as {
      createWorkerHandlers?: () => WorkerHandlers | Promise<WorkerHandlers>;
    };
    if (typeof handlerModule.createWorkerHandlers !== "function") {
      throw new Error("Worker handler module does not export createWorkerHandlers()");
    }

    const healthPort = Number(process.env.WORKER_HEALTH_PORT ?? "8080");
    if (!Number.isInteger(healthPort) || healthPort < 1 || healthPort > 65_535) {
      throw new Error("WORKER_HEALTH_PORT must be an integer from 1 to 65535");
    }

    connection = createRedisConnection();
    const tokenVault = new AwsSecretsManagerTokenVault(connection);
    const handlers = await handlerModule.createWorkerHandlers();
    const activeRuntime = createWorkerRuntime({ connection, tokenVault, handlers });
    runtime = activeRuntime;

    // Do not advertise readiness until every BullMQ worker has connected.
    await Promise.all(activeRuntime.workers.map((worker) => worker.waitUntilReady()));
    if (connection.status !== "ready") {
      throw new Error("Worker Redis connection is not ready");
    }

    let acceptingJobs = true;
    const activeHealthServer = createWorkerHealthServer({
      port: healthPort,
      host: process.env.WORKER_HEALTH_HOST?.trim() || "0.0.0.0",
      isReady: () =>
        acceptingJobs &&
        connection?.status === "ready" &&
        activeRuntime.workers.every((worker) => worker.isRunning() && !worker.isPaused()),
    });
    healthServer = activeHealthServer;
    await activeHealthServer.listen();

    let closing = false;
    const shutdown = async (signal: string) => {
      if (closing) return;
      closing = true;
      acceptingJobs = false;
      console.info(JSON.stringify({ level: "info", event: "worker_shutdown_started", signal }));
      try {
        await activeRuntime.close();
        console.info(JSON.stringify({ level: "info", event: "worker_shutdown_complete", signal }));
        process.exitCode = 0;
      } catch {
        console.error(JSON.stringify({ level: "error", event: "worker_shutdown_failed", signal }));
        process.exitCode = 1;
      } finally {
        try {
          await activeHealthServer.close();
        } catch {
          console.error(JSON.stringify({ level: "error", event: "worker_health_server_close_failed" }));
          process.exitCode = 1;
        }
      }
    };

    process.once("SIGTERM", () => void shutdown("SIGTERM"));
    process.once("SIGINT", () => void shutdown("SIGINT"));
    console.info(JSON.stringify({
      level: "info",
      event: "worker_runtime_started",
      healthPort,
    }));
  } catch {
    // Do not print exception messages: SDK errors may contain request details.
    if (healthServer) await healthServer.close().catch(() => undefined);
    if (runtime) {
      await runtime.close().catch(() => undefined);
    } else if (connection && connection.status !== "end") {
      await connection.quit().catch(() => undefined);
    }
    throw new Error("Worker bootstrap failed");
  }
}

main().catch(() => {
  // All operational events use stable, non-sensitive codes.
  console.error(JSON.stringify({ level: "error", event: "worker_boot_failed", errorCode: "WORKER_BOOT_FAILED" }));
  process.exitCode = 1;
});
