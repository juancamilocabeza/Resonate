import os
import sys
import time
import subprocess
from urllib.request import urlopen
from urllib.error import URLError, HTTPError

BASE_URL = "http://localhost:3000"
TIMEOUT_SEC = 20


def request(pathname: str):
    url = f"{BASE_URL}{pathname}"
    with urlopen(url, timeout=8) as res:
        status = res.status
        body = res.read().decode("utf-8", errors="replace")
        return status, body


def wait_for_server():
    start = time.time()
    while time.time() - start < TIMEOUT_SEC:
        try:
            status, _ = request("/")
            if status == 200:
                return
        except (URLError, HTTPError):
            pass
        time.sleep(0.3)
    raise RuntimeError("Server did not become ready in time")


def assert_true(condition: bool, message: str):
    if not condition:
        raise AssertionError(message)


def run():
    print("Starting dev server (Python)...")
    env = os.environ.copy()
    env["PORT"] = "3000"
    server_proc = subprocess.Popen(
        [sys.executable, "server.py"],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        env=env,
    )

    try:
        wait_for_server()

        status, body = request("/")
        assert_true(status == 200, "GET / should return 200")
        assert_true('id="app"' in body, "Index should include #app")
        assert_true('id="search-input"' in body, "Index should include #search-input")
        assert_true('id="play-btn"' in body, "Index should include #play-btn")
        assert_true('id="current-track-share"' in body, "Index should include #current-track-share")
        assert_true('rel="manifest"' in body, "Index should include manifest link")
        assert_true('name="theme-color"' in body, "Index should include theme-color meta")
        assert_true('apple-mobile-web-app-capable' in body, "Index should include Apple PWA meta")
        assert_true('viewport-fit=cover' in body, "Index should include viewport-fit=cover")

        status, body = request("/manifest.json")
        assert_true(status == 200, "GET /manifest.json should return 200")
        assert_true('"name"' in body, "Manifest should include name")
        assert_true('"start_url"' in body, "Manifest should include start_url")
        assert_true('"icons"' in body, "Manifest should include icons")
        assert_true('"display"' in body, "Manifest should include display mode")
        assert_true('"scope"' in body, "Manifest should include scope")

        status, body = request("/sw.js")
        assert_true(status == 200, "GET /sw.js should return 200")
        assert_true("CACHE_NAMES" in body, "SW should include CACHE_NAMES")
        assert_true("STATIC_FILES" in body, "SW should include STATIC_FILES")

        status, body = request("/css/resonate.css")
        assert_true(status == 200, "GET /css/resonate.css should return 200")
        assert_true(":root" in body or "body" in body, "CSS should contain styles")
        assert_true("safe-area" in body or "env(safe-area" in body, "CSS should handle safe-area")

        status, body = request("/js/ui.js")
        assert_true(status == 200, "GET /js/ui.js should return 200")
        assert_true("function setupPWAInstall" in body, "UI should include setupPWAInstall")
        assert_true("function shareTrack" in body, "UI should include shareTrack")

        status, body = request("/js/cache.js")
        assert_true(status == 200, "GET /js/cache.js should return 200")
        assert_true("class AudioCache" in body, "Cache should include AudioCache")
        assert_true("CACHE_CONSTANTS" in body, "Cache should include constants")

        status, body = request("/js/playback.js")
        assert_true(status == 200, "GET /js/playback.js should return 200")
        assert_true("function setupMediaSession" in body, "Playback should include setupMediaSession")

        status, body = request("/js/initialization.js")
        assert_true(status == 200, "GET /js/initialization.js should return 200")
        assert_true("function handleSharedLink" in body, "Initialization should include handleSharedLink")
        assert_true("setupLaunchQueueHandling" in body, "Initialization should include launch queue handling")

        status, body = request("/js/battery.js")
        assert_true(status == 200, "GET /js/battery.js should return 200")
        assert_true("const Battery" in body, "Battery module should be present")

        status, body = request("/js/offline.js")
        assert_true(status == 200, "GET /js/offline.js should return 200")
        assert_true("offline" in body.lower(), "Offline script should include offline logic")

        status, body = request("/js/theme.js")
        assert_true(status == 200, "GET /js/theme.js should return 200")
        assert_true("ThemeManager" in body, "Theme module should include ThemeManager")

        status, body = request("/js/search.js")
        assert_true(status == 200, "GET /js/search.js should return 200")
        assert_true("fetchOptimizedPlayableFiles" in body, "Search should include fetchOptimizedPlayableFiles")

        status, _ = request("/icons/favicon.svg")
        assert_true(status == 200, "GET /icons/favicon.svg should return 200")

        status, _ = request("/icons/maskable_icon_x192.png")
        assert_true(status == 200, "GET /icons/maskable_icon_x192.png should return 200")

        status, _ = request("/icons/maskable_icon_x512.png")
        assert_true(status == 200, "GET /icons/maskable_icon_x512.png should return 200")

        print("Smoke tests passed.")
        return 0
    except Exception as exc:
        print(f"Smoke tests failed: {exc}")
        return 1
    finally:
        try:
            server_proc.terminate()
        except Exception:
            pass


if __name__ == "__main__":
    sys.exit(run())
