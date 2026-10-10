import { describe, expect, it, vi } from "vitest";

import sample from "./fixtures/bazi-chart-sample.json";

const BODY = {
  birth_date: "1990-05-17",
  birth_time: "08:30",
  birth_place: { latitude: 31.2, longitude: 121.5, source: "manual_coordinates" },
  gender: "male",
};

async function post(body: string, python: () => Promise<unknown>) {
  vi.resetModules();
  vi.doMock("../lib/server/python-client", () => ({ pythonServiceConfigured: () => true, callPython: python }));
  const { POST } = await import("../app/api/bazi/chart/route");
  const response = await POST(new Request("http://x/api/bazi/chart", { method: "POST", body }));
  return { status: response.status, json: await response.json() };
}

describe("POST /api/bazi/chart", () => {
  it("wraps the engine's chart in the envelope, with its sources", async () => {
    const out = await post(JSON.stringify(BODY), async () => sample.result);
    expect(out.status).toBe(200);
    expect(out.json.result.pillars).toHaveLength(4);
    expect(out.json.source_refs.length).toBeGreaterThan(0);
    expect(out.json.meta.mock).toBe(false);
  });

  it("rejects a body that is not JSON, and one that is not a valid birth request", async () => {
    expect((await post("not json", async () => ({}))).json.error.code).toBe("INVALID_JSON");
    const bad = await post(JSON.stringify({ ...BODY, birth_date: "2001-02-29" }), async () => ({}));
    expect(bad.status).toBe(400);
    expect(bad.json.error.code).toBe("VALIDATION_ERROR");
  });

  it("answers 503 when the service is not configured and 502 when the call fails", async () => {
    const off = await post(JSON.stringify(BODY), async () => { throw new Error("PYTHON_SERVICE_NOT_CONFIGURED"); });
    expect([off.status, off.json.error.code]).toEqual([503, "ALGORITHM_SERVICE_NOT_CONFIGURED"]);
    const down = await post(JSON.stringify(BODY), async () => { throw new Error("PYTHON_SERVICE_500"); });
    expect([down.status, down.json.error.code, down.json.error.details.cause]).toEqual([502, "ALGORITHM_SERVICE_ERROR", "PYTHON_SERVICE_500"]);
  });
});
