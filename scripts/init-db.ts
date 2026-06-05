// Serially initialise the SQLite file (schema + seed) before anything that runs
// in parallel touches it — notably `next build`, which collects page data
// across multiple worker processes. Run automatically via the npm `prebuild`
// lifecycle hook. Importing the client performs the init as a side effect.
import "../src/db/client";

// eslint-disable-next-line no-console
console.log("cashish: database initialised.");
