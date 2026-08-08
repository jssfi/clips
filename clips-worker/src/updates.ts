const RELEASE_PREFIX = "releases/";
const VERSIONED_ARTIFACT =
  /^(?:jss-clips-(?:update|setup|portable)-\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?-(?:x64|arm64)\.(?:exe|exe\.blockmap)|jss-clips-app-\d+\.\d+\.\d+-x64\.zip)$/;

function artifactName(pathname: string): { name: string; key: string } | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  if (!decoded.startsWith("/")) return null;
  const stable = decoded.startsWith("/stable/");
  const name = decoded.slice(stable ? 8 : 1);
  if (name.includes("/")) return null;
  if (name !== "latest.yml" && name !== "latest.json" && !VERSIONED_ARTIFACT.test(name)) return null;
  return { name, key: `${RELEASE_PREFIX}${stable ? "stable/" : ""}${name}` };
}

function contentType(name: string): string {
  if (name.endsWith(".yml")) return "text/yaml; charset=utf-8";
  if (name.endsWith(".json")) return "application/json; charset=utf-8";
  if (name.endsWith(".zip")) return "application/zip";
  return "application/octet-stream";
}

function cacheControl(name: string): string {
  return name === "latest.yml" || name === "latest.json"
    ? "no-store, max-age=0"
    : "public, max-age=31536000, immutable";
}

function parseRange(value: string, size: number): R2Range | null {
  const match = /^bytes=(\d*)-(\d*)$/.exec(value.trim());
  if (!match || (!match[1] && !match[2])) return null;
  if (!match[1]) {
    const suffix = Number(match[2]);
    return Number.isSafeInteger(suffix) && suffix > 0
      ? { suffix: Math.min(suffix, size) }
      : null;
  }
  const start = Number(match[1]);
  const requestedEnd = match[2] ? Number(match[2]) : size - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(requestedEnd)
    || start < 0 || start >= size || requestedEnd < start) {
    return null;
  }
  const end = Math.min(requestedEnd, size - 1);
  return { offset: start, length: end - start + 1 };
}

function commonHeaders(name: string, object: R2Object): Headers {
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("Content-Type", headers.get("Content-Type") || contentType(name));
  headers.set("Cache-Control", cacheControl(name));
  headers.set("ETag", object.httpEtag);
  headers.set("Accept-Ranges", "bytes");
  headers.set("X-Content-Type-Options", "nosniff");
  if (name.endsWith(".exe") || name.endsWith(".zip")) {
    headers.set("Content-Disposition", `attachment; filename="${name}"`);
  }
  return headers;
}

async function serve(request: Request, bucket: R2Bucket): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method Not Allowed", {
      status: 405,
      headers: { Allow: "GET, HEAD" }
    });
  }

  const artifact = artifactName(new URL(request.url).pathname);
  if (!artifact) return new Response("Not Found", { status: 404 });
  const { name, key } = artifact;

  if (request.method === "HEAD") {
    const object = await bucket.head(key);
    if (!object) return new Response("Not Found", { status: 404 });
    const headers = commonHeaders(name, object);
    headers.set("Content-Length", String(object.size));
    return new Response(null, { status: 200, headers });
  }

  let requestedRange: R2Range | undefined;
  const rangeHeader = request.headers.get("Range");
  if (rangeHeader) {
    const metadata = await bucket.head(key);
    if (!metadata) return new Response("Not Found", { status: 404 });
    requestedRange = parseRange(rangeHeader, metadata.size) ?? undefined;
    if (!requestedRange) {
      const headers = new Headers({ "Accept-Ranges": "bytes" });
      headers.set("Content-Range", `bytes */${metadata.size}`);
      return new Response("Range Not Satisfiable", { status: 416, headers });
    }
  }

  const object = await bucket.get(key, {
    onlyIf: request.headers,
    ...(requestedRange ? { range: requestedRange } : {})
  });
  if (!object) return new Response("Not Found", { status: 404 });
  const headers = commonHeaders(name, object);
  if (!("body" in object)) {
    const notModified = request.headers.has("If-None-Match")
      || request.headers.has("If-Modified-Since");
    return new Response(null, { status: notModified ? 304 : 412, headers });
  }

  let status = 200;
  if (requestedRange) {
    let offset: number;
    let length: number;
    if ("suffix" in requestedRange) {
      length = requestedRange.suffix;
      offset = object.size - length;
    } else {
      offset = requestedRange.offset ?? 0;
      length = requestedRange.length ?? object.size - offset;
    }
    const end = offset + length - 1;
    headers.set("Content-Range", `bytes ${offset}-${end}/${object.size}`);
    headers.set("Content-Length", String(length));
    status = 206;
  } else {
    headers.set("Content-Length", String(object.size));
  }
  return new Response(object.body, { status, headers });
}

export { artifactName, cacheControl, parseRange, serve };

export default {
  async fetch(request, env): Promise<Response> {
    return serve(request, env.UPDATES);
  }
} satisfies ExportedHandler<Env>;
