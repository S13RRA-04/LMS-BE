import http from "node:http";

const port = Number.parseInt(process.env.PORT ?? "4000", 10);
const upstream = process.env.LMS_WORKER_UPSTREAM ?? "https://cetu-lms-api.cetu.workers.dev";

const server = http.createServer(async (request, response) => {
  try {
    const target = new URL(request.url ?? "/", upstream);
    const headers = new Headers();
    for (const [name, value] of Object.entries(request.headers)) {
      if (value === undefined || name.toLowerCase() === "host") continue;
      if (Array.isArray(value)) {
        for (const item of value) headers.append(name, item);
      } else {
        headers.set(name, value);
      }
    }

    const upstreamResponse = await fetch(target, {
      method: request.method,
      headers,
      body: request.method === "GET" || request.method === "HEAD" ? undefined : request,
      duplex: "half",
      redirect: "manual"
    });

    response.statusCode = upstreamResponse.status;
    response.statusMessage = upstreamResponse.statusText;
    upstreamResponse.headers.forEach((value, name) => response.setHeader(name, value));
    if (upstreamResponse.body) {
      for await (const chunk of upstreamResponse.body) response.write(chunk);
    }
    response.end();
  } catch (error) {
    response.statusCode = 502;
    response.setHeader("content-type", "application/json; charset=utf-8");
    response.end(JSON.stringify({ error: { code: "LMS_WORKER_PROXY_FAILED", message: "Unable to reach LMS Worker upstream" } }));
    console.error(error);
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`LMS Worker proxy listening on http://127.0.0.1:${port} -> ${upstream}`);
});
