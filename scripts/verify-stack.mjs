import assert from "node:assert/strict";

const frontend = process.env.FORTUNE_FRONTEND_URL || "http://localhost:3000";
const module4 = process.env.FORTUNE_MODULE4_URL || "http://127.0.0.1:8003";
const divinationApiUrl = process.env.FORTUNE_ALGORITHM_URL || "http://127.0.0.1:8000";

async function jsonRequest(url, init) {
  const response = await fetch(url, init);
  const body = await response.json();
  assert.equal(response.ok, true, `${url} returned HTTP ${response.status}: ${JSON.stringify(body)}`);
  return body;
}

function passed(name) {
  process.stdout.write(`PASS  ${name}\n`);
}

const pages = ["/", "/bazi", "/divination", "/guanyin", "/knowledge", "/library"];
for (const path of pages) {
  const response = await fetch(`${frontend}${path}`);
  assert.equal(response.status, 200, `${path} returned HTTP ${response.status}`);
  assert.match(response.headers.get("content-type") || "", /text\/html/);
}
passed(`frontend pages (${pages.length})`);

const bazi = await jsonRequest(`${frontend}/api/bazi/chart`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    birth_date: "2000-01-01",
    birth_time: "12:30",
    birth_place: {
      country_code: "SG",
      country: "新加坡",
      city: "新加坡",
      latitude: 1.3521,
      longitude: 103.8198,
      source: "dropdown",
    },
    gender: "unspecified",
    calendar: "solar",
  }),
});
assert.equal(bazi.error, null);
assert.equal(typeof bazi.result?.meta?.mock, "boolean");
assert.equal(bazi.meta.mock, bazi.result.meta.mock, "outer and inner Bazi mock flags differ");
assert.deepEqual(Object.keys(bazi.result.elements).sort(), ["earth", "fire", "metal", "water", "wood"]);
passed(`Bazi contract (mock=${bazi.meta.mock})`);

const divination = await jsonRequest(`${frontend}/api/divination/cast`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    question: "全栈合规验证",
    method: "numbers",
    numbers: [18, 27],
  }),
});
assert.equal(divination.error, null);
assert.equal(divination.meta.mock, false);
assert.equal(divination.result.primary.lines.length, 6);
assert.equal(divination.result.mutual.lines.length, 6);
assert.equal(divination.result.transformed.lines.length, 6);
passed("Divination contract");

const lot = await jsonRequest(`${frontend}/api/guanyin-lot/draw`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ question: "全栈合规验证", domain: "职场" }),
});
assert.equal(lot.result.stick.id >= 1 && lot.result.stick.id <= 100, true);
assert.equal(lot.result.stick.poem.length, 4);
passed("Guanyin lot contract");

const knowledge = await jsonRequest(`${frontend}/api/knowledge/search?q=${encodeURIComponent("五行")}`);
assert.equal(knowledge.error, null);
assert.equal(knowledge.stats.pages, 764);
assert.equal(knowledge.result.length > 0, true);
passed("Knowledge dataset");

const detail = await fetch(`${frontend}/knowledge/knowledge-0`);
assert.equal(detail.status, 200, "knowledge detail page should be served locally");
assert.match(detail.headers.get("content-type") || "", /text\/html/);
passed("Knowledge detail page");

const agent = await jsonRequest(`${frontend}/api/agent/search?q=${encodeURIComponent("五行")}`);
assert.equal(agent.error, null);
assert.equal(agent.result.length > 0, true);
assert.equal(agent.result.some((item) => item.kind === "knowledge"), true);
passed("Cross-module agent search");

const hexagramCatalog = await jsonRequest(`${divinationApiUrl}/divination/catalog`);
assert.equal(hexagramCatalog.length, 64);
passed("Divination hexagram catalog");

const userId = `compliance-${Date.now()}`;
const headers = { "content-type": "application/json", "X-User-Id": userId };
const base = `${module4}/api/v1`;

const collection = await jsonRequest(`${base}/me/collections`, {
  method: "POST",
  headers,
  body: JSON.stringify({
    item_type: "knowledge_item",
    source_id: "source-compliance",
    title: "合规验证",
  }),
});
const tag = await jsonRequest(`${base}/me/tags`, {
  method: "POST",
  headers,
  body: JSON.stringify({ name: "compliance" }),
});
const note = await jsonRequest(`${base}/me/notes`, {
  method: "POST",
  headers,
  body: JSON.stringify({
    collection_id: collection.result.collection_id,
    source_id: "source-compliance",
    title: "合规验证",
    body: "用于全栈验收，随后自动删除。",
    source_refs: ["source-compliance"],
    tags: [tag.result.name],
  }),
});
const exported = await jsonRequest(`${base}/me/exports`, {
  method: "POST",
  headers,
});
assert.equal(exported.result.data.collections.length, 1);
assert.equal(exported.result.data.notes.length, 1);
assert.equal(exported.result.data.tags.length, 1);
assert.equal(note.result.source_refs[0], "source-compliance");
const deleted = await jsonRequest(`${base}/me/data?confirm=true`, {
  method: "DELETE",
  headers,
});
assert.equal(deleted.result.status, "deleted");
passed("Module 4 persistence, isolation, export, and deletion");

process.stdout.write("\nAll stack compliance checks passed.\n");
