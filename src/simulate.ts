/**
 * Simulates a Teltonika FMC920 device connecting over TCP.
 *
 * Flow:
 *   1. Send IMEI packet       (2-byte length + ASCII IMEI)
 *   2. Receive 0x01 accept
 *   3. Send Codec 8 AVL data  (real sample from Teltonika docs)
 *   4. Receive 4-byte ACK     (record count)
 */

import net from "node:net";

const HOST = process.env.SIM_HOST ?? "127.0.0.1";
const PORT = Number(process.env.SIM_PORT ?? 5555);
const IMEI = "356307046452013"; // 15-digit test IMEI

// ── Codec 8 sample packet from Teltonika documentation ───────────────────────
// 1 AVL record: lat/lng near Vilnius, speed 0, 8 satellites
// Source: https://wiki.teltonika-networks.com/view/Codec#Codec_8
const AVL_SAMPLE_HEX =
  "000000000000003608010000016B40D8EA30010000000000000000000000000000000105021503010101425E0F01F10000601A014E0000000000000000010000C7CF";

/**
 * Build a Codec 8 Extended AVL packet covering 1/2/4/8-byte and variable-
 * length IOs. CRC is left as 0 — the server doesn't validate it (only the
 * bytes it parses), so this is fine for end-to-end tests of IO capture.
 *
 * IO content per record:
 *   - 1B: ignition=1 (id 239), movement=1 (id 240), gsm_signal=4 (id 21),
 *         din1=0 (id 1), sleep_mode=2 (id 200)
 *   - 2B: external_voltage=12500mV (id 66), battery_voltage=4100mV (id 67),
 *         gnss_pdop=15 (id 181), gnss_hdop=10 (id 182)
 *   - 4B: total_odometer=123456m (id 16), trip_odometer=4321m (id 199)
 *   - 8B: ble_temp_1=2350 (id 25, signed)
 *   - var: vin (id 256) = "1HGCM82633A004352" as hex
 */
function buildCodec8ExtendedPacket(): Buffer {
  const records: Buffer[] = [];

  // GPS section (24 bytes), identical layout to Codec 8
  const gps = Buffer.alloc(24);
  let o = 0;
  // timestamp = 2024-01-01T00:00:00Z in ms
  const ts = BigInt(Date.UTC(2024, 0, 1));
  gps.writeUInt32BE(Number(ts >> 32n), o); o += 4;
  gps.writeUInt32BE(Number(ts & 0xFFFFFFFFn), o); o += 4;
  gps.writeUInt8(1, o); o += 1; // priority
  gps.writeInt32BE(Math.round(25.2797 * 1e7), o); o += 4; // lng
  gps.writeInt32BE(Math.round(54.6872 * 1e7), o); o += 4; // lat
  gps.writeInt16BE(120, o); o += 2; // altitude
  gps.writeUInt16BE(180, o); o += 2; // angle
  gps.writeUInt8(10, o); o += 1; // satellites
  gps.writeUInt16BE(45, o); o += 2; // speed

  // IO block (Codec 8E)
  const io: number[] = [];
  const u16be = (n: number) => io.push((n >> 8) & 0xff, n & 0xff);
  const u8 = (n: number) => io.push(n & 0xff);

  u16be(0);    // event IO ID
  u16be(13);   // total IO count

  // 1-byte IOs (5)
  u16be(5);
  u16be(239); u8(1);  // ignition
  u16be(240); u8(1);  // movement
  u16be(21);  u8(4);  // gsm_signal
  u16be(1);   u8(0);  // din1
  u16be(200); u8(2);  // sleep_mode

  // 2-byte IOs (4)
  u16be(4);
  u16be(66);  u16be(12500); // external_voltage_v → 12.5
  u16be(67);  u16be(4100);  // battery_voltage_v → 4.1
  u16be(181); u16be(15);    // gnss_pdop → 1.5
  u16be(182); u16be(10);    // gnss_hdop → 1.0

  // 4-byte IOs (2)
  u16be(2);
  u16be(16);  io.push(0x00, 0x01, 0xE2, 0x40); // total_odometer = 123456
  u16be(199); io.push(0x00, 0x00, 0x10, 0xE1); // trip_odometer = 4321

  // 8-byte IOs (1)
  u16be(1);
  u16be(25);  io.push(0, 0, 0, 0, 0, 0, 0x09, 0x2E); // ble_temp_1 = 2350

  // Variable-length IOs (1)
  u16be(1);
  const vin = Buffer.from("1HGCM82633A004352", "ascii");
  u16be(256); u16be(vin.length);
  for (const b of vin) io.push(b);

  records.push(Buffer.concat([gps, Buffer.from(io)]));

  // Wrap into AVL packet
  const codec = 0x8e;
  const numRecords = records.length;
  const data = Buffer.concat([
    Buffer.from([codec, numRecords]),
    ...records,
    Buffer.from([numRecords]),
  ]);

  const header = Buffer.alloc(8);
  header.writeUInt32BE(0, 0);            // preamble
  header.writeUInt32BE(data.length, 4);  // data length

  const crc = Buffer.alloc(4); // CRC = 0; server does not validate

  return Buffer.concat([header, data, crc]);
}

const USE_EXTENDED = process.env.SIM_CODEC === "8e";

function buildImeiPacket(imei: string): Buffer {
  const imeiBytes = Buffer.from(imei, "ascii");
  const packet = Buffer.alloc(2 + imeiBytes.length);
  packet.writeUInt16BE(imeiBytes.length, 0);
  imeiBytes.copy(packet, 2);
  return packet;
}

function run() {
  const socket = net.createConnection({ host: HOST, port: PORT }, () => {
    console.log(`[→] Connected to ${HOST}:${PORT}`);

    // Step 1: send IMEI
    const imeiPacket = buildImeiPacket(IMEI);
    console.log(`[→] Sending IMEI: ${IMEI} (${imeiPacket.length} bytes)`);
    socket.write(imeiPacket);
  });

  let imeiAcked = false;

  socket.on("data", (buf: Buffer) => {
    if (!imeiAcked) {
      const response = buf.readUInt8(0);
      if (response === 0x01) {
        console.log("[←] IMEI accepted (0x01)");
        imeiAcked = true;

        // Step 3: send AVL data
        const avl = USE_EXTENDED
          ? buildCodec8ExtendedPacket()
          : Buffer.from(AVL_SAMPLE_HEX, "hex");
        console.log(
          `[→] Sending ${USE_EXTENDED ? "Codec 8E" : "Codec 8"} AVL packet (${avl.length} bytes)`
        );
        socket.write(avl);
      } else {
        console.error("[✗] IMEI rejected (0x00)");
        socket.destroy();
      }
      return;
    }

    // Step 4: receive ACK
    if (buf.length >= 4) {
      const acked = buf.readUInt32BE(0);
      console.log(`[←] ACK received — server confirmed ${acked} record(s)`);
      console.log("[✓] Test passed");
    } else {
      console.warn("[!] Unexpected response:", buf.toString("hex"));
    }

    socket.end();
  });

  socket.on("end", () => console.log("[–] Connection closed"));
  socket.on("error", (err) => console.error("[✗] Error:", err.message));
}

run();
