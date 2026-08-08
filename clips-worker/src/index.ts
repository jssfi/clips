import { serve as serveUpdates } from './updates';
import { serveTelemetry } from './telemetry';

function withoutPrefix(request: Request, prefix: string): Request {
  const url = new URL(request.url);
  url.pathname = url.pathname.slice(prefix.length) || '/';
  return new Request(url, request);
}

export default {
  fetch(request, env): Response | Promise<Response> {
    const url = new URL(request.url);
    if (url.hostname === env.LEGACY_UPDATE_DOMAIN) {
      url.hostname = env.PRIMARY_DOMAIN;
      url.pathname = `${env.UPDATE_PATH}${url.pathname}`;
      return Response.redirect(url, 308);
    }
    if (url.hostname === env.LEGACY_TELEMETRY_DOMAIN) {
      url.hostname = env.PRIMARY_DOMAIN;
      url.pathname = `${env.TELEMETRY_PATH}${url.pathname}`;
      return Response.redirect(url, 308);
    }
    const pathname = url.pathname;
    if (pathname === '/cdn' || pathname.startsWith('/cdn/')) {
      return serveUpdates(withoutPrefix(request, '/cdn'), env.UPDATES);
    }
    if (pathname === '/telemetry' || pathname.startsWith('/telemetry/')) {
      return serveTelemetry(withoutPrefix(request, '/telemetry'), env.TELEMETRY);
    }
    if (pathname === '/app' || pathname.startsWith('/app/')) {
      return Response.json({ status: 'coming soon' }, { status: 404, headers: { 'cache-control': 'no-store' } });
    }
    return Response.redirect(new URL('/app/', request.url), 307);
  }
} satisfies ExportedHandler<Env>;
