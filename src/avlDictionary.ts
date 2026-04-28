/**
 * Teltonika AVL ID dictionary — focused on FMC920 firmware capabilities.
 *
 * Each entry tells the parser how to interpret a raw IO value (signed/unsigned,
 * scale factor, boolean conversion) and tells the DB layer which IDs to lift
 * into named columns on tracker_positions.
 *
 * Reference: https://wiki.teltonika-gps.com/view/FMC920_Teltonika_Data_Sending_Parameters_ID
 *
 * Anything not in this dictionary is still captured — the parser falls back to
 * key "avl_<id>" with the raw integer value, so unknown IOs are never dropped.
 */

export type AvlMeta = {
  name: string;
  signed?: boolean;
  scale?: number;
  boolean?: boolean;
  promoteAs?: string;
  unit?: string;
};

export const AVL_DICT: Record<number, AvlMeta> = {
  // ── Digital I/O ──────────────────────────────────────────────────────────
  1:   { name: "din1",  boolean: true, promoteAs: "din1" },
  2:   { name: "din2",  boolean: true, promoteAs: "din2" },
  3:   { name: "din3",  boolean: true, promoteAs: "din3" },
  4:   { name: "din4",  boolean: true, promoteAs: "din4" },
  179: { name: "dout1", boolean: true, promoteAs: "dout1" },
  180: { name: "dout2", boolean: true, promoteAs: "dout2" },

  // ── Analog inputs (mV) ───────────────────────────────────────────────────
  9:   { name: "ain1", promoteAs: "ain1", unit: "mV" },
  10:  { name: "ain2", unit: "mV" },
  11:  { name: "ain3", unit: "mV" },
  245: { name: "ain4", unit: "mV" },

  // ── Power / battery ──────────────────────────────────────────────────────
  66:  { name: "external_voltage", scale: 0.001, promoteAs: "external_voltage_v", unit: "V" },
  67:  { name: "battery_voltage",  scale: 0.001, promoteAs: "battery_voltage_v",  unit: "V" },
  68:  { name: "battery_current", promoteAs: "battery_current_ma", unit: "mA" },
  113: { name: "battery_level",   promoteAs: "battery_level_pct",  unit: "%" },

  // ── GSM / network ────────────────────────────────────────────────────────
  21:  { name: "gsm_signal", promoteAs: "gsm_signal" },
  241: { name: "active_gsm_operator", promoteAs: "gsm_operator" },
  205: { name: "gsm_cell_id" },
  206: { name: "gsm_area_code" },
  238: { name: "user_id" },

  // ── GNSS quality ─────────────────────────────────────────────────────────
  69:  { name: "gnss_status",  promoteAs: "gnss_status" },
  181: { name: "gnss_pdop", scale: 0.1, promoteAs: "gnss_pdop" },
  182: { name: "gnss_hdop", scale: 0.1, promoteAs: "gnss_hdop" },

  // ── Movement / motion ────────────────────────────────────────────────────
  239: { name: "ignition", boolean: true, promoteAs: "ignition" },
  240: { name: "movement", boolean: true, promoteAs: "movement" },
  80:  { name: "data_mode" },
  200: { name: "sleep_mode", promoteAs: "sleep_mode" },
  255: { name: "over_speeding", promoteAs: "over_speeding" },

  // ── Odometer / trip ──────────────────────────────────────────────────────
  16:  { name: "total_odometer", promoteAs: "total_odometer_m", unit: "m" },
  199: { name: "trip_odometer",  promoteAs: "trip_odometer_m",  unit: "m" },
  24:  { name: "speed_io", unit: "km/h" },

  // ── Eco / safety ─────────────────────────────────────────────────────────
  247: { name: "crash_detection", promoteAs: "crash_detection" },
  252: { name: "jamming",         promoteAs: "jamming" },
  253: { name: "green_driving_type",  promoteAs: "green_driving_type" },
  254: { name: "green_driving_value" },
  258: { name: "eco_score", promoteAs: "eco_score" },

  // ── Bluetooth / BLE sensors (raw — semantic decoding is sensor-specific) ─
  263: { name: "bt_status", promoteAs: "bt_status" },
  264: { name: "barcode_id" },

  // BLE temperature / humidity / battery — values carry sign and 0.01 scale
  // for temperature on most BLE sensors, but the FMC920 emits them as raw
  // 16-bit ints; we leave scaling to the consumer.
  25:  { name: "ble_temp_1", signed: true },
  26:  { name: "ble_temp_2", signed: true },
  27:  { name: "ble_temp_3", signed: true },
  28:  { name: "ble_temp_4", signed: true },
  86:  { name: "ble_humidity_1" },
  104: { name: "ble_humidity_2" },
  106: { name: "ble_humidity_3" },
  108: { name: "ble_humidity_4" },

  // ── iButton / RFID / driver ID ───────────────────────────────────────────
  78:  { name: "ibutton" },
  207: { name: "rfid" },

  // ── Misc FMC920 specifics ────────────────────────────────────────────────
  17:  { name: "axis_x", signed: true },
  18:  { name: "axis_y", signed: true },
  19:  { name: "axis_z", signed: true },
  72:  { name: "dallas_temp_1", signed: true },
  73:  { name: "dallas_temp_2", signed: true },
  74:  { name: "dallas_temp_3", signed: true },
  75:  { name: "dallas_temp_4", signed: true },

  // ── Variable-length (Codec 8 Extended only) ──────────────────────────────
  237: { name: "network_type" },
  256: { name: "vin" },
  257: { name: "crash_trace_data" },
  636: { name: "umts_lte_cell_id" },
};

/**
 * Returns the metadata for a known AVL ID, or a synthesized fallback so the
 * parser/DB layer can treat known and unknown IDs uniformly.
 */
export function metaFor(id: number): AvlMeta {
  return AVL_DICT[id] ?? { name: `avl_${id}` };
}

/**
 * Subset of dictionary entries that should be promoted to dedicated columns
 * on tracker_positions. Built once at module load.
 */
export const PROMOTED_FIELDS: Array<{ key: string; column: string }> = Object
  .values(AVL_DICT)
  .filter((m): m is AvlMeta & { promoteAs: string } => Boolean(m.promoteAs))
  .map((m) => ({ key: m.name, column: m.promoteAs }));
