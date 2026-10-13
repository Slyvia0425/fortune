import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

type SavedResponse = { status: number; body: unknown };
const runtime = globalThis as typeof globalThis & { interpretationJobs?: Map<string, Promise<SavedResponse>> };
const jobs = runtime.interpretationJobs ??= new Map();
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k,v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
}

// Scope by session AND question context: changing the question must not reuse an old interpretation.
export async function cachedInterpretation(owner: string, input: unknown, retry: boolean, generate: () => Promise<Response>, directory = join(process.cwd(), ".runtime", "interpretations")): Promise<Response> {
  const key = createHash("sha256").update(owner + canonical(input)).digest("hex");
  const jobKey = directory + key;
  const path = join(directory, `${key}.json`);
  const active = jobs.get(jobKey);
  if (active) { const saved = await active; return Response.json(saved.body, { status: saved.status }); }
  const job = (async () => {
    if (!retry) {
      try { return JSON.parse(await readFile(path, "utf8")) as SavedResponse; }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    }
    const response = await generate();
    const saved = { status: response.status, body: await response.json() };
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const temporary = `${path}.${randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify(saved), { mode: 0o600 });
    await rename(temporary, path);
    return saved;
  })();
  jobs.set(jobKey, job);
  try { const saved = await job; return Response.json(saved.body, { status: saved.status }); }
  finally { jobs.delete(jobKey); }
}
