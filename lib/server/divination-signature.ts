import { createHmac, randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

// Local Next/Python processes share this private file. Separate hosts must use
// the same DIVINATION_INTERNAL_SECRET environment variable (never NEXT_PUBLIC).
export async function internalSecret(directory = join(process.cwd(), ".runtime")): Promise<string> {
  const configured = process.env.DIVINATION_INTERNAL_SECRET;
  if (configured) {
    if (configured.length < 32) throw new Error("DIVINATION_INTERNAL_SECRET_TOO_SHORT");
    return configured;
  }
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const path = join(directory, "divination-internal.key");
  try { await writeFile(path, randomBytes(32).toString("hex"), { flag:"wx", mode:0o600 }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
  const secret = (await readFile(path, "utf8")).trim();
  if (secret.length < 32) throw new Error("DIVINATION_INTERNAL_SECRET_INVALID");
  return secret;
}

export function signInternalRequest(secret: string, path: string, timestamp: string, identity: string, body: string): string {
  return createHmac("sha256", secret).update(`${path}\n${timestamp}\n${identity}\n${body}`).digest("hex");
}
