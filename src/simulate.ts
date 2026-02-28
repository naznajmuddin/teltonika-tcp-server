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
        const avl = Buffer.from(AVL_SAMPLE_HEX, "hex");
        console.log(`[→] Sending AVL packet (${avl.length} bytes)`);
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
