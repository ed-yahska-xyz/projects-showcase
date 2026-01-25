#!/usr/bin/env bun

const port = process.argv[2] || 8080;

Bun.serve({
  port,
  async fetch(req) {
    const url = new URL(req.url);
    let path = url.pathname;

    // Default to index.html for directories
    if (path.endsWith("/")) {
      path += "index.html";
    }

    const filePath = "." + path;
    const file = Bun.file(filePath);

    if (await file.exists()) {
      return new Response(file);
    }

    return new Response("Not Found", { status: 404 });
  },
});

console.log(`Serving projects at http://localhost:${port}/`);
console.log(`Example: http://localhost:${port}/boids/`);
