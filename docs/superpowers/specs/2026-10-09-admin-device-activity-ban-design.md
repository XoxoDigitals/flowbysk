# Admin device activity, cascade ban, and period metrics

## Summary

Enrich admin user Activity with login detail (IP, country, Device ID, client). Use a stable **Device ID fingerprint** (not hardware MAC) for multi-account ban cascade. Ban immediately when an official app login lacks Device ID / client attestation. Web portal login is exempt. Add Overview metrics per admin for the **20th→20th** period: new users + renewals.

## Decisions (approved)

| Topic | Choice |
|-------|--------|
| Approach | Extend existing logs + User meta + Activity UI (Approach 1) |
| Device identity | Install UUID + machine/Android ID → labeled **Device ID** |
| Suspicious rule | App login (`/api/v6/client`) without Device ID / client header → ban |
| Web portal | Exempt from Device ID requirement |
| Period window | 20th of last month 00:00 → 20th of this month 00:00 (UTC or server TZ — document as UTC) |
| Period metric | New users created by admin + renewals attributed to admin = Total |

## Current gaps

- Activity UI shows action name only; log `details` (IP, etc.) not rendered.
- No Device ID on clients or server.
- Ban is single-user; no cascade.
- No IP country.
- Overview admin table is lifetime owned-user count only.

## Architecture

```
EXE / Android                     Web portal
  deviceId + X-Flow-Client          (no deviceId)
       │                                │
       ▼                                ▼
  POST /api/v6/client/login      POST /api/session (or web auth)
       │                         exempt from device gate
       ├─ missing deviceId on app → BAN + log suspicious
       ├─ store IP, country, deviceId on SystemLog + user meta
       └─ success path as today

Admin ban user
  → ban target
  → find users sharing deviceId → ban those too
  → audit log cascade

Overview metrics
  → per admin: count creates + renewals in [prev20th, this20th)
```

## Component changes

### 1. Device ID (clients)

**Windows (`client-webview2`)**
- Persist install UUID under opaque data path; combine with machine id hash if available.
- Expose via host invoke `getDeviceId`.
- Shell login body: `{ username, password, clientPublicKey, deviceId }`.
- Header: `X-Flow-Client: windows-exe/<version>`.

**Android**
- Persist UUID in EncryptedSharedPreferences; optionally fold in `Settings.Secure.ANDROID_ID`.
- Bridge `getDeviceId`; same login body + `X-Flow-Client: android/<version>`.

**Web dashboard**
- No Device ID; uses existing web auth paths only.

### 2. Server login gate (`server/routes/client-v6.js`)

- Require `deviceId` (non-empty, min length) and `X-Flow-Client` matching `windows-exe/` or `android/` for `/api/v6/client/login`.
- If missing/invalid after credentials would otherwise succeed **or** on authenticated attempt: set user `BANNED`, `banReason: suspicious_client`, log `suspicious_login`, cascade by deviceId if any prior deviceId on account (usually none on first hit).
- Prefer: validate device **before** issuing JWT; if username/password valid but device missing → ban that user + deny token.
- Always log attempt with IP, UA, deviceId (or null), country, client header.

### 3. Logging + geo

- On login (success/fail/suspicious): write `SystemLog` with rich `details`: `ip`, `country`, `deviceId`, `client`, `userAgent`, `outcome`.
- Persist `lastIp`, `lastCountry`, `lastDeviceId` on user meta (and Prisma `lastIp` if column exists).
- Country: GeoIP (e.g. local MaxMind lite or lightweight HTTP geo API with cache). Fail open to `country: "XX"` if lookup fails.
- Index/store known deviceIds per user in meta array `deviceIds[]` for cascade queries.

### 4. Ban cascade

- `PUT /api/admin/users/:id/ban` when `banned: true`:
  1. Ban target as today.
  2. Collect deviceIds from target meta / recent login logs.
  3. Find other users with overlapping deviceId → ban each, log `ban_cascade` with `{ fromUserId, deviceId, targetUserId }`.
- Unban does **not** auto-unban cascade targets (manual only) — avoids mass unlock abuse.

### 5. Admin UI — user detail Activity

File: `dashboard/src/app/admin/users/[id]/page.tsx`

- Expand Activity rows to show: when, action, IP, country, Device ID, client, outcome / short detail.
- Optional filter chips: Login only / All.
- Show last Device ID + last IP/country on Settings summary strip.

### 6. Overview admin period card

File: Overview / metrics (admin home using `/api/admin/metrics` or system-users).

- New API field per admin: `periodStats: { from, to, newUsers, renewals, total }`.
- Window: UTC `YYYY-MM-20` last month → `YYYY-MM-20` this month.
- **newUsers**: users with `createdByAdminId` or `ownedByAdminId` = admin and `createdAt` in window (include via reseller if current ownership rules already count resellers — match existing `countOwnedUsersForAdmin` attribution).
- **renewals**: credit/plan events in window attributed to that admin (define as admin-driven credit grants / plan renewals in credit history or logs with actions like `admin_renew`, `grant` with renew reason — implement against existing credit history types; if no renew type, count plan expiry extensions / credit grants by that admin).

### 7. Out of scope

- Real Wi‑Fi/Ethernet MAC collection.
- Auto-unban cascade.
- Ban web users for missing Device ID.
- Reseller UI parity (admin-first; reseller can follow later).

## Verification

1. EXE/Android login with Device ID → Activity shows IP, country, Device ID, client.
2. curl login to `/api/v6/client/login` with valid password but no Device ID → user banned, no JWT.
3. Web dashboard login still works without Device ID.
4. Ban user A sharing Device ID with user B → B also BANNED; logs show cascade.
5. Overview shows per-admin Total for current 20th→20th window; numbers match DB counts.
6. Geo failure still logs login with country `XX`.

## Risks

| Risk | Mitigation |
|------|------------|
| Shared family device bans both | Accept for abuse control; document; unban manual |
| Emulator/reinstall new Device ID | Expected; cascade only on known IDs |
| False ban of misconfigured old EXE | Ship EXE/Android with Device ID before enabling hard gate; optional env `REQUIRE_DEVICE_ID=1` for staged rollout |
| Geo API rate limits | Cache by IP; fail open |

## Success criteria

- Admins see detailed login activity (IP, country, Device ID).
- Ban-by-Device-ID cascade works.
- App clients without attestation cannot obtain v6 tokens and get banned.
- Admin period Total (new + renew) visible for 20th→20th window.
