function forward(request: Request, service: Fetcher, prefix: string): Promise<Response> {
  const url = new URL(request.url);
  url.pathname = url.pathname.slice(prefix.length) || '/';
  return service.fetch(new Request(url, request));
}

export default {
  fetch(request, env): Response | Promise<Response> {
    const pathname = new URL(request.url).pathname;
    if (pathname === '/cdn' || pathname.startsWith('/cdn/')) return forward(request, env.UPDATES, '/cdn');
    if (pathname === '/telemetry' || pathname.startsWith('/telemetry/')) return forward(request, env.TELEMETRY, '/telemetry');
    if (pathname === '/app' || pathname.startsWith('/app/')) {
      return Response.json({ status: 'coming soon' }, { status: 404, headers: { 'cache-control': 'no-store' } });
    }
    return Response.redirect(new URL('/app/', request.url), 307);
  }
} satisfies ExportedHandler<Env>;
