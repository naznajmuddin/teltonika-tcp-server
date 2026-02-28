import { createClient } from "@supabase/supabase-js";

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
