import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { supabase } from "./db.js";

const app = new Hono();

// ── Health ────────────────────────────────────────────────────────────────────

app.get("/health", (c) => c.json({ status: "ok" }));

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
  const limit = Math.min(Number(c.req.query("limit") ?? 100), 1000);
  const from = c.req.query("from");
  const to = c.req.query("to");

  let query = supabase
    .from("tracker_positions")
    .select("id, gps_time, latitude, longitude, speed, angle, satellites, altitude, priority, raw_packet_id, created_at")
    .eq("imei", imei)
    .order("gps_time", { ascending: false })
    .limit(limit);

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
    .select("id, gps_time, latitude, longitude, speed, angle, satellites, altitude, priority, created_at")
    .eq("imei", imei)
    .order("gps_time", { ascending: false })
    .limit(1)
    .single();

  if (error) return c.json({ error: "No positions found" }, 404);
  return c.json(data);
});

// ── Start ─────────────────────────────────────────────────────────────────────

const HTTP_PORT = Number(process.env.HTTP_PORT || 3000);

serve({ fetch: app.fetch, port: HTTP_PORT }, () => {
  console.log(`[*] HTTP API listening on port ${HTTP_PORT}`);
});
