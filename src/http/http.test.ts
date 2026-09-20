import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { runHttp } from "./server.js";

function mkTmpProject(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "brain-http-test-"));
  fs.mkdirSync(path.join(dir, "src"));
  fs.writeFileSync(path.join(dir, "src", "app.js"), "export function hello() {\n  return 1;\n}\n");
  return dir;
}

function request(port: number, method: string, urlPath: string, body?: unknown): Promise<{ status: number; json: unknown }> {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : Buffer.from(JSON.stringify(body));
    const req = http.request(
      { host: "localhost", port, path: urlPath, method, headers: payload ? { "Content-Type": "application/json", "Content-Length": payload.length } : undefined },
      (res) => {
        let raw = "";
        res.on("data", (chunk) => (raw += chunk));
        res.on("end", () => {
          try {
            resolve({ status: res.statusCode ?? 0, json: raw ? JSON.parse(raw) : undefined });
          } catch {
            resolve({ status: res.statusCode ?? 0, json: raw });
          }
        });
      },
    );
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function withServer(root: string, fn: (port: number) => Promise<void>): Promise<void> {
  const server = await runHttp(root, 0, false);
  const port = (server.address() as AddressInfo).port;
  try {
    await fn(port);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

test("runHttp binds to an OS-chosen port when given 0", async () => {
  const root = mkTmpProject();
  await withServer(root, async (port) => {
    assert.ok(port > 0);
  });
});

test("GET /api/files lists the project tree", async () => {
  const root = mkTmpProject();
  await withServer(root, async (port) => {
    const { status, json } = await request(port, "GET", "/api/files");
    assert.equal(status, 200);
    const names = (json as { children: { name: string }[] }).children.map((c) => c.name);
    assert.ok(names.includes("src"));
  });
});

test("GET /api/file returns 400 with an error body for a missing file", async () => {
  const root = mkTmpProject();
  await withServer(root, async (port) => {
    const { status, json } = await request(port, "GET", "/api/file?path=nope.js");
    assert.equal(status, 400);
    assert.ok((json as { error: string }).error);
  });
});

test("POST /api/doc then GET /api/docs/search finds it, round-trip through real HTTP", async () => {
  const root = mkTmpProject();
  await withServer(root, async (port) => {
    const write = await request(port, "POST", "/api/doc", { path: "overview.md", content: "# Overview\nUses SQLite FTS5.\n" });
    assert.equal(write.status, 200);
    const search = await request(port, "GET", "/api/docs/search?q=sqlite");
    assert.equal(search.status, 200);
    const hits = search.json as { doc: string; line: number }[];
    assert.equal(hits.length, 1);
    assert.equal(hits[0].doc, "overview.md");
  });
});

test("GET /api/docs/graph reflects a wikilink between two written docs", async () => {
  const root = mkTmpProject();
  await withServer(root, async (port) => {
    await request(port, "POST", "/api/doc", { path: "overview.md", content: "See [[Auth]].\n" });
    await request(port, "POST", "/api/doc", { path: "auth.md", content: "# Auth\n" });
    const { json } = await request(port, "GET", "/api/docs/graph");
    const graph = json as { edges: { source: string; target: string }[] };
    assert.deepEqual(graph.edges, [{ source: "overview.md", target: "auth.md" }]);
  });
});

test("GET /api/search finds code written through POST /api/file", async () => {
  const root = mkTmpProject();
  await withServer(root, async (port) => {
    await request(port, "POST", "/api/file", { path: "src/new.js", content: "function findMeViaHttp() {}\n" });
    const { json } = await request(port, "GET", "/api/search?q=findMeViaHttp");
    const hits = json as { path: string }[];
    assert.equal(hits.length, 1);
    assert.equal(hits[0].path, path.join("src", "new.js"));
  });
});
