// 의존성 없는 ZIP 작성기 (deflate, UTF-8 파일명). /reports/all.zip과 /project.zip이 쓴다.
// ZipWriter는 항목을 하나씩 압축해 바로 흘려 쓴다: 전체를 메모리에 모으지 않고, 비동기 압축이라 서버를 멈추지 않는다.
// ZIP64는 지원하지 않는다: 항목 하나·전체가 4GB 미만이어야 한다 (all.zip 상한 200MB, P1-7-R15).
import { promisify } from 'node:util';
import { crc32, deflateRaw, deflateRawSync } from 'node:zlib';

export interface ZipEntry {
  name: string;
  data: Buffer;
}

const deflateRawAsync = promisify(deflateRaw);

function dosDateTime(d: Date): { time: number; date: number } {
  const year = Math.max(1980, d.getFullYear());
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

interface Encoded {
  name: Buffer;
  crc: number;
  size: number;
  body: Buffer;
  stored: boolean;
}

function encode(e: ZipEntry, deflated: Buffer): Encoded {
  const stored = deflated.length >= e.data.length;
  return { name: Buffer.from(e.name.replace(/\\/g, '/'), 'utf8'), crc: crc32(e.data), size: e.data.length, body: stored ? e.data : deflated, stored };
}

function localHeader(x: Encoded, t: { time: number; date: number }): Buffer {
  const h = Buffer.alloc(30);
  h.writeUInt32LE(0x04034b50, 0);
  h.writeUInt16LE(20, 4); // 필요한 버전
  h.writeUInt16LE(0x0800, 6); // UTF-8 파일명
  h.writeUInt16LE(x.stored ? 0 : 8, 8);
  h.writeUInt16LE(t.time, 10);
  h.writeUInt16LE(t.date, 12);
  h.writeUInt32LE(x.crc, 14);
  h.writeUInt32LE(x.body.length, 18);
  h.writeUInt32LE(x.size, 22);
  h.writeUInt16LE(x.name.length, 26);
  return Buffer.concat([h, x.name]);
}

function centralHeader(x: Encoded, t: { time: number; date: number }, offset: number): Buffer {
  const c = Buffer.alloc(46);
  c.writeUInt32LE(0x02014b50, 0);
  c.writeUInt16LE(20, 4); // 만든 버전
  c.writeUInt16LE(20, 6);
  c.writeUInt16LE(0x0800, 8);
  c.writeUInt16LE(x.stored ? 0 : 8, 10);
  c.writeUInt16LE(t.time, 12);
  c.writeUInt16LE(t.date, 14);
  c.writeUInt32LE(x.crc, 16);
  c.writeUInt32LE(x.body.length, 20);
  c.writeUInt32LE(x.size, 24);
  c.writeUInt16LE(x.name.length, 28);
  c.writeUInt32LE(offset, 42);
  return Buffer.concat([c, x.name]);
}

function endRecord(count: number, centralSize: number, centralOffset: number): Buffer {
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(count, 8);
  end.writeUInt16LE(count, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(centralOffset, 16);
  return end;
}

/** 흘려 쓰는 ZIP. write가 돌려주는 약속을 기다려 받는 쪽 속도에 맞춘다 */
export class ZipWriter {
  private readonly write: (b: Buffer) => Promise<void> | void;
  private readonly t: { time: number; date: number };
  private readonly central: Buffer[] = [];
  private offset = 0;
  private count = 0;

  constructor(write: (b: Buffer) => Promise<void> | void, mtime: Date = new Date()) {
    this.write = write;
    this.t = dosDateTime(mtime);
  }

  async add(name: string, data: Buffer): Promise<void> {
    const x = encode({ name, data }, await deflateRawAsync(data));
    const head = localHeader(x, this.t);
    this.central.push(centralHeader(x, this.t, this.offset));
    await this.write(head);
    await this.write(x.body);
    this.offset += head.length + x.body.length;
    this.count++;
  }

  async finish(): Promise<void> {
    const central = Buffer.concat(this.central);
    await this.write(Buffer.concat([central, endRecord(this.count, central.length, this.offset)]));
  }
}

/** 작은 ZIP을 한 번에 만든다 (테스트·작은 산출물용) */
export function buildZip(entries: readonly ZipEntry[], mtime: Date = new Date()): Buffer {
  const t = dosDateTime(mtime);
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    const x = encode(e, deflateRawSync(e.data));
    const head = localHeader(x, t);
    central.push(centralHeader(x, t, offset));
    parts.push(head, x.body);
    offset += head.length + x.body.length;
  }
  const c = Buffer.concat(central);
  return Buffer.concat([...parts, c, endRecord(entries.length, c.length, offset)]);
}
