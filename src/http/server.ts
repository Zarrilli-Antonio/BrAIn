import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { exec } from "node:child_process";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { makeTools } from "../core/tools.js";
import { watchDocs } from "../core/docs.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Plain REST connector for AI platforms without MCP support, plus static GUI explorer.
 *  Returns the listening server (port 0 lets the OS pick a free one — used by tests) so a
 *  caller can inspect the actual bound port or close it; index.ts's own call ignores it. */
export function runHttp(root: string, port = 4173, open = false): Promise<Server> {
  const tools = makeTools(root);
  const app = express();
  app.use(express.json());

  const sseClients = new Set<express.Response>();
  let debounce: NodeJS.Timeout | null = null;
  const stopWatchingDocs = watchDocs(root, () => {
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(() => {
      for (const client of sseClients) client.write("data: docs-changed\n\n");
    }, 150);
  });

  app.get("/api/events", (req, res) => {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    res.write("\n");
    sseClients.add(res);
    req.on("close", () => sseClients.delete(res));
  });

  app.get("/api/files", (req, res) => {
    try {
      res.json(tools.listFiles(String(req.query.subpath ?? ".")));
    } catch (e) {
      res.status(400).json({ error: String((e as Error).message) });
    }
  });

  app.get("/api/file", (req, res) => {
    try {
      const start = req.query.start ? Number(req.query.start) : undefined;
      const end = req.query.end ? Number(req.query.end) : undefined;
      res.type("text/plain").send(tools.readFile(String(req.query.path), start, end));
    } catch (e) {
      res.status(400).json({ error: String((e as Error).message) });
    }
  });

  app.post("/api/files/batch", (req, res) => {
    try {
      res.json(tools.readFiles((req.body.paths as unknown[]).map(String)));
    } catch (e) {
      res.status(400).json({ error: String((e as Error).message) });
    }
  });

  app.post("/api/file", (req, res) => {
    try {
      res.json(tools.writeFile(String(req.body.path), String(req.body.content)));
    } catch (e) {
      res.status(400).json({ error: String((e as Error).message) });
    }
  });

  app.post("/api/file/edit", (req, res) => {
    try {
      res.json(tools.editFile(String(req.body.path), String(req.body.oldString), String(req.body.newString), Boolean(req.body.replaceAll)));
    } catch (e) {
      res.status(400).json({ error: String((e as Error).message) });
    }
  });

  app.post("/api/file/create", (req, res) => {
    try {
      res.json(tools.createFile(String(req.body.path), String(req.body.content ?? "")));
    } catch (e) {
      res.status(400).json({ error: String((e as Error).message) });
    }
  });

  app.post("/api/folder", (req, res) => {
    try {
      res.json(tools.createFolder(String(req.body.path)));
    } catch (e) {
      res.status(400).json({ error: String((e as Error).message) });
    }
  });

  app.post("/api/rename", (req, res) => {
    try {
      res.json(tools.renamePath(String(req.body.oldPath), String(req.body.newPath)));
    } catch (e) {
      res.status(400).json({ error: String((e as Error).message) });
    }
  });

  app.post("/api/delete", (req, res) => {
    try {
      res.json(tools.deletePath(String(req.body.path)));
    } catch (e) {
      res.status(400).json({ error: String((e as Error).message) });
    }
  });

  app.get("/api/symbols", (req, res) => {
    try {
      res.json(tools.getSymbols(String(req.query.path)));
    } catch (e) {
      res.status(400).json({ error: String((e as Error).message) });
    }
  });

  app.get("/api/references", (req, res) => {
    try {
      res.json(tools.findReferences(String(req.query.path), Number(req.query.line), String(req.query.symbolName)));
    } catch (e) {
      res.status(400).json({ error: String((e as Error).message) });
    }
  });

  app.get("/api/definition", (req, res) => {
    try {
      res.json(tools.findDefinition(String(req.query.path), Number(req.query.line), String(req.query.symbolName)));
    } catch (e) {
      res.status(400).json({ error: String((e as Error).message) });
    }
  });

  app.get("/api/search", (req, res) => {
    try {
      res.json(tools.searchCode(String(req.query.q ?? ""), req.query.regex === "true", {
        pathPrefix: req.query.pathPrefix ? String(req.query.pathPrefix) : undefined,
        contextBefore: req.query.contextBefore ? Number(req.query.contextBefore) : undefined,
        contextAfter: req.query.contextAfter ? Number(req.query.contextAfter) : undefined,
        limit: req.query.limit ? Number(req.query.limit) : undefined,
      }));
    } catch (e) {
      res.status(400).json({ error: String((e as Error).message) });
    }
  });

  app.get("/api/index", (_req, res) => {
    res.json(tools.getIndexStatus());
  });

  app.get("/api/mcp-log", (req, res) => {
    res.json(tools.getMcpLog(req.query.limit ? Number(req.query.limit) : undefined));
  });

  app.get("/api/docs", (_req, res) => {
    res.json(tools.listDocs());
  });

  app.get("/api/docs/search", (req, res) => {
    res.json(tools.searchDocs(String(req.query.q ?? "")));
  });

  app.get("/api/docs/graph", (_req, res) => {
    res.json(tools.docsGraph());
  });

  app.get("/api/doc", (req, res) => {
    try {
      res.type("text/plain").send(tools.readDoc(String(req.query.path)));
    } catch (e) {
      res.status(400).json({ error: String((e as Error).message) });
    }
  });

  app.post("/api/doc", (req, res) => {
    try {
      res.json(tools.writeDoc(String(req.body.path), String(req.body.content)));
    } catch (e) {
      res.status(400).json({ error: String((e as Error).message) });
    }
  });

  app.delete("/api/doc", (req, res) => {
    try {
      res.json(tools.deleteDoc(String(req.query.path)));
    } catch (e) {
      res.status(400).json({ error: String((e as Error).message) });
    }
  });

  app.post("/api/doc/rename", (req, res) => {
    try {
      res.json(tools.renameDoc(String(req.body.oldPath), String(req.body.newPath)));
    } catch (e) {
      res.status(400).json({ error: String((e as Error).message) });
    }
  });

  app.use(express.static(path.join(__dirname, "..", "..", "public")));

  // Ports collide when several BrAIn instances run at once (one per project) — bump to the next free one instead of crashing.
  return listen(app, port, open, root).then((server) => {
    // Without this, closing the server (tests, or a graceful shutdown) leaves the docs fs.watch
    // handle open, which keeps the event loop alive indefinitely.
    server.on("close", () => {
      if (debounce) clearTimeout(debounce);
      stopWatchingDocs();
    });
    return server;
  });
}

function listen(app: express.Express, port: number, open: boolean, root: string, attemptsLeft = 20): Promise<Server> {
  return new Promise((resolve, reject) => {
    const server = app.listen(port, () => {
      const actualPort = (server.address() as AddressInfo).port;
      const url = `http://localhost:${actualPort}`;
      console.log(`BrAIn HTTP connector + GUI at ${url} (root: ${root})`);
      if (open) openBrowser(url);
      resolve(server);
    });
    server.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "EADDRINUSE" && port !== 0 && attemptsLeft > 0) {
        resolve(listen(app, port + 1, open, root, attemptsLeft - 1));
      } else {
        reject(err);
      }
    });
  });
}

function openBrowser(url: string): void {
  const cmd =
    process.platform === "win32" ? `start "" "${url}"` : process.platform === "darwin" ? `open "${url}"` : `xdg-open "${url}"`;
  exec(cmd);
}
