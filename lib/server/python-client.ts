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

export async function callPython<T>(
  service: PythonService,
  path: string,
  payload: unknown,
): Promise<T> {
  const baseUrl = resolvePythonBaseUrl(service);
  if (!baseUrl) {
    throw new Error(`${service.toUpperCase()}_SERVICE_NOT_CONFIGURED`);
  }

  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    throw new Error(`${service.toUpperCase()}_SERVICE_${response.status}`);
  }
  return response.json() as Promise<T>;
}
