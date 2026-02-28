/**
 * Teltonika Codec 8 TCP packet structure:
 *
 * IMEI packet (device → server):
 *   [2 bytes] IMEI length (big-endian uint16)
 *   [N bytes] IMEI string (ASCII digits)
 *
 * AVL data packet (device → server):
 *   [4 bytes] preamble (0x00000000)
 *   [4 bytes] data field length (big-endian uint32)
 *   [1 byte]  codec ID (0x08 = Codec8, 0x8E = Codec8 Extended)
 *   [1 byte]  number of data (record count)
 *   [...    ] AVL records
 *   [1 byte]  number of data (same as above, repeated)
 *   [4 bytes] CRC-16 checksum
 *
 * Server ACK after IMEI:    0x01 (1 byte, accept) or 0x00 (reject)
 * Server ACK after AVL data: record count as big-endian uint32 (4 bytes)
 */

export function parseImeiPacket(buf: Buffer): string | null {
  if (buf.length < 2) return null;

  const len = buf.readUInt16BE(0);
  if (buf.length < 2 + len) return null;

  const imei = buf.subarray(2, 2 + len).toString("ascii");

  // IMEI is 15–17 digits
  if (!/^\d{15,17}$/.test(imei)) return null;

  return imei;
}

export function extractAvlRecordCount(buf: Buffer): number {
  // preamble (4) + data length (4) + codec (1) + numberOfData (1) = byte index 9
  if (buf.length < 10) return 0;
  return buf.readUInt8(9);
}

export function buildAck(recordCount: number): Buffer {
  const ack = Buffer.alloc(4);
  ack.writeUInt32BE(recordCount, 0);
  return ack;
}
