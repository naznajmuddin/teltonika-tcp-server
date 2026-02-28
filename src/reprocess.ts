/**
 * Reprocesses all tracker_packets_raw rows where parsed = false.
 * Safe to run multiple times — skips anything already marked parsed.
 *
 * Usage:
 *   npx tsx src/reprocess.ts
 */

import "dotenv/config";
import { supabase, savePositions } from "./db.js";
import { parseAvlPacket } from "./teltonika.js";

async function reprocess() {
  console.log("[*] Fetching unparsed packets...");

  const { data: rows, error } = await supabase
    .from("tracker_packets_raw")
    .select("id, imei, packet_hex")
    .eq("parsed", false)
    .order("id", { ascending: true });

  if (error) throw new Error(`Fetch failed: ${error.message}`);
  if (!rows || rows.length === 0) {
    console.log("[✓] No unparsed packets found.");
    return;
  }

  console.log(`[*] Found ${rows.length} unparsed packet(s). Processing...\n`);

  let ok = 0;
  let failed = 0;

  for (const row of rows) {
    try {
      const buf = Buffer.from(row.packet_hex, "hex");
      const records = parseAvlPacket(buf);

      await savePositions(row.imei, records, row.id);

      console.log(`[✓] raw_id ${row.id} — IMEI: ${row.imei}, positions: ${records.length}`);
      ok++;
    } catch (err) {
      console.error(`[✗] raw_id ${row.id} — failed:`, (err as Error).message);
      failed++;
    }
  }

  console.log(`\n[*] Done — ${ok} succeeded, ${failed} failed.`);
}

reprocess().catch((err) => {
  console.error("[✗] Fatal:", err.message);
  process.exit(1);
});
