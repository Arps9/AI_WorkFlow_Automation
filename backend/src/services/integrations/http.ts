export class IntegrationError extends Error {
  constructor(public provider: string, message: string, public statusCode = 502) {
    super(`[${provider}] ${message}`);
  }
}

export class NotConnectedError extends IntegrationError {
  constructor(provider: string) {
    super(provider, `${provider} is not connected. Connect it on the Integrations page or set its keys in .env.`, 400);
  }
}

export async function httpJSON<T = any>(
  provider: string,
  url: string,
  init: { method?: string; headers?: Record<string, string>; body?: any } = {}
): Promise<T> {
  const res = await fetch(url, {
    method: init.method || 'GET',
    headers: { Accept: 'application/json', ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...init.headers },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) {
    const msg =
      data?.message ||
      data?.errorMessages?.join('; ') ||
      (data?.errors && JSON.stringify(data.errors)) ||
      data?.error ||
      `${res.status} ${res.statusText}`;
    throw new IntegrationError(provider, `${res.status}: ${msg}`, res.status === 401 || res.status === 403 ? 400 : 502);
  }
  return data as T;
}
