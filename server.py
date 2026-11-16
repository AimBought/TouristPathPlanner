"""Lokalne API HTTP bez zewnętrznych bibliotek."""
import argparse
import json
import logging
from datetime import date
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

from catalog import Catalog
from models import MODELS, DomainError as Error
from storage import JsonStore


def handler_for(catalog):
    class Handler(BaseHTTPRequestHandler):
        def send_json(self, status, body):
            content = json.dumps(body, ensure_ascii=False, allow_nan=False).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(content)))
            self.end_headers()
            self.wfile.write(content)

        def body(self):
            try:
                length = int(self.headers.get("Content-Length", "0"))
            except ValueError:
                raise Error("Nieprawidłowy Content-Length")
            if not 0 < length <= 1_000_000:
                raise Error("Wymagana treść JSON o rozmiarze do 1 MB", 413)
            try:
                def invalid_number(value):
                    raise ValueError("Nieprawidłowa liczba JSON")
                body = json.loads(self.rfile.read(length).decode("utf-8"), parse_constant=invalid_number)
            except (ValueError, UnicodeError):
                raise Error("Nieprawidłowy JSON")
            if not isinstance(body, dict):
                raise Error("Treść musi być obiektem JSON")
            return body

        def dispatch(self):
            parsed = urlsplit(self.path)
            parts = parsed.path.strip("/").split("/")
            query = parse_qs(parsed.query)
            method = self.command
            if method == "GET" and parsed.path in {"/", "/health"}:
                return 200, {"service": "Ofertowanie", "status": "ok",
                             "collections": ["/" + key for key in MODELS]}
            if not parts or parts[0] not in MODELS:
                raise Error("Nie znaleziono endpointu", 404)
            collection = parts[0]
            if method == "GET":
                if len(parts) == 1:
                    return 200, catalog.list(collection)
                if len(parts) == 2:
                    return 200, catalog.get(collection, parts[1])
                if len(parts) == 3 and parts[2] == "versions":
                    return 200, catalog.history(collection, parts[1])
                if len(parts) == 4 and parts[2] == "versions":
                    try:
                        version = int(parts[3])
                    except ValueError:
                        raise Error("Nieprawidłowy numer wersji")
                    return 200, catalog.get(collection, parts[1], version)
                if collection == "packages" and len(parts) == 3 and parts[2] == "availability":
                    at = query.get("date", [date.today().isoformat()])[0]
                    return 200, catalog.availability(parts[1], at)
            if method == "POST" and len(parts) == 1:
                return 201, catalog.save(collection, self.body())
            if method == "PATCH" and len(parts) == 2:
                return 200, catalog.save(collection, self.body(), parts[1])
            if method == "DELETE" and len(parts) == 2:
                body = self.body()
                if set(body) != {"expected_version"}:
                    raise Error("Wymagane wyłącznie pole expected_version")
                return 200, catalog.archive(collection, parts[1], body.get("expected_version"))
            raise Error("Nieobsługiwana operacja lub endpoint", 405)

        def handle_request(self):
            try:
                status, body = self.dispatch()
            except Error as exc:
                status, body = exc.status, {"error": str(exc)}
            except Exception:
                logging.exception("Błąd obsługi żądania")
                status, body = 500, {"error": "Błąd odczytu lub zapisu danych; sprawdź log serwera"}
            self.send_json(status, body)

        do_GET = do_POST = do_PATCH = do_DELETE = handle_request
    return Handler


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Atrakcje atomowe, oferty i pakiety z zapisem JSON")
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--data", default=str(Path(__file__).parent / "data" / "catalog.json"))
    args = parser.parse_args()
    service = Catalog(JsonStore(args.data))
    service.store.read()  # Zatrzymaj start przy uszkodzonym pliku zamiast go resetować.
    server = ThreadingHTTPServer(("127.0.0.1", args.port), handler_for(service))
    print(f"API: http://127.0.0.1:{args.port} | Dane: {args.data}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
