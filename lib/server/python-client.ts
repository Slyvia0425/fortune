/**
 * Calls to the Python algorithm service (PYTHON_ALGORITHM_BASE_URL). Shared by every module that has a Python engine.
 * `PYTHON_SERVICE_NOT_CONFIGURED` and `PYTHON_SERVICE_<status>` are the errors the routes map to 503 and 502.
 */

const baseUrl = process.env.PYTHON_ALGORITHM_BASE_URL?.replace(/\/$/, "");
const TIMEOUT_MS = 15_000;

export function pythonServiceConfigured() {
  return Boolean(baseUrl);
}

async function request<T>(path: string, init: RequestInit): Promise<T> {
  if (!baseUrl) throw new Error("PYTHON_SERVICE_NOT_CONFIGURED");
  const response = await fetch(`${baseUrl}${path}`, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!response.ok) throw new Error(`PYTHON_SERVICE_${response.status}`);
  return response.json() as Promise<T>;
}

export function callPython<T>(path: string, payload: unknown): Promise<T> {
  return request<T>(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
}

export function getPython<T>(path: string): Promise<T> {
  return request<T>(path, {});
}
