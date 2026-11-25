import { afterEach, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import {
  createWorkerHealthServer,
  type WorkerHealthServerHandle,
} from "./health-server";

const servers: WorkerHealthServerHandle[] = [];

async function startHealthServer(isReady: () => boolean): Promise<string> {
  const health = createWorkerHealthServer({
    host: "127.0.0.1",
    port: 0,
    isReady,
  });
  servers.push(health);
  await health.listen();

  const address = health.server.address();
  if (!address || typeof address === "string") {
    throw new Error("Health server did not bind to a TCP port");
  }
  return "http://127.0.0.1:" + (address as AddressInfo).port;
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

describe("worker health probes", () => {
  it("keeps liveness healthy while readiness is false", async () => {
    const baseUrl = await startHealthServer(() => false);

    const live = await fetch(baseUrl + "/live");
    const ready = await fetch(baseUrl + "/ready");

    expect(live.status).toBe(200);
    expect(await live.json()).toEqual({ status: "alive" });
    expect(ready.status).toBe(503);
    expect(await ready.json()).toEqual({ status: "not_ready" });
    expect(ready.headers.get("cache-control")).toBe("no-store");
  });

  it("reports ready only after the worker runtime becomes ready", async () => {
    let ready = false;
    const baseUrl = await startHealthServer(() => ready);

    expect((await fetch(baseUrl + "/ready")).status).toBe(503);
    ready = true;
    expect((await fetch(baseUrl + "/ready")).status).toBe(200);
  });

  it("returns generic responses for unknown paths and unsupported methods", async () => {
    const baseUrl = await startHealthServer(() => true);

    const missing = await fetch(baseUrl + "/metrics");
    const method = await fetch(baseUrl + "/ready", { method: "POST" });

    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ status: "not_found" });
    expect(method.status).toBe(405);
    expect(method.headers.get("allow")).toBe("GET");
    expect(await method.json()).toEqual({ status: "method_not_allowed" });
  });

  it("fails readiness closed if the readiness callback throws", async () => {
    const baseUrl = await startHealthServer(() => {
      throw new Error("private diagnostic detail");
    });

    const response = await fetch(baseUrl + "/ready");
    const body = await response.text();

    expect(response.status).toBe(503);
    expect(JSON.parse(body)).toEqual({ status: "not_ready" });
    expect(body).not.toContain("private diagnostic detail");
  });
});
