/** Bound both response headers and body; a stalled request must not occupy the sync executor forever. */
export async function fetchWithDeadline(input: RequestInfo | URL, init: RequestInit = {}, timeoutMs = 15000): Promise<Response> {
  const controller = new AbortController();
  const caller = init.signal;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let cancel = () => {};
  const failure = new Promise<never>((_, reject) => {
    cancel = () => {
      const error = new DOMException('操作已取消', 'AbortError');
      controller.abort(error); reject(error);
    };
    if (caller?.aborted) { cancel(); return; }
    caller?.addEventListener('abort', cancel, { once: true });
    timeout = setTimeout(() => {
      const error = new DOMException('网络响应超时，将自动重试', 'TimeoutError');
      controller.abort(error); reject(error);
    }, timeoutMs);
  });
  try {
    return await Promise.race([
      failure,
      (async () => {
        const response = await fetch(input, { ...init, signal: controller.signal });
        const bytes = await response.arrayBuffer();
        return new Response([204, 205, 304].includes(response.status) ? null : bytes, { status: response.status, statusText: response.statusText, headers: response.headers });
      })(),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
    caller?.removeEventListener('abort', cancel);
  }
}
