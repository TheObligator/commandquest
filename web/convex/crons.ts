import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Tables everyone walked away from without leaving (closed the tab) are closed (convex/tables.ts).
crons.interval("close idle tables", { hours: 1 }, internal.tables.cleanup, {});

export default crons;
