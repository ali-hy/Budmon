import "dotenv/config";
import express from "express";
import morgan from "morgan";
import { env_schema } from "./validation/env.js";
export const ENV = env_schema.parse(process.env);
const app = express();
const router = express.Router();
app.use(morgan("tiny"));
router.get("/", (req, res) => {
    res.send("Hello world!");
});
app.use("/", router);
app.listen(ENV.PORT, (e) => {
    console.log("ENV: ", ENV);
    console.log(`Node app listening on http://localhost:${ENV.PORT}`);
});
//# sourceMappingURL=index.js.map