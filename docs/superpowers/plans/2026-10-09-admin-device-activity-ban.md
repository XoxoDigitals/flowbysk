# Admin Device Activity + Cascade Ban Implementation Plan

> **For agentic workers:** Implement task-by-task.

**Goal:** Device ID fingerprinting, rich login Activity, cascade ban, suspicious app login ban, admin 20th→20th new+renew metrics.

**Architecture:** Server stores device/IP/country on logs + user meta; clients send deviceId; admin UI renders details; ban cascades by deviceId.

**Tech Stack:** Express, Prisma/meta JSON, Next dashboard, Windows/Android host bridges.

## Global Constraints

- No real MAC; Device ID fingerprint only.
- Web portal login exempt from device gate.
- Unban is not cascaded.

---

### Task 1: Server geo + device helpers + login gate + cascade + period stats
### Task 2: Dashboard Activity + Overview period card  
### Task 3: Windows + Android deviceId on login
