import ENV from "./env.js";
import express from "express";
import morgan from "morgan";

import { expressRouter } from "./router/index.js";
import { errorHandler } from "./errors/index.js";

const app = express();

app.use(express.json());

// Setup express app
app.use(
  morgan("short", {
    stream: process.stdout,
  }),
);

// Add endpoints
app.use("/", expressRouter);

app.use(errorHandler);

async function main() {
  app.listen(ENV.PORT, (e) => {
    if (e) {
      console.error(e);
      return;
    }

    console.log(`Node app listening on http://localhost:${ENV.PORT}`);
  });
}

main();
