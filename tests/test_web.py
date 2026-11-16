"""HTTP integration tests for the catalog website and cart checkout."""
import json
import tempfile
import unittest
from http.client import HTTPConnection
from http.server import ThreadingHTTPServer
from pathlib import Path
from threading import Thread

from catalog import Catalog
from server import handler_for
from storage import JsonStore


class WebsiteTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.path = Path(temporary.name) / "catalog.json"
        self.catalog = Catalog(JsonStore(self.path))
        attraction = self.catalog.save("attractions", {
            "name": "Katedra", "description": "Wnętrze", "location": "Wawel"})
        self.attraction_id = attraction["id"]
        self.visit = self.catalog.save("visits", {
            "name": "Zwiedzanie", "description": "Z przewodnikiem",
            "attraction_id": attraction["id"], "mode": "guided",
            "duration_minutes": 60, "admission_included": True})
        self.service = self.catalog.save("services", {
            "name": "Transfer", "description": "Dojazd", "service_type": "transfer"})
        self.existing_offer = self.catalog.save("offers", {
            "name": "Oferta katalogowa", "description": "Gotowy zestaw",
            "items": [{"kind": "visit", "id": self.visit["id"], "quantity": 1}]})
        server = ThreadingHTTPServer(("127.0.0.1", 0), handler_for(self.catalog))
        Thread(target=server.serve_forever, daemon=True).start()
        self.addCleanup(server.server_close)
        self.addCleanup(server.shutdown)
        self.connection = HTTPConnection(*server.server_address, timeout=5)
        self.addCleanup(self.connection.close)

    def request(self, method, path, body=None):
        content = json.dumps(body, ensure_ascii=False).encode("utf-8") if body is not None else None
        self.connection.request(method, path, content, {"Content-Type": "application/json"})
        response = self.connection.getresponse()
        return response.status, response.getheader("Content-Type"), response.read()

    def checkout(self, **changes):
        body = {
            "name": "Mój pakiet", "description": "Zestaw na wspólny wyjazd",
            "items": [
                {"kind": "visit", "id": self.visit["id"], "quantity": 2},
                {"kind": "service", "id": self.service["id"], "quantity": 1},
                {"kind": "offer", "id": self.existing_offer["id"], "quantity": 3}],
            "audience": "group", "min_participants": 2, "max_participants": 12,
            "valid_from": "2026-01-01", "valid_to": "2027-12-31"}
        body.update(changes)
        status, mime, content = self.request("POST", "/packages/from-cart", body)
        self.assertIn("application/json", mime)
        return status, json.loads(content)

    def test_client_admin_and_assets_are_served(self):
        for route in ("/", "/admin"):
            with self.subTest(route=route):
                status, mime, content = self.request("GET", route)
                self.assertEqual(status, 200)
                self.assertIn("text/html", mime)
                self.assertIn("utf-8", mime.lower())
                self.assertIn("<html", content.decode("utf-8").lower())
        for route, expected in (("/static/app.js", "javascript"),
                                ("/static/styles.css", "text/css")):
            with self.subTest(route=route):
                status, mime, content = self.request("GET", route)
                self.assertEqual(status, 200)
                self.assertIn(expected, mime)
                self.assertGreater(len(content), 0)
        status, mime, content = self.request("GET", "/health")
        self.assertEqual(status, 200)
        self.assertIn("application/json", mime)
        self.assertEqual(json.loads(content)["status"], "ok")

    def test_static_routes_do_not_expose_source_or_catalog_files(self):
        routes = ("/static/missing", "/static/../server.py", "/static/%2e%2e/server.py",
                  "/static/..%5cserver.py", "/static/%2e%2e%2fserver.py",
                  "/static/../data/catalog.json", "/server.py", "/data/catalog.json")
        for route in routes:
            with self.subTest(route=route):
                status, mime, content = self.request("GET", route)
                self.assertEqual(status, 404)
                self.assertIn("application/json", mime)
                self.assertIn("error", json.loads(content))

    def test_mixed_cart_creates_offer_and_package_with_nested_snapshot(self):
        status, result = self.checkout()
        self.assertEqual(status, 201)
        offer, package = result["offer"], result["package"]
        self.assertEqual(package["target"], {"kind": "offer", "id": offer["id"]})
        self.assertEqual(package["min_participants"], 2)
        self.assertEqual(package["max_participants"], 12)
        self.assertEqual(len(offer["items"]), 3)
        self.assertEqual([item["quantity"] for item in offer["items"]], [2, 1, 3])
        snapshot = package["snapshot"]
        self.assertEqual(snapshot["kind"], "offer")
        self.assertEqual(snapshot["items"], offer["items"])
        nested = snapshot["item_snapshots"][2]["snapshot"]
        self.assertEqual(nested["id"], self.existing_offer["id"])
        self.assertEqual(nested["item_snapshots"][0]["snapshot"]["attraction_snapshot"]["id"],
                         self.attraction_id)
        self.assertEqual(len(self.catalog.list("offers")), 2)
        self.assertEqual(len(self.catalog.list("packages")), 1)
        self.assertEqual(self.catalog.get("offers", offer["id"])["items"], offer["items"])
        self.catalog.save("attractions", {"expected_version": 1, "closures": [{
            "start": "2026-11-16", "end": "2026-11-17", "reason": "Konserwacja"}]},
            self.attraction_id)
        status, _, content = self.request(
            "GET", f"/packages/{package['id']}/availability?date=2026-11-16")
        self.assertEqual(status, 200)
        self.assertFalse(json.loads(content)["available"])

    def test_invalid_cart_never_saves_partial_offer_or_package(self):
        visit_item = {"kind": "visit", "id": self.visit["id"], "quantity": 1}
        changes = (
            {"items": []},
            {"items": [visit_item, visit_item]},
            {"items": [{**visit_item, "quantity": 0}]},
            {"items": [{**visit_item, "quantity": True}]},
            {"items": [{**visit_item, "kind": "attraction"}]},
            {"items": [{**visit_item, "unexpected": "value"}]},
            {"name": ""},
            {"min_participants": 15, "max_participants": 2},
            {"min_participants": True},
            {"valid_from": "2026-02-30"},
            {"valid_from": "2027-01-01", "valid_to": "2026-01-01"},
            {"unexpected": "value"})
        before = self.path.read_bytes()
        for change in changes:
            with self.subTest(change=change):
                status, result = self.checkout(**change)
                self.assertEqual(status, 400)
                self.assertIn("error", result)
                self.assertEqual(self.path.read_bytes(), before)
        status, result = self.checkout(items=[{**visit_item, "id": "missing"}])
        self.assertEqual(status, 404)
        self.assertIn("error", result)
        self.assertEqual(self.path.read_bytes(), before)

    def test_archived_cart_dependency_never_creates_partial_records(self):
        self.catalog.archive("services", self.service["id"], 1)
        before = self.path.read_bytes()
        status, result = self.checkout()
        self.assertEqual(status, 400)
        self.assertIn("error", result)
        self.assertEqual(self.path.read_bytes(), before)


if __name__ == "__main__":
    unittest.main()
