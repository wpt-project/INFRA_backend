import "dotenv/config";
import { dashboardLogin } from "../src/auth/dashboard.js";

dashboardLogin({ email: "samson@wpt.internal", password: "Admin@123" })
  .then((r) => console.log("RESULT:", JSON.stringify(r, null, 2)))
  .catch((e) => {
    console.error("LOGIN ERROR:", e);
    process.exit(1);
  });
