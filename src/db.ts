import { createClient } from "@supabase/supabase-js";
import type { AvlRecord } from "./teltonika.js";

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment");
}

export const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

export async function upsertDevice(imei: string): Promise<void> {
  const { error } = await supabase
    .from("tracker_devices")
    .upsert({ imei }, { onConflict: "imei", ignoreDuplicates: true });

  if (error) throw new Error(`upsertDevice: ${error.message}`);
}

export async function updateDeviceStatus(
  imei: string,
  status: "online" | "offline"
): Promise<void> {
  const { error } = await supabase
    .from("tracker_devices")
    .update({ status, last_seen_at: new Date().toISOString() })
    .eq("imei", imei);

  if (error) throw new Error(`updateDeviceStatus: ${error.message}`);
}

export async function saveRawPacket(
  imei: string,
  remoteIp: string | undefined,
  buf: Buffer
): Promise<number> {
  const { data, error } = await supabase
    .from("tracker_packets_raw")
    .insert({
      imei,
      remote_ip: remoteIp ?? null,
      packet_hex: buf.toString("hex"),
      packet_len: buf.length,
    })
    .select("id")
    .single();

  if (error) throw new Error(`saveRawPacket: ${error.message}`);
  return data.id as number;
}

export async function savePositions(
  imei: string,
  records: AvlRecord[],
  rawPacketId: number
): Promise<void> {
  if (records.length === 0) return;

  const rows = records.map((r) => ({
    imei,
    gps_time: r.timestamp.toISOString(),
    latitude: r.latitude,
    longitude: r.longitude,
    speed: r.speed,
    angle: r.angle,
    satellites: r.satellites,
    altitude: r.altitude,
    priority: r.priority,
    raw_packet_id: rawPacketId,
  }));

  const { error: posError } = await supabase.from("tracker_positions").insert(rows);
  if (posError) throw new Error(`savePositions: ${posError.message}`);

  // Mark the raw packet as successfully parsed
  const { error: markError } = await supabase
    .from("tracker_packets_raw")
    .update({ parsed: true })
    .eq("id", rawPacketId);

  if (markError) throw new Error(`markParsed: ${markError.message}`);
}
