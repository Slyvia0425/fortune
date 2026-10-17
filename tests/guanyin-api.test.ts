import { describe, expect, it } from "vitest";

import { POST } from "../app/api/guanyin-lot/draw/route";
import { POST as explain } from "../app/api/guanyin-lot/explain/route";
import type { ApiEnvelope } from "../lib/contracts/api";
import type { GuanyinDrawResult } from "../lib/guanyin/types";

function request(body: unknown) {
  return new Request("http://localhost/api/guanyin-lot/draw", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("观音签抽签 API", () => {
  it("返回签文以及同一签号和领域的结构化推理", async () => {
    const response = await POST(request({ question: "最近是否适合换工作？", domain: "career" }));
    const payload = await response.json() as ApiEnvelope<GuanyinDrawResult>;
    expect(response.status).toBe(200);
    expect(payload.result).not.toBeNull();
    expect(payload.result?.domain).toBe("career");
    expect(payload.result?.reasoning.signId).toBe(payload.result?.stick.id);
    expect(payload.result?.reasoning.domain).toBe("career");
    expect(["reviewed", "unavailable"]).toContain(payload.result?.reasoning.coverage);
    expect(payload.result?.evidence_integration.version).toBe("guanyin-evidence-integration-1.0.0");
    expect(payload.result?.evidence_integration.precedence[0]).toBe("system_safety");
    expect(payload.result?.evidence_integration.forbiddenClaims.length).toBeGreaterThan(0);
    expect(payload.result?.llm_generation.request.version).toBe("guanyin-llm-explanation-1.1.0");
    expect(["pending", "integration_unavailable"]).toContain(payload.result?.llm_generation.status);
  });

  it("拒绝缺失或无效的问题领域", async () => {
    const missing = await POST(request({ question: "测试" }));
    const invalid = await POST(request({ question: "测试", domain: "education" }));
    expect(missing.status).toBe(400);
    expect(invalid.status).toBe(400);
    await expect(invalid.json()).resolves.toMatchObject({ error: { code: "INVALID_DOMAIN" } });
  });

  it("把耗时的现代解释拆分为独立请求", async () => {
    const response = await explain(new Request("http://localhost/api/guanyin-lot/explain", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ question: "最近是否适合换工作？", domain: "career", signId: 16 }) }));
    const payload = await response.json();
    expect(response.status).toBe(200);
    expect(["generated", "insufficient_evidence", "not_configured", "integration_unavailable", "failed"]).toContain(payload.result?.status);
    expect(payload.result?.status).not.toBe("pending");
  });

  it("解释接口拒绝无效签号", async () => {
    const response = await explain(new Request("http://localhost/api/guanyin-lot/explain", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ question: "测试", domain: "career", signId: 101 }) }));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "INVALID_SIGN" } });
  });
});
