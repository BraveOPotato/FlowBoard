const keyCache = new Map<string, CryptoKey>();

export class CryptoService {
  private static simpleHash(str: string): string {
    let h1 = 0x811c9dc5;
    let h2 = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
      const c = str.charCodeAt(i);
      h1 ^= c;
      h1 = Math.imul(h1, 0x01000193) >>> 0;
      h2 ^= c;
      h2 = Math.imul(h2, 0x01000193) >>> 0;
    }
    return (
      h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0')
    ).repeat(4);
  }

  static async hashKey(boardId: string, password: string): Promise<string> {
    const raw = `${boardId}:${password}`;
    if (!crypto?.subtle) return this.simpleHash(raw);
    try {
      const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw));
      return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
    } catch {
      return this.simpleHash(raw);
    }
  }

  private static async deriveKey(boardId: string, password: string): Promise<CryptoKey> {
    const mat = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(password),
      'PBKDF2',
      false,
      ['deriveKey']
    );
    return crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt: new TextEncoder().encode(`flowboard:${boardId}`),
        iterations: 100000,
        hash: 'SHA-256',
      },
      mat,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
  }

  static async getKey(boardId: string, password: string): Promise<CryptoKey> {
    const cacheKey = `${boardId}:${password}`;
    if (keyCache.has(cacheKey)) return keyCache.get(cacheKey)!;
    const key = await this.deriveKey(boardId, password);
    keyCache.set(cacheKey, key);
    return key;
  }

  static async encrypt(boardId: string, password: string, data: unknown): Promise<unknown> {
    if (!crypto?.subtle) return data;
    try {
      const key = await this.getKey(boardId, password);
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const ct = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv },
        key,
        new TextEncoder().encode(JSON.stringify(data))
      );
      const toB64 = (buf: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(buf)));
      return { enc: 1, iv: toB64(iv), ct: toB64(ct) };
    } catch {
      return data;
    }
  }

  static async decrypt(boardId: string, password: string, payload: unknown): Promise<unknown> {
    const p = payload as { enc?: number; iv?: string; ct?: string } | null;
    if (!p?.enc) return payload;
    if (!crypto?.subtle) throw new Error('Encryption requires HTTPS');
    const key = await this.getKey(boardId, password);
    const fromB64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
    try {
      const plain = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: fromB64(p.iv!) },
        key,
        fromB64(p.ct!)
      );
      return JSON.parse(new TextDecoder().decode(plain));
    } catch {
      throw new Error('Decryption failed — wrong password?');
    }
  }
}
