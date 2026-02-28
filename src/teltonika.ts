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
 * AVL record (Codec 8):
 *   [8 bytes] timestamp     uint64 BE, milliseconds since epoch
 *   [1 byte]  priority
 *   [4 bytes] longitude     int32 BE, divide by 1e7 → decimal degrees
 *   [4 bytes] latitude      int32 BE, divide by 1e7 → decimal degrees
 *   [2 bytes] altitude      int16 BE, metres
 *   [2 bytes] angle         uint16 BE, degrees (0 = North, clockwise)
 *   [1 byte]  satellites
 *   [2 bytes] speed         uint16 BE, km/h
 *   [N bytes] IO elements   (see skipCodec8Io)
 *
 * IO element block (Codec 8):
 *   [1 byte]  event IO ID
 *   [1 byte]  total IO count
 *   [1 byte]  N of 1-byte IOs  → [id(1) + value(1)] × N
 *   [1 byte]  N of 2-byte IOs  → [id(1) + value(2)] × N
 *   [1 byte]  N of 4-byte IOs  → [id(1) + value(4)] × N
 *   [1 byte]  N of 8-byte IOs  → [id(1) + value(8)] × N
 *
 * IO element block (Codec 8 Extended — 0x8E):
 *   GPS record fields are identical to Codec 8; only IO block differs:
 *   [2 bytes] event IO ID
 *   [2 bytes] total IO count
 *   [2 bytes] N of 1-byte IOs  → [id(2) + value(1)] × N
 *   [2 bytes] N of 2-byte IOs  → [id(2) + value(2)] × N
 *   [2 bytes] N of 4-byte IOs  → [id(2) + value(4)] × N
 *   [2 bytes] N of 8-byte IOs  → [id(2) + value(8)] × N
 *   [2 bytes] N of X-byte IOs  → [id(2) + len(2) + value(len)] × N
 *
 * Server ACK after IMEI:    0x01 (1 byte, accept) or 0x00 (reject)
 * Server ACK after AVL data: record count as big-endian uint32 (4 bytes)
 */

export interface AvlRecord {
  timestamp: Date;
  priority: number;
  longitude: number;
  latitude: number;
  altitude: number;
  angle: number;
  satellites: number;
  speed: number;
}

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

export function parseAvlPacket(buf: Buffer): AvlRecord[] {
  if (buf.length < 10) return [];

  const codecId = buf.readUInt8(8);
  if (codecId !== 0x08 && codecId !== 0x8e) {
    console.warn(`[!] Unsupported codec ID: 0x${codecId.toString(16).padStart(2, "0")} — skipping parse`);
    return [];
  }

  const numRecords = buf.readUInt8(9);
  let offset = 10;
  const records: AvlRecord[] = [];

  for (let i = 0; i < numRecords; i++) {
    if (offset + 24 > buf.length) break;

    // Timestamp: 64-bit uint, milliseconds since epoch
    const tsHigh = buf.readUInt32BE(offset);
    const tsLow = buf.readUInt32BE(offset + 4);
    const tsMs = BigInt(tsHigh) * BigInt(0x100000000) + BigInt(tsLow);
    const timestamp = new Date(Number(tsMs));
    offset += 8;

    const priority = buf.readUInt8(offset++);

    const longitude = buf.readInt32BE(offset) / 1e7;
    offset += 4;

    const latitude = buf.readInt32BE(offset) / 1e7;
    offset += 4;

    const altitude = buf.readInt16BE(offset);
    offset += 2;

    const angle = buf.readUInt16BE(offset);
    offset += 2;

    const satellites = buf.readUInt8(offset++);

    const speed = buf.readUInt16BE(offset);
    offset += 2;

    records.push({ timestamp, priority, longitude, latitude, altitude, angle, satellites, speed });

    offset = codecId === 0x8e
      ? skipCodec8ExtendedIo(buf, offset)
      : skipCodec8Io(buf, offset);
  }

  return records;
}

function skipCodec8Io(buf: Buffer, offset: number): number {
  offset++; // event IO ID (1 byte)
  offset++; // N of Total IO (1 byte)

  const n1 = buf.readUInt8(offset++);
  offset += n1 * 2; // id(1) + value(1)

  const n2 = buf.readUInt8(offset++);
  offset += n2 * 3; // id(1) + value(2)

  const n4 = buf.readUInt8(offset++);
  offset += n4 * 5; // id(1) + value(4)

  const n8 = buf.readUInt8(offset++);
  offset += n8 * 9; // id(1) + value(8)

  return offset;
}

function skipCodec8ExtendedIo(buf: Buffer, offset: number): number {
  offset += 2; // event IO ID (2 bytes)
  offset += 2; // N of Total IO (2 bytes)

  const n1 = buf.readUInt16BE(offset); offset += 2;
  offset += n1 * 3; // id(2) + value(1)

  const n2 = buf.readUInt16BE(offset); offset += 2;
  offset += n2 * 4; // id(2) + value(2)

  const n4 = buf.readUInt16BE(offset); offset += 2;
  offset += n4 * 6; // id(2) + value(4)

  const n8 = buf.readUInt16BE(offset); offset += 2;
  offset += n8 * 10; // id(2) + value(8)

  // Variable-length IOs — unique to Codec 8 Extended
  const nx = buf.readUInt16BE(offset); offset += 2;
  for (let i = 0; i < nx; i++) {
    offset += 2; // id(2)
    const len = buf.readUInt16BE(offset); offset += 2;
    offset += len;
  }

  return offset;
}

export function buildAck(recordCount: number): Buffer {
  const ack = Buffer.alloc(4);
  ack.writeUInt32BE(recordCount, 0);
  return ack;
}
