import { serveLocalApi } from "./server.js";

const server = await serveLocalApi();

if (typeof server === "object" && server !== null && "port" in server && typeof server.port === "number") {
  console.log(`Kairos local API listening on http://127.0.0.1:${server.port}`);
}
