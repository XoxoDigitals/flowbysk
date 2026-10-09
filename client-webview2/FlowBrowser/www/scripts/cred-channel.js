/**
 * Phase 2: X25519 ECDH + AES-GCM for sealed Google credentials.
 * Shared with server/credChannel.js (flow-cred-v1).
 */
(function (global) {
  function b64urlFromBuf(buf) {
    const bytes = buf instanceof ArrayBuffer ? new Uint8Array(buf) : buf;
    let s = '';
    for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  }
  function bufFromB64url(s) {
    const pad = '='.repeat((4 - (s.length % 4)) % 4);
    const b64 = (s + pad).replace(/-/g, '+').replace(/_/g, '/');
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  function concatBytes(a, b) {
    const out = new Uint8Array(a.length + b.length);
    out.set(a, 0);
    out.set(b, a.length);
    return out;
  }

  const CredChannel = {
    keyPair: null,
    aesRaw: null,
    aesCryptoKey: null,
    channelId: null,

    async generateClientPublicKey() {
      this.keyPair = await crypto.subtle.generateKey({ name: 'X25519' }, true, ['deriveBits']);
      const raw = await crypto.subtle.exportKey('raw', this.keyPair.publicKey);
      return b64urlFromBuf(raw);
    },

    async establish(channelId, serverPublicKeySpkiB64) {
      if (!this.keyPair) throw new Error('Generate client key first');
      const spki = bufFromB64url(serverPublicKeySpkiB64);
      const serverPub = await crypto.subtle.importKey('spki', spki, { name: 'X25519' }, false, []);
      const shared = new Uint8Array(
        await crypto.subtle.deriveBits({ name: 'X25519', public: serverPub }, this.keyPair.privateKey, 256)
      );
      const material = concatBytes(shared, new TextEncoder().encode('flow-cred-v1'));
      this.aesRaw = new Uint8Array(await crypto.subtle.digest('SHA-256', material));
      this.aesCryptoKey = await crypto.subtle.importKey('raw', this.aesRaw, { name: 'AES-GCM' }, false, [
        'decrypt',
      ]);
      this.hmacKey = await crypto.subtle.importKey(
        'raw',
        this.aesRaw,
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign']
      );
      this.channelId = channelId;
      return true;
    },

    async mac(attemptId, stage) {
      const ts = Date.now();
      const msg = `${this.channelId}|${attemptId}|${stage}|${ts}`;
      const sig = await crypto.subtle.sign('HMAC', this.hmacKey, new TextEncoder().encode(msg));
      return { ts, mac: b64urlFromBuf(sig) };
    },

    async decryptSealed(payload) {
      if (!payload || !payload.ciphertext || !payload.nonce) {
        throw new Error('Missing sealed payload');
      }
      const nonce = bufFromB64url(payload.nonce);
      const packed = bufFromB64url(payload.ciphertext);
      if (packed.length < 17) throw new Error('Ciphertext too short');
      const tag = packed.slice(packed.length - 16);
      const data = packed.slice(0, packed.length - 16);
      const ct = concatBytes(data, tag);
      // AES-GCM expects ciphertext||tag as one buffer in WebCrypto decrypt
      const plain = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: nonce, tagLength: 128 },
        this.aesCryptoKey,
        concatBytes(data, tag)
      );
      void ct;
      return new TextDecoder().decode(plain);
    },

    clear() {
      this.keyPair = null;
      this.aesRaw = null;
      this.aesCryptoKey = null;
      this.hmacKey = null;
      this.channelId = null;
    },
  };

  global.FlowCredChannel = CredChannel;
})(typeof window !== 'undefined' ? window : globalThis);
