import { loadEnvConfig } from "@next/env";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createRedisConnection } from "@/lib/queues/connection";
import { AwsSecretsManagerTokenVault } from "@/lib/workers/token-vault";
import { createWorkerRuntime, type WorkerHandlers } from "@/lib/workers/runtime";

loadEnvConfig(process.cwd());

async function main(): Promise<void> {
  const handlerModulePath = process.env.WORKER_HANDLER_MODULE ??
    resolve(process.cwd(), "src/workers/handlers.ts");

  const handlerModule = await import(pathToFileURL(resolve(handlerModulePath)).href) as {
    createWorkerHandlers?: () => WorkerHandlers | Promise<WorkerHandlers>;
  };
  if (typeof handlerModule.createWorkerHandlers !== "function") {
    throw new Error("Worker handler module does not export createWorkerHandlers()");
  }

  const connection = createRedisConnection();
  const tokenVault = new AwsSecretsManagerTokenVault(connection);
  const handlers = await handlerModule.createWorkerHandlers();
  const runtime = createWorkerRuntime({ connection, tokenVault, handlers });

  let closing = false;
  const shutdown = async (signal: string) => {
    if (closing) return;
    closing = true;
    console.info(JSON.stringify({ level: "info", event: "worker_shutdown_started", signal }));
    try {
      await runtime.close();
      console.info(JSON.stringify({ level: "info", event: "worker_shutdown_complete", signal }));
      process.exitCode = 0;
    } catch {
      console.error(JSON.stringify({ level: "error", event: "worker_shutdown_failed", signal }));
      process.exitCode = 1;
    }
  };

  process.once("SIGTERM", () => void shutdown("SIGTERM"));
  process.once("SIGINT", () => void shutdown("SIGINT"));
  console.info(JSON.stringify({ level: "info", event: "worker_runtime_started" }));
}

main().catch(() => {
  // Do not print exception messages: third-party or SDK errors can contain
  // request details. All operational events use stable, non-sensitive codes.
  console.error(JSON.stringify({ level: "error", event: "worker_boot_failed", errorCode: "WORKER_BOOT_FAILED" }));
  process.exitCode = 1;
});
