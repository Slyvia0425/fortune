import { afterEach, describe, expect, it, vi } from "vitest";

import {
  recordConversationMessage,
  recordDivinationCompletion,
} from "../lib/module4/activity";

function envelope(result: Record<string, unknown>) {
  return new Response(
    JSON.stringify({
      result,
      source_refs: [],
      system: "session-event-v1",
      session_id: result.session_id,
      warnings: [],
      error: null,
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Module 4 session history sync", () => {
  it("stores ordinary chat messages as history-only events", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(envelope({ session_id: "session-1" }));

    await recordConversationMessage("session-1", "user", "我想问事业。", 1);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/module4/api/v1/events/ingest");
    const body = JSON.parse(String(init?.body));
    expect(body).toMatchObject({
      session_id: "session-1",
      source_module: "module2a",
      event_type: "conversation.message",
      sequence_no: 1,
      system: "divination",
      payload: {
        role: "user",
        content: "我想问事业。",
        history_only: true,
      },
    });
  });

  it("stores one structured completion event with the cast result", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(envelope({ session_id: "session-2" }));

    await recordDivinationCompletion(
      "session-2",
      {
        divinationId: "cast-1",
        question: "未来三个月的工作",
        method: "numbers",
        primaryHexagram: { name: "水雷屯" },
        changedHexagram: { name: "水地比" },
        movingLines: [1],
        sourceRefs: ["zhouyi-3"],
      },
      3,
    );

    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(body).toMatchObject({
      session_id: "session-2",
      source_module: "module2a",
      event_type: "module2a.divination.completed",
      sequence_no: 3,
      payload: {
        divination_id: "cast-1",
        method: "numbers",
        moving_lines: [1],
        intent: {
          topic: "未来三个月的工作",
          symbols: ["水雷屯", "水地比"],
        },
      },
      source_refs: ["zhouyi-3"],
    });
  });
});
