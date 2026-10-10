// The laptop stack's full-stack cases (F-175, F-178): TP-15.3 (pg_hba from each container), TP-15.22
// (I1, I2) (a real install and restores) and TP-15.28 (I) (secret ownership seen from containers).
// They need all three images built, F-191 (budmonctl), budmon-local, real sudo and both Compose
// projects up, and the LLD doesn't say which CI job runs them or with what time budget; they're
// listed here so the gap is visible, and get written once the planner names the job.
import { describe, it } from "vitest";

describe("TP-15.3: pg_hba.conf on the laptop (F-175)", () => {
  it.todo("TP-15.3: budmon_capture from worker-capture over verify-full to db.budmon.internal: ok");
  it.todo("TP-15.3: budmon_capture with sslmode=disable: rejected");
  it.todo("TP-15.3: budmon_app from worker-capture's address: rejected");
  it.todo("TP-15.3: budmon_admin over TCP from api: rejected");
  it.todo("TP-15.3: budmon_capture from api's data address: rejected");
  it.todo("TP-15.3: budmon_migrator to budmon_restore from the data network: ok");
  it.todo("TP-15.3: budmon_app to budmon_restore: rejected");
});

describe("TP-15.22 (I): install and restore on a real runner (F-178)", () => {
  it.todo("TP-15.22 (I1): a full install, then restore of a dump of a seeded database");
  it.todo("TP-15.22 (I2): restores of a truncated and of a failing dump leave budmon untouched");
});

describe("TP-15.28 (I): secret set with real sudo (F-178)", () => {
  it.todo("TP-15.28 (I): CURSOR_KEY owned by 10001 mode 0400, readable as 10001, denied as 10002");
});
