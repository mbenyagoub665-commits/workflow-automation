import tanstackEntry from "@tanstack/react-start/server-entry";
import { everyApp } from "@every-app/sdk/server";
import { tick } from "./server/engine";

// everyApp() verifies the identity the Gateway sent before any request reaches
// the app (a request from anywhere else is a 401). The minute cron fires due
// schedules, resumes finished waits and deletes runs older than 30 days.
export default {
  ...everyApp<Env>(async (request) => tanstackEntry.fetch(request)),
  async scheduled(_controller: ScheduledController, _env: Env, _ctx: ExecutionContext) {
    await tick();
  },
};
