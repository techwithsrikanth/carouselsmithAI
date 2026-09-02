import { createApp } from "../src/server/index.js";

// Built once per serverless instance and reused across invocations on that instance.
const ready = createApp().then(({ app }) => app);

export default async function handler(req, res) {
  const app = await ready;
  return app(req, res);
}
