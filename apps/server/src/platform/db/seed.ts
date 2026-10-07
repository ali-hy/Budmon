// F-23: the seed framework. Each seeder is idempotent.
import type { WorkerContainer } from "../container.js";

export interface Seeder {
  name: string;
  run(c: WorkerContainer): Promise<void>;
}

/** The platform's seeders. `platform.fx-rates` arrives with S-9. */
export const seeders: Seeder[] = [];

export async function runSeeders(
  c: WorkerContainer,
  list: readonly Seeder[] = seeders,
): Promise<void> {
  for (const seeder of list) {
    await seeder.run(c);
  }
}
