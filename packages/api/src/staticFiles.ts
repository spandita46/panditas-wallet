import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import type { FastifyInstance, FastifyReply } from "fastify";

// Hand-rolled in place of @fastify/static — that plugin (specifically, not
// any of its configurable headers) causes iOS Safari's "Add to Home Screen"
// icon generation to silently fail on every request it serves, confirmed by
// isolating it against a plain Fastify route reading the same files with
// node:fs. Root cause not fully identified (something in @fastify/send's
// response-writing path WebKit's icon fetcher dislikes), but the fix is
// simply not depending on it.
const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
};

function contentTypeFor(path: string): string {
  return MIME_TYPES[extname(path)] ?? "application/octet-stream";
}

const TEXT_EXTENSIONS = new Set([".html", ".js", ".css", ".json", ".webmanifest", ".txt", ".svg"]);
function isTextFile(path: string): boolean {
  return TEXT_EXTENSIONS.has(extname(path));
}

// vite's content-hashed filenames (e.g. assets/index-CXYh39z6.js) are safe to
// cache indefinitely — a new build always gets a new hash. Everything else
// (index.html, manifest.webmanifest, sw.js, icons) is left with no
// Cache-Control header at all: explicitly sending "no-cache" was tried and
// broke iOS Safari's "Add to Home Screen" icon install even with
// @fastify/static gone, so for now we just omit the header outside /assets/
// rather than assert a value here.
function cacheControlFor(requestPath: string, isRealFile: boolean): string | undefined {
  return isRealFile && requestPath.startsWith("/assets/") ? "public, max-age=31536000, immutable" : undefined;
}

export function registerStaticFiles(app: FastifyInstance, webRoot: string): void {
  async function serveFile(requestPath: string, reply: FastifyReply) {
    const decoded = decodeURIComponent(requestPath.split("?")[0] ?? "/");
    const resolved = normalize(join(webRoot, decoded));
    // Reject any path that escapes webRoot (e.g. "/../../etc/passwd").
    if (!resolved.startsWith(webRoot)) {
      return reply.code(400).send({ error: "Invalid path" });
    }

    let filePath = resolved;
    let isRealFile = true;
    try {
      const info = await stat(filePath);
      if (info.isDirectory()) filePath = join(filePath, "index.html");
    } catch {
      // Doesn't exist as a real file — SPA fallback so client-side routes
      // (e.g. a refresh on /transactions) still resolve to the app shell.
      filePath = join(webRoot, "index.html");
      isRealFile = false;
    }

    let body: string | Buffer;
    if (isTextFile(filePath)) {
      body = await readFile(filePath, "utf-8");
    } else {
      body = await readFile(filePath);
    }
    reply.header("content-type", contentTypeFor(filePath));
    const cacheControl = cacheControlFor(decoded, isRealFile);
    if (cacheControl) reply.header("cache-control", cacheControl);
    return reply.send(body);
  }

  app.get("/*", async (request, reply) => serveFile(request.url, reply));
}
