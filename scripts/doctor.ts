import { inspectConfiguration } from "../src/lib/readiness";

const result = inspectConfiguration();
console.log(JSON.stringify({ application: "TruthGraph", ...result }, null, 2));
console.log(result.configured ? "Configuration present. Run the live acceptance check; credentials have not been authenticated yet." : "Live activation is blocked by the settings listed above. No credential values were printed.");
if (!result.configured && !process.argv.includes("--report-only")) process.exitCode = 1;