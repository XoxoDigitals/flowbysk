/**
 * Phase 2: X25519 ECDH + AES-GCM for sealed Google credentials.
 * Requires a secure context (https:// virtual host) so crypto.subtle exists.
 * Shared with server/credChannel.js (flow-cred-v1).
 */
(function (global) {
  function subtleApi() {
    var c = global.crypto || (typeof self !== 'undefined' ? self.crypto : null);
    if (!c || !c.subtle) {
      throw new Error(
        'Secure crypto unavailable. Shell must load over https://flowbrowser.local (not http).'
      );
    }
    return c.subtle;
  }

  function b64urlFromBuf(buf) {
    var bytes = buf instanceof ArrayBuffer ? new Uint8Array(buf) : buf;
    var s = '';
    for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  }
  function bufFromB64url(s) {
    var pad = '='.repeat((4 - (s.length % 4)) % 4);
    var b64 = (s + pad).replace(/-/g, '+').replace(/_/g, '/');
    var bin = atob(b64);
    var out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  function concatBytes(a, b) {
    var out = new Uint8Array(a.length + b.length);
    out.set(a, 0);
    out.set(b, a.length);
    return out;
  }

  var CredChannel = {
    keyPair: null,
    aesRaw: null,
    aesCryptoKey: null,
    hmacKey: null,
    channelId: null,

    async generateClientPublicKey() {
      var subtle = subtleApi();
      this.keyPair = await subtle.generateKey({ name: 'X25519' }, true, ['deriveBits']);
      var raw = await subtle.exportKey('raw', this.keyPair.publicKey);
      return b64urlFromBuf(raw);
    },

    async establish(channelId, serverPublicKeySpkiB64) {
      if (!this.keyPair) throw new Error('Generate client key first');
      var subtle = subtleApi();
      var spki = bufFromB64url(serverPublicKeySpkiB64);
      var serverPub = await subtle.importKey('spki', spki, { name: 'X25519' }, false, []);
      var shared = new Uint8Array(
        await subtle.deriveBits({ name: 'X25519', public: serverPub }, this.keyPair.privateKey, 256)
      );
      var material = concatBytes(shared, new TextEncoder().encode('flow-cred-v1'));
      this.aesRaw = new Uint8Array(await subtle.digest('SHA-256', material));
      this.aesCryptoKey = await subtle.importKey('raw', this.aesRaw, { name: 'AES-GCM' }, false, [
        'decrypt',
      ]);
      this.hmacKey = await subtle.importKey(
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
      var subtle = subtleApi();
      var ts = Date.now();
      var msg = this.channelId + '|' + attemptId + '|' + stage + '|' + ts;
      var sig = await subtle.sign('HMAC', this.hmacKey, new TextEncoder().encode(msg));
      return { ts: ts, mac: b64urlFromBuf(sig) };
    },

    async decryptSealed(payload) {
      if (!payload || !payload.ciphertext || !payload.nonce) {
        throw new Error('Missing sealed payload');
      }
      var subtle = subtleApi();
      var nonce = bufFromB64url(payload.nonce);
      var packed = bufFromB64url(payload.ciphertext);
      if (packed.length < 17) throw new Error('Ciphertext too short');
      var tag = packed.slice(packed.length - 16);
      var data = packed.slice(0, packed.length - 16);
      var plain = await subtle.decrypt(
        { name: 'AES-GCM', iv: nonce, tagLength: 128 },
        this.aesCryptoKey,
        concatBytes(data, tag)
      );
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
