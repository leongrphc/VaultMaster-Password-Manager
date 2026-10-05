// Only /api requests invoke this Worker. Static assets retain Cloudflare's
// direct delivery path and build-generated security headers.
export async function proxyApi(request, env, upstreamFetch = fetch) {
  const url = new URL(request.url);
  if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
  let origin;
  try { origin = new URL(env.API_ORIGIN); }
  catch { return new Response('Invalid API origin', { status: 503 }); }
  if (origin.protocol !== 'https:' || origin.pathname !== '/' || origin.search || origin.hash || origin.username || origin.password) {
    return new Response('Invalid API origin', { status: 503 });
  }
  const target = new URL(url.pathname + url.search, origin);
  const headers = new Headers(request.headers);
  headers.delete('host');
  headers.delete('authorization');
  headers.delete('x-forwarded-host');
  headers.delete('x-forwarded-for');
  headers.set('x-forwarded-proto', 'https');
  try {
    const upstream = await upstreamFetch(new Request(target, { method: request.method, headers,
      body: ['GET', 'HEAD'].includes(request.method) ? undefined : request.body, redirect: 'manual', duplex: 'half' }));
    // Never forward credentials on redirects or cache personalized responses.
    if (upstream.status >= 300 && upstream.status < 400) return new Response('Unexpected API redirect', { status: 502 });
    const response = new Response(upstream.body, upstream);
    response.headers.set('cache-control', 'no-store');
    response.headers.set('x-content-type-options', 'nosniff');
    for (const name of [...response.headers.keys()]) if (name.startsWith('access-control-')) response.headers.delete(name);
    return response;
  } catch { return Response.json({ success: false, error: 'API sunucusuna ulaşılamıyor.' }, { status: 502, headers: { 'cache-control': 'no-store' } }); }
}
export default { fetch(request, env) { return proxyApi(request, env); } };
