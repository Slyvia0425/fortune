import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { cachedInterpretation } from "../lib/server/interpretation-cache";

const directories: string[] = [];
async function directory() { const path = await mkdtemp(join(tmpdir(), "interpretation-test-")); directories.push(path); return path; }
afterEach(async () => { await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true }))); });

it("persists completed results and scopes them by session and context", async () => {
  const path = await directory();
  const generate = vi.fn(async () => Response.json({ result: "saved", chart_id: "original" }));
  await cachedInterpretation("session-a", { chart_id: "original", context: "job" }, false, generate, path);
  const restored = await cachedInterpretation("session-a", { context: "job", chart_id: "original" }, false, generate, path);
  expect(await restored.json()).toEqual({ result: "saved", chart_id: "original" });
  expect(generate).toHaveBeenCalledTimes(1);
  await cachedInterpretation("session-b", { chart_id: "original", context: "job" }, false, generate, path);
  await cachedInterpretation("session-a", { chart_id: "original", context: "contract" }, false, generate, path);
  expect(generate).toHaveBeenCalledTimes(3);
});

it("a refresh joins the running task instead of generating twice", async () => {
  const path = await directory();
  let finish!: () => void;
  const wait = new Promise<void>(resolve => { finish = resolve; });
  const generate = vi.fn(async () => { await wait; return Response.json({ result: "completed" }); });
  const first = cachedInterpretation("owner", { chart_id: "original" }, false, generate, path);
  const refresh = cachedInterpretation("owner", { chart_id: "original" }, false, generate, path);
  finish();
  expect(await (await first).json()).toEqual(await (await refresh).json());
  expect(generate).toHaveBeenCalledTimes(1);
});

it("restores a failure and retries interpretation only when explicitly requested", async () => {
  const path = await directory();
  const generate = vi.fn(async () => Response.json({ error: "model timed out" }, { status: 502 }));
  await cachedInterpretation("owner", { chart_id: "unchanged" }, false, generate, path);
  expect((await cachedInterpretation("owner", { chart_id: "unchanged" }, false, generate, path)).status).toBe(502);
  expect(generate).toHaveBeenCalledTimes(1);
  const retry = vi.fn(async () => Response.json({ result: "recovered", chart_id: "unchanged" }));
  const result = await cachedInterpretation("owner", { chart_id: "unchanged" }, true, retry, path);
  expect(await result.json()).toEqual({ result: "recovered", chart_id: "unchanged" });
  expect(retry).toHaveBeenCalledTimes(1);
});
