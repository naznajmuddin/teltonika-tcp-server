/**
 * Reprocesses tracker_packets_raw rows.
 *
 * Default mode: only rows where parsed = false. Safe to run repeatedly.
 *
 * --all: re-parse every raw row (e.g. after a parser change such as Phase 2.5
 *        IO capture). Existing tracker_positions rows for each raw packet are
 *        deleted before re-insert, so position counts stay consistent.
 *
 * Usage:
 *   npx tsx src/reprocess.ts          # only unparsed
 *   npx tsx src/reprocess.ts --all    # full backfill
 */

import "dotenv/config";
import { supabase, savePositions, deletePositionsForRaw } from "./db.js";
import { parseAvlPacket } from "./teltonika.js";

async function reprocess() {
  const reparseAll = process.argv.includes("--all");

  console.log(`[*] Fetching ${reparseAll ? "all" : "unparsed"} packets...`);

  let query = supabase
    .from("tracker_packets_raw")
    .select("id, imei, packet_hex")
    .order("id", { ascending: true });

  if (!reparseAll) query = query.eq("parsed", false);

  const { data: rows, error } = await query;

  if (error) throw new Error(`Fetch failed: ${error.message}`);
  if (!rows || rows.length === 0) {
    console.log("[✓] No packets to process.");
    return;
  }

  console.log(`[*] Found ${rows.length} packet(s). Processing...\n`);

  let ok = 0;
  let failed = 0;

  for (const row of rows) {
    try {
      const buf = Buffer.from(row.packet_hex, "hex");
      const records = parseAvlPacket(buf);

      if (reparseAll) await deletePositionsForRaw(row.id);
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
