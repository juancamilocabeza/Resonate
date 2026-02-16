import os
import sys
import json
import mimetypes
import urllib.request
import urllib.error
import ssl
import traceback
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse
from pathlib import Path

ROOT = Path(__file__).resolve().parent
PORT = int(os.environ.get("PORT", "3000"))

# Ensure common types
mimetypes.add_type("text/javascript; charset=utf-8", ".js")
mimetypes.add_type("text/css; charset=utf-8", ".css")


def _should_no_cache(url_path: str) -> bool:
    return (
        url_path == "/"
        or url_path.endswith(".html")
        or url_path.endswith("/sw.js")
        or url_path.endswith("sw.js")
        or url_path.endswith("manifest.json")
    )


def _safe_resolve(url_path: str) -> Path | None:
    # Strip query/fragment
    path_only = url_path.split("?", 1)[0].split("#", 1)[0]
    # Normalize slashes and remove leading /
    rel = path_only.replace("\\", "/").lstrip("/")

    # Prevent path traversal
    try:
        full = (ROOT / rel).resolve()
    except Exception:
        return None

    try:
        root_resolved = ROOT.resolve()
    except Exception:
        root_resolved = ROOT

    if not str(full).startswith(str(root_resolved)):
        return None
    return full


class ResonateHandler(BaseHTTPRequestHandler):
    server_version = "ResonatePythonServer/1.0"

    _DISCONNECT_ERRORS = (BrokenPipeError, ConnectionResetError, ConnectionAbortedError)

    def _safe_write(self, data: bytes) -> None:
        try:
            self.wfile.write(data)
        except self._DISCONNECT_ERRORS:
            # Client aborted (e.g., fetch canceled). Ignore.
            return

    def _send_common_headers(self, content_type: str, url_path: str) -> None:
        self.send_header("Content-Type", content_type)
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Cache-Control", "no-cache" if _should_no_cache(url_path) else "no-cache")
        self.send_header(
            "Content-Security-Policy",
            "default-src 'self'; connect-src 'self' https://archive.org https://*.archive.org http://archive.org http://*.archive.org; img-src 'self' data: https://archive.org https://*.archive.org http://archive.org http://*.archive.org; media-src 'self' https://archive.org https://*.archive.org http://archive.org http://*.archive.org; script-src 'self' https://www.gstatic.com http://www.gstatic.com https://www.googletagmanager.com https://www.gstatic.com/* http://www.gstatic.com/* https://www.gstatic.com/eureka/* http://www.gstatic.com/eureka/* 'sha256-EFBqO59HVRvqU1F+qQLZEAaxBWq7OXp3xPW1L8AdgEw=' 'sha256-Fa/tzRij1qW6WeSQmh4dekC31DsCL7WAzB27l1TUtoI=';"
        )

    def do_HEAD(self):
        try:
            self._handle(method="HEAD")
        except self._DISCONNECT_ERRORS:
            return
        except Exception as e:
            try:
                sys.stderr.write(f"[server] unhandled error (HEAD): {e}\n")
                sys.stderr.write(traceback.format_exc() + "\n")
            except Exception:
                pass
            try:
                self.send_response(500)
                self.send_header("Content-Type", "text/plain; charset=utf-8")
                self.end_headers()
            except Exception:
                pass

    def do_GET(self):
        try:
            self._handle(method="GET")
        except self._DISCONNECT_ERRORS:
            return
        except Exception as e:
            try:
                sys.stderr.write(f"[server] unhandled error (GET): {e}\n")
                sys.stderr.write(traceback.format_exc() + "\n")
            except Exception:
                pass
            try:
                self.send_response(500)
                self.send_header("Content-Type", "text/plain; charset=utf-8")
                self.end_headers()
                self._safe_write(b"Internal Server Error")
            except Exception:
                pass

    def _handle(self, method: str):
        parsed = urlparse(self.path or "/")
        url_path = parsed.path or "/"

        if url_path == "/api/archive/advancedsearch":
            return self._proxy_archive_advancedsearch(method)

        if url_path.startswith("/api/archive/metadata/"):
            identifier = url_path[len("/api/archive/metadata/"):].strip("/")
            return self._proxy_archive_metadata(method, identifier)

        # Static serving with SPA fallback
        if url_path in ("/", ""):
            file_path = ROOT / "index.html"
        else:
            resolved = _safe_resolve(self.path or "/")
            if not resolved:
                self.send_response(400)
                self._send_common_headers("text/plain; charset=utf-8", url_path)
                self.end_headers()
                if method != "HEAD":
                    self._safe_write(b"Bad Request")
                return
            file_path = resolved

        # Directory -> index.html
        if file_path.exists() and file_path.is_dir():
            file_path = file_path / "index.html"

        # SPA fallback for extensionless routes
        if not file_path.exists():
            if file_path.suffix == "":
                file_path = ROOT / "index.html"
            else:
                self.send_response(404)
                self._send_common_headers("text/plain; charset=utf-8", url_path)
                self.end_headers()
                if method != "HEAD":
                    self._safe_write(b"Not Found")
                return

        content_type, _ = mimetypes.guess_type(str(file_path))
        if not content_type:
            content_type = "application/octet-stream"

        self.send_response(200)
        self._send_common_headers(content_type, url_path)
        self.end_headers()

        if method == "HEAD":
            return

        try:
            data = file_path.read_bytes()
        except Exception:
            self.send_response(500)
            self._send_common_headers("text/plain; charset=utf-8", url_path)
            self.end_headers()
            self._safe_write(b"Internal Server Error")
            return

        self._safe_write(data)

    def _proxy_archive_advancedsearch(self, method: str):
        if method not in ("GET", "HEAD"):
            self.send_response(405)
            self._send_common_headers("text/plain; charset=utf-8", "/api/archive/advancedsearch")
            self.end_headers()
            if method != "HEAD":
                self._safe_write(b"Method Not Allowed")
            return

        parsed = urlparse(self.path or "")
        upstream_url = f"https://archive.org/advancedsearch.php{('?' + parsed.query) if parsed.query else ''}"
        return self._proxy_upstream_json(method, upstream_url)

    def _proxy_archive_metadata(self, method: str, identifier: str):
        if method not in ("GET", "HEAD"):
            self.send_response(405)
            self._send_common_headers("text/plain; charset=utf-8", "/api/archive/metadata")
            self.end_headers()
            if method != "HEAD":
                self._safe_write(b"Method Not Allowed")
            return

        if not identifier:
            self.send_response(400)
            self._send_common_headers("text/plain; charset=utf-8", "/api/archive/metadata")
            self.end_headers()
            if method != "HEAD":
                self._safe_write(b"Bad Request")
            return

        upstream_url = f"https://archive.org/metadata/{identifier}"
        return self._proxy_upstream_json(method, upstream_url)

    def _proxy_upstream_json(self, method: str, upstream_url: str):
        allow_insecure = os.environ.get("RES_PROXY_INSECURE_SSL", "").strip().lower() in ("1", "true", "yes")

        def _open_with_context(ctx: ssl.SSLContext | None):
            req = urllib.request.Request(
                upstream_url,
                method="GET",
                headers={
                    "Accept": "application/json",
                    "User-Agent": "ResonatePythonServer/1.0",
                },
            )
            if ctx is None:
                return urllib.request.urlopen(req, timeout=55)
            opener = urllib.request.build_opener(urllib.request.HTTPSHandler(context=ctx))
            return opener.open(req, timeout=55)

        used_insecure = False
        try:
            # First try: normal verification
            ctx = ssl.create_default_context()
            try:
                ctx.load_default_certs()
            except Exception:
                pass
            resp_cm = _open_with_context(ctx)
        except (ssl.SSLError, urllib.error.URLError) as e:
            # Corporate TLS interception can break cert validation for Python.
            if isinstance(e, urllib.error.HTTPError):
                resp_cm = e
            else:
                msg = str(e)
                if allow_insecure or ("CERTIFICATE_VERIFY_FAILED" in msg) or ("certificate" in msg.lower() and "verify" in msg.lower()):
                    used_insecure = True
                    resp_cm = _open_with_context(ssl._create_unverified_context())  # noqa: SLF001
                else:
                    raise

        try:
            with resp_cm as resp:
                status = getattr(resp, "status", 200)
                content_type = resp.headers.get("Content-Type") or "application/json; charset=utf-8"

                try:
                    self.send_response(status)
                    self.send_header("Content-Type", content_type)
                    self.send_header("Cache-Control", "no-cache")
                    self.send_header("X-Content-Type-Options", "nosniff")
                    self.send_header("Access-Control-Allow-Origin", "*")
                    if used_insecure:
                        self.send_header("X-Resonate-Proxy-SSL", "insecure")
                    self.end_headers()
                except self._DISCONNECT_ERRORS:
                    return

                if method == "HEAD":
                    return

                self._safe_write(resp.read())
        except urllib.error.HTTPError as e:
            status = getattr(e, "code", 502)
            content_type = None
            try:
                content_type = e.headers.get("Content-Type")
            except Exception:
                content_type = None
            if not content_type:
                content_type = "application/json; charset=utf-8"

            try:
                self.send_response(status)
                self.send_header("Content-Type", content_type)
                self.send_header("Cache-Control", "no-cache")
                self.send_header("X-Content-Type-Options", "nosniff")
                self.send_header("Access-Control-Allow-Origin", "*")
                self.send_header("X-Resonate-Proxy-Upstream", upstream_url)
                try:
                    retry_after = e.headers.get("Retry-After")
                    if retry_after:
                        self.send_header("Retry-After", retry_after)
                except Exception:
                    pass
                self.end_headers()
            except self._DISCONNECT_ERRORS:
                return

            if method == "HEAD":
                return

            # Best-effort passthrough body so the browser/devtools can show real upstream error.
            try:
                body = e.read()
                if body:
                    self._safe_write(body)
                    return
            except Exception:
                pass

            payload = {
                "error": "Upstream HTTP error",
                "upstream": upstream_url,
                "status": status,
                "message": str(e),
            }
            self._safe_write(json.dumps(payload).encode("utf-8"))
        except Exception as e:
            if isinstance(e, self._DISCONNECT_ERRORS):
                return
            # Log details to stderr so the dev can see the real cause.
            try:
                sys.stderr.write(f"[proxy] error for {upstream_url}: {e}\n")
                sys.stderr.write(traceback.format_exc() + "\n")
            except Exception:
                pass

            try:
                self.send_response(502)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.send_header("Cache-Control", "no-cache")
                self.send_header("X-Content-Type-Options", "nosniff")
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
            except self._DISCONNECT_ERRORS:
                return
            if method != "HEAD":
                payload = {
                    "error": "Bad Gateway",
                    "upstream": upstream_url,
                    "message": str(e),
                    "hint": "If you are behind a corporate proxy/SSL interception, set RES_PROXY_INSECURE_SSL=1",
                }
                self._safe_write(json.dumps(payload).encode("utf-8"))


def main() -> int:
    # Bind only to loopback to avoid firewall prompts/issues.
    httpd = ThreadingHTTPServer(("127.0.0.1", PORT), ResonateHandler)
    cert_file = ROOT / "localhost.crt"
    key_file = ROOT / "localhost.key"
    use_ssl = cert_file.exists() and key_file.exists()
    if use_ssl:
        import ssl
        context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        context.load_cert_chain(certfile=str(cert_file), keyfile=str(key_file))
        httpd.socket = context.wrap_socket(httpd.socket, server_side=True)
        print(f"Resonate python server (HTTPS): https://localhost:{PORT}")
    else:
        print(f"Resonate python server (HTTP): http://localhost:{PORT}")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
