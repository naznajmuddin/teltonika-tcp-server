import "dotenv/config";
import net from "node:net";
import { upsertDevice, saveRawPacket } from "./db.js";
import { parseImeiPacket, extractAvlRecordCount, buildAck } from "./teltonika.js";

const PORT = Number(process.env.PORT || 5100);

type SocketState = {
  imei: string | null;
  imeiAccepted: boolean;
};

const server = net.createServer((socket) => {
  const remote = socket.remoteAddress ?? "unknown";
  const state: SocketState = { imei: null, imeiAccepted: false };

  console.log(`[+] Connection from ${remote}`);

  socket.on("data", async (buf: Buffer) => {
    try {
      // ── Phase 1: IMEI handshake ─────────────────────────────────────────
      if (!state.imeiAccepted) {
        const imei = parseImeiPacket(buf);

        if (!imei) {
          console.warn(`[!] Bad IMEI packet from ${remote}, rejecting`);
          socket.write(Buffer.from([0x00]));
          socket.destroy();
          return;
        }

        state.imei = imei;
        state.imeiAccepted = true;

        await upsertDevice(imei);

        socket.write(Buffer.from([0x01])); // accept
        console.log(`[✓] IMEI accepted: ${imei} (${remote})`);
        return;
      }

      // ── Phase 2: AVL data packet ────────────────────────────────────────
      if (!state.imei) {
        socket.destroy();
        return;
      }

      const rawPacketId = await saveRawPacket(state.imei, remote, buf);
      const recordCount = extractAvlRecordCount(buf);
      const ack = buildAck(recordCount);

      socket.write(ack);

      console.log(
        `[✓] Packet saved — IMEI: ${state.imei}, records: ${recordCount}, raw_id: ${rawPacketId}`
      );
    } catch (err) {
      console.error(`[✗] Error handling data from ${remote}:`, err);
      socket.destroy();
    }
  });

  socket.on("end", () => {
    console.log(`[-] Disconnected: ${state.imei ?? remote}`);
  });

  socket.on("error", (err) => {
    console.error(`[✗] Socket error (${state.imei ?? remote}):`, err.message);
  });
});

server.on("error", (err) => {
  console.error("[✗] Server error:", err);
  process.exit(1);
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`[*] Teltonika TCP server listening on port ${PORT}`);
});
