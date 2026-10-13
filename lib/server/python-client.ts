/**
 * Calls to the Python algorithm service. Each engine can be pinned to its own base URL
 * (`PYTHON_BAZI_BASE_URL` / `PYTHON_DIVINATION_BASE_URL`), otherwise `PYTHON_ALGORITHM_BASE_URL` is shared.
 * `PYTHON_SERVICE_NOT_CONFIGURED` and `PYTHON_SERVICE_<status>` are the errors the routes map to 503 and 502.
 */

export type PythonService = "bazi" | "divination";

type PythonEnvironment = Record<string, string | undefined>;

function normalizeBaseUrl(value: string | undefined): string {
  return value?.trim().replace(/\/+$/, "") ?? "";
}

export function resolvePythonBaseUrl(
  service: PythonService,
  env: PythonEnvironment = process.env,
): string {
  const shared = normalizeBaseUrl(env.PYTHON_ALGORITHM_BASE_URL);
  if (service === "bazi") {
    return normalizeBaseUrl(env.PYTHON_BAZI_BASE_URL) || shared;
  }
  return normalizeBaseUrl(env.PYTHON_DIVINATION_BASE_URL) || shared;
}

export function pythonServiceConfigured(
  service: PythonService,
  env: PythonEnvironment = process.env,
): boolean {
  return Boolean(resolvePythonBaseUrl(service, env));
}

const TIMEOUT_MS = 15_000;

async function request<T>(service: PythonService, path: string, init: RequestInit): Promise<T> {
  const baseUrl = resolvePythonBaseUrl(service);
  if (!baseUrl) throw new Error("PYTHON_SERVICE_NOT_CONFIGURED");
  const response = await fetch(`${baseUrl}${path}`, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!response.ok) throw new Error(`PYTHON_SERVICE_${response.status}`);
  return response.json() as Promise<T>;
}

export function callPython<T>(service: PythonService, path: string, payload: unknown): Promise<T> {
  return request<T>(service, path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
}

export function getPython<T>(service: PythonService, path: string): Promise<T> {
  return request<T>(service, path, {});
}
