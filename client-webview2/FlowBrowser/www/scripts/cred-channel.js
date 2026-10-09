/**
 * Phase 2 credential channel (flow-cred-v1).
 * Prefer host ECDH (NSec) — WebView2 crypto.subtle is often unavailable on virtual hosts.
 * Falls back to WebCrypto when host bridge is missing (browser debug).
 */
(function (global) {
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
  function hostApi() {
    return global.electronAPI && typeof global.electronAPI.credGenerateKey === 'function'
      ? global.electronAPI
      : null;
  }
  function subtleApi() {
    var c = global.crypto || (typeof self !== 'undefined' ? self.crypto : null);
    return c && c.subtle ? c.subtle : null;
  }

  var CredChannel = {
    mode: null, // 'host' | 'subtle'
    keyPair: null,
    aesRaw: null,
    aesCryptoKey: null,
    hmacKey: null,
    channelId: null,

    async generateClientPublicKey() {
      var host = hostApi();
      if (host) {
        this.mode = 'host';
        this.clearLocal();
        var res = await host.credGenerateKey();
        if (!res || !res.clientPublicKey) throw new Error('Host ECDH failed');
        return res.clientPublicKey;
      }
      var subtle = subtleApi();
      if (!subtle) {
        throw new Error('Secure crypto unavailable (no host bridge and no crypto.subtle)');
      }
      this.mode = 'subtle';
      this.keyPair = await subtle.generateKey({ name: 'X25519' }, true, ['deriveBits']);
      var raw = await subtle.exportKey('raw', this.keyPair.publicKey);
      return b64urlFromBuf(raw);
    },

    async establish(channelId, serverPublicKeySpkiB64) {
      if (this.mode === 'host') {
        var host = hostApi();
        if (!host) throw new Error('Host bridge missing');
        await host.credEstablish(channelId, serverPublicKeySpkiB64);
        this.channelId = channelId;
        this.aesCryptoKey = true; // truthy sentinel for app-shell readiness checks
        return true;
      }
      if (!this.keyPair) throw new Error('Generate client key first');
      var subtle = subtleApi();
      if (!subtle) throw new Error('crypto.subtle missing');
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
      if (this.mode === 'host') {
        var host = hostApi();
        if (!host) throw new Error('Host bridge missing');
        return await host.credMac(attemptId, stage);
      }
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
      if (this.mode === 'host') {
        var host = hostApi();
        if (!host) throw new Error('Host bridge missing');
        var res = await host.credDecrypt(payload.ciphertext, payload.nonce);
        if (!res || typeof res.plaintext !== 'string') throw new Error('Host decrypt failed');
        return res.plaintext;
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

    clearLocal() {
      this.keyPair = null;
      this.aesRaw = null;
      this.aesCryptoKey = null;
      this.hmacKey = null;
      this.channelId = null;
    },

    clear() {
      this.clearLocal();
      this.mode = null;
      var host = hostApi();
      if (host && typeof host.credClear === 'function') {
        try { host.credClear(); } catch (e) { /* ignore */ }
      }
    },
  };

  global.FlowCredChannel = CredChannel;
})(typeof window !== 'undefined' ? window : globalThis);
