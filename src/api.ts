import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { supabase } from "./db.js";

const app = new Hono();

app.use("*", async (c, next) => {
  c.header("Access-Control-Allow-Origin", "*");
  c.header("Access-Control-Allow-Methods", "GET, PATCH, OPTIONS");
  c.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (c.req.method === "OPTIONS") return new Response(null, { status: 204 });
  await next();
});

// ── Health ────────────────────────────────────────────────────────────────────

app.get("/health", (c) => c.json({ status: "ok" }));

// ── Fleet ─────────────────────────────────────────────────────────────────────

/**
 * GET /fleet/latest
 * Returns every device with its single most-recent position (or null).
 * Used by the dashboard overview to show all vehicles on the map at once.
 */
app.get("/fleet/latest", async (c) => {
  const { data: devices, error: devErr } = await supabase
    .from("tracker_devices")
    .select("imei, label, status, last_seen_at")
    .order("last_seen_at", { ascending: false });

  if (devErr) return c.json({ error: devErr.message }, 500);

  const fleet = await Promise.all(
    (devices ?? []).map(async (d) => {
      const { data: pos } = await supabase
        .from("tracker_positions")
        .select("*")
        .eq("imei", d.imei)
        .order("gps_time", { ascending: false })
        .limit(1)
        .single();

      return { ...d, position: pos ?? null };
    })
  );

  return c.json(fleet);
});

// ── Devices ───────────────────────────────────────────────────────────────────

/**
 * GET /devices
 * List all known devices with their current connection status.
 */
app.get("/devices", async (c) => {
  const { data, error } = await supabase
    .from("tracker_devices")
    .select("imei, label, status, last_seen_at, created_at")
    .order("last_seen_at", { ascending: false });

  if (error) return c.json({ error: error.message }, 500);
  return c.json(data);
});

/**
 * GET /devices/:imei
 * Single device details.
 */
app.get("/devices/:imei", async (c) => {
  const imei = c.req.param("imei");

  const { data, error } = await supabase
    .from("tracker_devices")
    .select("imei, label, status, last_seen_at, created_at")
    .eq("imei", imei)
    .single();

  if (error) return c.json({ error: "Device not found" }, 404);
  return c.json(data);
});

/**
 * PATCH /devices/:imei
 * Update label or other editable fields.
 */
app.patch("/devices/:imei", async (c) => {
  const imei = c.req.param("imei");
  const { label } = await c.req.json<{ label?: string }>();

  const { error } = await supabase
    .from("tracker_devices")
    .update({ label: label ?? null })
    .eq("imei", imei);

  if (error) return c.json({ error: error.message }, 500);
  return c.json({ success: true });
});

// ── Positions ─────────────────────────────────────────────────────────────────

/**
 * GET /devices/:imei/positions
 * Paginated position history. Newest first.
 *
 * Query params:
 *   limit  – max rows to return (default 100, max 1000)
 *   from   – ISO 8601 timestamp, filter gps_time >= from
 *   to     – ISO 8601 timestamp, filter gps_time <= to
 */
app.get("/devices/:imei/positions", async (c) => {
  const imei = c.req.param("imei");
  const limitParam = Number(c.req.query("limit") ?? 100);
  const from = c.req.query("from");
  const to = c.req.query("to");

  let query = supabase
    .from("tracker_positions")
    .select("*")
    .eq("imei", imei)
    .order("gps_time", { ascending: false });

  // limit=0 means no limit (returns all rows up to Supabase's max)
  if (limitParam > 0) query = query.limit(Math.min(limitParam, 10_000));

  if (from) query = query.gte("gps_time", from);
  if (to) query = query.lte("gps_time", to);

  const { data, error } = await query;
  if (error) return c.json({ error: error.message }, 500);
  return c.json(data);
});

/**
 * GET /devices/:imei/positions/latest
 * The single most recent position for a device.
 */
app.get("/devices/:imei/positions/latest", async (c) => {
  const imei = c.req.param("imei");

  const { data, error } = await supabase
    .from("tracker_positions")
    .select("*")
    .eq("imei", imei)
    .order("gps_time", { ascending: false })
    .limit(1)
    .single();

  if (error) return c.json({ error: "No positions found" }, 404);
  return c.json(data);
});

// ── Sensors ───────────────────────────────────────────────────────────────────

/**
 * GET /devices/:imei/sensors/:field
 * Time series for one IO field. `field` can be either a promoted column
 * (e.g. `external_voltage_v`, `ignition`) or a JSONB key inside `io_data`
 * (e.g. `ble_temp_1`, `dallas_temp_1`).
 *
 * Returns [{ gps_time, value }] newest-first.
 *
 * Query params: limit (default 500, max 10_000), from, to.
 */
const PROMOTED_COLUMNS = new Set([
  "ignition", "movement", "gsm_signal", "sleep_mode", "gnss_status",
  "gnss_pdop", "gnss_hdop", "external_voltage_v", "battery_voltage_v",
  "battery_current_ma", "battery_level_pct", "total_odometer_m",
  "trip_odometer_m", "dout1", "dout2", "din1", "din2", "din3", "din4",
  "ain1", "gsm_operator", "eco_score", "green_driving_type", "over_speeding",
  "crash_detection", "jamming", "bt_status", "event_io_id",
]);

app.get("/devices/:imei/sensors/:field", async (c) => {
  const imei = c.req.param("imei");
  const field = c.req.param("field");
  const limitParam = Math.min(Math.max(Number(c.req.query("limit") ?? 500), 1), 10_000);
  const from = c.req.query("from");
  const to = c.req.query("to");

  const isPromoted = PROMOTED_COLUMNS.has(field);
  const selector = isPromoted ? `gps_time, value:${field}` : `gps_time, io_data`;

  let query = supabase
    .from("tracker_positions")
    .select(selector)
    .eq("imei", imei)
    .order("gps_time", { ascending: false })
    .limit(limitParam);

  if (from) query = query.gte("gps_time", from);
  if (to)   query = query.lte("gps_time", to);

  const { data, error } = await query;
  if (error) return c.json({ error: error.message }, 500);

  const series = isPromoted
    ? (data ?? [])
    : (data ?? [])
        .map((row: any) => ({
          gps_time: row.gps_time,
          value: row.io_data?.[field] ?? null,
        }))
        .filter((row) => row.value !== null);

  return c.json(series);
});

/**
 * GET /devices/:imei/io-keys
 * Distinct set of io_data JSONB keys this device has emitted across its most
 * recent 1000 records. Used to populate a frontend sensor picker.
 */
app.get("/devices/:imei/io-keys", async (c) => {
  const imei = c.req.param("imei");

  const { data, error } = await supabase
    .from("tracker_positions")
    .select("io_data")
    .eq("imei", imei)
    .order("gps_time", { ascending: false })
    .limit(1000);

  if (error) return c.json({ error: error.message }, 500);

  const keys = new Set<string>();
  for (const row of data ?? []) {
    const io = (row as { io_data: Record<string, unknown> | null }).io_data;
    if (io) for (const k of Object.keys(io)) keys.add(k);
  }

  return c.json([...keys].sort());
});

// ── Start ─────────────────────────────────────────────────────────────────────

const HTTP_PORT = Number(process.env.HTTP_PORT || 3000);

serve({ fetch: app.fetch, port: HTTP_PORT, hostname: "0.0.0.0" }, () => {
  console.log(`[*] HTTP API listening on port ${HTTP_PORT}`);
});
