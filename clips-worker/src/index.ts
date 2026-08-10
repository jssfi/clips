import { serve as serveUpdates } from './updates';
import { serveTelemetry } from './telemetry';

function withoutPrefix(request: Request, prefix: string): Request {
  const url = new URL(request.url);
  url.pathname = url.pathname.slice(prefix.length) || '/';
  return new Request(url, request);
}

export default {
  async fetch(request, env): Promise<Response> {
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
    if (pathname === '/download') {
      const metadata = await env.UPDATES.get('releases/latest.yml');
      const installer = metadata && /^path:\s*([^\r\n]+)$/m.exec(await metadata.text())?.[1]?.trim();
      if (!installer || installer.includes('/') || installer.includes('\\')) {
        return new Response('The Windows download is temporarily unavailable.', { status: 503 });
      }
      return Response.redirect(new URL(`/cdn/${installer}`, request.url), 307);
    }
    if (pathname === '/source') {
      const metadata = await env.UPDATES.get('releases/latest.json');
      const version = metadata ? String((await metadata.json<{ version?: unknown }>()).version || '') : '';
      if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
        return new Response('The corresponding source is temporarily unavailable.', { status: 503 });
      }
      return Response.redirect(new URL(`/cdn/jss-clips-source-${version}.zip`, request.url), 307);
    }
    if (pathname === '/app' || pathname.startsWith('/app/')) {
      if (pathname === '/app') return Response.redirect(new URL('/app/', request.url), 308);
      return env.ASSETS.fetch(request);
    }
    return Response.redirect(new URL('/app/', request.url), 307);
  }
} satisfies ExportedHandler<Env>;
