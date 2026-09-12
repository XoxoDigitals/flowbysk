"""
Google Flow SaaS — Unified Runner
Launches BiB manager (8010), optional FastAPI (8000), and Next.js (3000).
Auto-launches READY BiB accounts after BiB is healthy.
"""

import sys
import subprocess
import webbrowser
import threading
import time
from pathlib import Path

workspace_dir = Path(__file__).resolve().parent


def run_fastapi():
    import uvicorn
    uvicorn.run(
        "backend.app:app",
        host="127.0.0.1",
        port=8000,
        log_level="info",
        reload=False,
    )


def run_bib():
    npm_cmd = "npm.cmd" if sys.platform == "win32" else "npm"
    subprocess.run([npm_cmd, "run", "start"], cwd=str(workspace_dir / "flow-bib"))


def bib_autolaunch():
    time.sleep(6)
    print("[*] Auto-launching READY BiB accounts…")
    try:
        subprocess.run(
            [sys.executable.replace("python.exe", "node.exe") if False else "node", str(workspace_dir / "scripts" / "bib-autolaunch.cjs")],
            cwd=str(workspace_dir),
            check=False,
        )
    except Exception as e:
        print("[!] bib-autolaunch:", e)


def main():
    print("\n" + "=" * 65)
    print("  GOOGLE FLOW SAAS — BiB PARALLEL GENERATION")
    print("  Next.js 15 + PostgreSQL + BiB (8010) + optional FastAPI (8000)")
    print("=" * 65 + "\n")

    sys.path.insert(0, str(workspace_dir))

    print("[*] Starting BiB multi-account manager on http://127.0.0.1:8010 ...")
    threading.Thread(target=run_bib, daemon=True).start()

    print("[*] Starting legacy FastAPI worker on http://127.0.0.1:8000 ...")
    threading.Thread(target=run_fastapi, daemon=True).start()

    threading.Thread(target=bib_autolaunch, daemon=True).start()

    saas_url = "http://localhost:3000"

    def open_browser():
        time.sleep(3.5)
        try:
            print(f"[*] Opening SaaS Web Studio: {saas_url}")
            webbrowser.open(saas_url)
        except Exception:
            pass

    threading.Thread(target=open_browser, daemon=True).start()

    print(f"[*] Launching Next.js on {saas_url} ...")
    npm_cmd = "npm.cmd" if sys.platform == "win32" else "npm"
    try:
        subprocess.run([npm_cmd, "run", "dev"], cwd=str(workspace_dir))
    except KeyboardInterrupt:
        print("\n[*] Shutting down Google Flow SaaS...")


if __name__ == "__main__":
    main()
