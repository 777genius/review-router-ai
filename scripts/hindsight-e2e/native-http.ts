/** Only structural native routes are safe diagnostics; identifiers and bodies are private. */
export function safeNativeRoute(path: string): string {
  const route = path.split('?')[0] ?? '';
  const bank = '/v1/default/banks/[^/]+';
  const routes = [
    [new RegExp(`^${bank}$`), '/v1/default/banks/:bank'],
    [new RegExp(`^${bank}/config$`), '/v1/default/banks/:bank/config'],
    [new RegExp(`^${bank}/documents/[^/]+$`), '/v1/default/banks/:bank/documents/:document'],
    [new RegExp(`^${bank}/memories$`), '/v1/default/banks/:bank/memories'],
    [new RegExp(`^${bank}/memories/list$`), '/v1/default/banks/:bank/memories/list'],
    [new RegExp(`^${bank}/memories/[^/]+/history$`), '/v1/default/banks/:bank/memories/:memory/history'],
    [new RegExp(`^${bank}/operations$`), '/v1/default/banks/:bank/operations'],
    [new RegExp(`^${bank}/operations/[^/]+$`), '/v1/default/banks/:bank/operations/:operation'],
    [new RegExp(`^${bank}/operations/[^/]+/delete$`), '/v1/default/banks/:bank/operations/:operation/delete'],
  ] as const;
  return routes.find(([pattern]) => pattern.test(route))?.[1] ?? 'native-endpoint';
}

export function assertNativeCleanupStatus(path: string, method: string, status: number, allowed: readonly number[]): void {
  if (allowed.includes(status)) return;
  const safeMethod = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(method) ? method : 'REQUEST';
  throw new Error(`Native cleanup ${safeMethod} ${safeNativeRoute(path)} returned HTTP ${status}; expected ${allowed.join('/')} (body suppressed)`);
}
