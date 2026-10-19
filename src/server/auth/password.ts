import { randomBytes, scrypt, scryptSync, timingSafeEqual } from "node:crypto";

const keyLength = 64;
const scryptOptions = { N: 16_384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 } as const;
const dummySalt = Buffer.from("2dd40ff8568a0b7e4c9f8b7e148fd0a1", "hex");
const dummyHash = scryptSync("invalid-account-password", dummySalt, keyLength, scryptOptions);
const dummyEncodedHash = `scrypt$16384$8$1$${dummySalt.toString("hex")}$${dummyHash.toString("hex")}`;

function derive(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keyLength, scryptOptions, (error, key) => {
      if (error) reject(error);
      else resolve(key as Buffer);
    });
  });
}

export function normalizeUsername(value: string): string {
  return value.normalize("NFKC").trim().toLowerCase();
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt);
  return `scrypt$16384$8$1$${salt.toString("hex")}$${key.toString("hex")}`;
}

export async function verifyPassword(
  password: string,
  encodedHash: string | null,
): Promise<boolean> {
  const encoded = encodedHash ?? dummyEncodedHash;
  const [algorithm, n, r, p, saltHex, hashHex] = encoded.split("$");
  const validFormat =
    algorithm === "scrypt" &&
    n === "16384" &&
    r === "8" &&
    p === "1" &&
    /^[0-9a-f]{32}$/i.test(saltHex ?? "") &&
    /^[0-9a-f]{128}$/i.test(hashHex ?? "");
  const salt = validFormat ? Buffer.from(saltHex!, "hex") : dummySalt;
  const expected = validFormat ? Buffer.from(hashHex!, "hex") : dummyHash;
  const actual = await derive(password, salt);
  return timingSafeEqual(actual, expected) && encodedHash !== null && validFormat;
}
