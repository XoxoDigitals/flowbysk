# Portable EXE release checklist (v8+)

1. Build Release (no PDB): `dotnet publish -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true`
2. Ship **one** EXE only, e.g. `Flow Browser 8.0.0.exe` — do not also copy a duplicate bare `Flow Browser.exe`.
3. Confirm no `.pdb` next to the ship EXE.
4. Compute SHA-256 and upload via Admin → Downloads (server stores hash on file upload automatically).
5. Optional Authenticode (when you have a cert):

```powershell
signtool sign /fd SHA256 /f YourCert.pfx /p YOUR_PASSWORD /tr http://timestamp.digicert.com /td SHA256 "Flow Browser 8.0.0.exe"
```

The www vault AES key is **obfuscation only**, not a secret. Real protection is server-side (device attestation, sealed channel, DevTools disabled, API version cutover).
