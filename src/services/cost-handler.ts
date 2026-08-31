/**
 * Serves the NoteSnap services-cost spreadsheet as a downloadable CSV.
 *
 * The CSV content is the owner-confirmed services cost breakdown (08-31),
 * embedded in src/services/notesnap-services-cost.ts (generated from
 * /home/team/shared/notesnap-services-cost.csv). Serving it from a route (not a
 * raw public/ file) lets us pin the exact Content-Type and force a download via
 * Content-Disposition, independent of the static filesystem handler.
 */
import { servicesCostCsv } from "./notesnap-services-cost";

const FILENAME = "notesnap-services-cost.csv";

export async function handleCost(): Promise<Response> {
  return new Response(servicesCostCsv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${FILENAME}"`,
      "Cache-Control": "no-store",
    },
  });
}
