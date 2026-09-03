/**
 * The HTTP surface of the MCP endpoint.
 *
 * The property that matters here is a cost property, not a protocol one. This
 * transport is stateless — a fresh McpServer per request — so a standalone SSE
 * stream opened by GET can never receive a server-initiated notification: there
 * is no long-lived server to send one. But the open response keeps the
 * serverless invocation, and its provisioned memory, billable for as long as the
 * client holds the socket. The SDK's handleGetRequest opens such a stream rather
 * than declining, so the route must decline for it.
 *
 * MCP's Streamable HTTP transport explicitly permits this: a server that does
 * not offer an SSE stream at its endpoint answers GET with 405.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { GET, DELETE, POST } from "../src/app/api/mcp/route";

const url = "https://cashish.test/api/mcp";

test("GET is declined with 405, not upgraded to an SSE stream", async () => {
  const response = await GET(
    new Request(url, { method: "GET", headers: { accept: "text/event-stream" } }),
  );

  assert.equal(response.status, 405, "an SSE stream here bills wall-clock for nothing");
  assert.equal(response.headers.get("allow"), "POST");
  assert.notEqual(
    response.headers.get("content-type"),
    "text/event-stream",
    "declining must not itself open a stream",
  );
});

test("DELETE is declined with 405 — a stateless transport has no session to end", async () => {
  const response = await DELETE(new Request(url, { method: "DELETE" }));

  assert.equal(response.status, 405);
  assert.equal(response.headers.get("allow"), "POST");
});

test("declining costs nothing: no credential is resolved first", async () => {
  // Reaching resolveCredential means a database round trip per rejected GET,
  // and rejected GETs arrive in reconnect loops. An unauthenticated GET must
  // still be 405 rather than 401 — proof the method check runs first.
  const response = await GET(new Request(url, { method: "GET" }));

  assert.equal(response.status, 405, "expected the method check to precede auth");
});

test("POST is still served — the fix must not close the endpoint", async () => {
  const response = await POST(
    new Request(url, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
    }),
  );

  assert.notEqual(response.status, 405, "POST must not be caught by the method rejection");
});
