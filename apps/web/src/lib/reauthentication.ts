export interface ReauthenticationRequest {
  method: string;
  path: string;
  authHash?: string;
}
let handler: ((request: ReauthenticationRequest) => Promise<string>) | undefined;
export function registerReauthenticationHandler(value: typeof handler) {
  handler = value;
  return () => { if (handler === value) handler = undefined; };
}
export function requestReauthentication(request: ReauthenticationRequest) {
  if (!handler) return Promise.reject(new Error('Yeniden doğrulama penceresi hazır değil. Kasayı açıp tekrar deneyin.'));
  return handler(request);
}
