import json
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from http.client import HTTPConnection
from http.server import ThreadingHTTPServer
from pathlib import Path
from threading import Thread

from catalog import Catalog
from models import AtomicAttraction, DomainError, VisitProduct, parse_model
from server import handler_for
from storage import JsonStore


class Tests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.path = Path(temporary.name) / "catalog.json"
        self.catalog = Catalog(JsonStore(self.path))
        self.attraction = self.catalog.save("attractions", {
            "name": "Katedra", "description": "Atom", "location": "Wawel"})

    def visit(self, **changes):
        body = {"name": "Zwiedzanie", "description": "Opis", "attraction_id": self.attraction["id"],
                "mode": "guided", "duration_minutes": 60, "admission_included": True}
        body.update(changes)
        return self.catalog.save("visits", body)

    def package(self, kind, identity):
        return self.catalog.save("packages", {"name": "Pakiet", "description": "Skład",
            "items": [{"kind": kind, "id": identity, "quantity": 1}]})

    def offer(self, kind, identity, **changes):
        body = {"name": "Oferta", "description": "Opis", "target": {"kind": kind, "id": identity}}
        body.update(changes)
        return self.catalog.save("offers", body)

    def test_explicit_models(self):
        self.assertIsInstance(parse_model("attractions", {"name": "A", "description": "D", "location": "L"}), AtomicAttraction)
        with self.assertRaises(DomainError):
            parse_model("attractions", {"name": "A", "description": "D", "location": "L", "items": []})

    def test_same_atom_multiple_products_and_offers(self):
        first = self.visit()
        second = self.visit(mode="self_guided")
        self.offer("visit", first["id"])
        self.offer("visit", first["id"], audience="group", min_participants=2, max_participants=30)
        self.offer("visit", second["id"])
        self.assertEqual(len(self.catalog.list("attractions")), 1)
        self.assertEqual(len(self.catalog.list("visits")), 2)
        self.assertEqual(len(self.catalog.list("offers")), 3)

    def test_unknown_references_and_invalid_kinds(self):
        with self.assertRaises(DomainError):
            self.visit(attraction_id="missing")
        with self.assertRaises(DomainError):
            self.offer("attraction", self.attraction["id"])

    def test_atom_closure_blocks_all_linked_offers(self):
        visit = self.visit()
        package = self.package("visit", visit["id"])
        first = self.offer("package", package["id"])
        second = self.offer("visit", visit["id"])
        self.catalog.save("attractions", {"expected_version": 1, "closures": [
            {"start": "2026-11-01", "end": "2026-11-03", "reason": "Prace"}]}, self.attraction["id"])
        for offer in (first, second):
            self.assertFalse(self.catalog.availability(offer["id"], "2026-11-03")["available"])
            self.assertTrue(self.catalog.availability(offer["id"], "2026-11-04")["available"])

    def test_snapshot_includes_atom_and_old_package_composition(self):
        visit = self.visit()
        package = self.package("visit", visit["id"])
        offer = self.offer("package", package["id"])
        self.catalog.save("attractions", {"expected_version": 1, "name": "Nowa nazwa"}, self.attraction["id"])
        self.catalog.save("offers", {"expected_version": 1, "description": "Nowa wersja"}, offer["id"])
        old, new = self.catalog.history("offers", offer["id"])
        self.assertEqual(old["snapshot"]["item_snapshots"][0]["snapshot"]["attraction_snapshot"]["name"], "Katedra")
        self.assertEqual(new["snapshot"]["item_snapshots"][0]["snapshot"]["attraction_snapshot"]["name"], "Nowa nazwa")

    def test_package_cycles_and_duplicate_items(self):
        visit = self.visit()
        first = self.package("visit", visit["id"])
        second = self.package("package", first["id"])
        before = self.path.read_bytes()
        with self.assertRaises(DomainError):
            self.catalog.save("packages", {"expected_version": 1,
                "items": [{"kind": "package", "id": second["id"], "quantity": 1}]}, first["id"])
        self.assertEqual(self.path.read_bytes(), before)
        with self.assertRaises(DomainError):
            self.catalog.save("packages", {"name": "P", "description": "D", "items": [
                {"kind": "visit", "id": visit["id"]}, {"kind": "visit", "id": visit["id"]}]})

    def test_service_without_attraction(self):
        service = self.catalog.save("services", {"name": "Transfer", "description": "D", "service_type": "transfer"})
        offer = self.offer("service", service["id"])
        self.assertTrue(self.catalog.availability(offer["id"], "2026-11-03")["available"])

    def test_validation(self):
        for values in [{"duration_minutes": True}, {"mode": "exterior", "admission_included": True}]:
            with self.subTest(values=values), self.assertRaises(DomainError):
                self.visit(**values)
        visit = self.visit()
        for values in [{"valid_from": "2026-02-30"}, {"min_participants": 5},
                       {"valid_from": "2027-01-01", "valid_to": "2026-01-01"}]:
            with self.subTest(values=values), self.assertRaises(DomainError):
                self.offer("visit", visit["id"], **values)

    def test_conflict_and_archival(self):
        visit = self.visit()
        offer = self.offer("visit", visit["id"])
        self.catalog.save("attractions", {"expected_version": 1, "name": "Nowa"}, self.attraction["id"])
        with self.assertRaises(DomainError) as caught:
            self.catalog.save("attractions", {"expected_version": 1, "name": "Stara"}, self.attraction["id"])
        self.assertEqual(caught.exception.status, 409)
        self.catalog.archive("attractions", self.attraction["id"], 2)
        self.assertFalse(self.catalog.availability(offer["id"], "2026-11-03")["available"])
        self.assertEqual(len(self.catalog.history("attractions", self.attraction["id"])), 2)
        with self.assertRaises(DomainError):
            self.offer("visit", visit["id"])

    def test_persistence_corruption_and_parallel_writes(self):
        self.assertEqual(Catalog(JsonStore(self.path)).get("attractions", self.attraction["id"])["name"], "Katedra")
        with ThreadPoolExecutor(max_workers=4) as pool:
            list(pool.map(lambda _: self.visit(), range(10)))
        self.assertEqual(len(self.catalog.list("visits")), 10)
        self.path.write_text("broken")
        with self.assertRaises(RuntimeError):
            self.visit()
        self.assertEqual(self.path.read_text(), "broken")

    def test_http_end_to_end(self):
        server = ThreadingHTTPServer(("127.0.0.1", 0), handler_for(self.catalog))
        Thread(target=server.serve_forever, daemon=True).start()
        self.addCleanup(server.server_close); self.addCleanup(server.shutdown)
        connection = HTTPConnection(*server.server_address, timeout=5)
        self.addCleanup(connection.close)
        def req(method, path, body=None):
            connection.request(method, path, json.dumps(body) if body is not None else None,
                               {"Content-Type": "application/json"})
            response = connection.getresponse()
            return response.status, json.loads(response.read())
        code, visit = req("POST", "/visits", {"name": "Zwiedzanie", "description": "D",
            "attraction_id": self.attraction["id"], "mode": "audio", "duration_minutes": 20,
            "admission_included": False})
        self.assertEqual(code, 201)
        code, offer = req("POST", "/offers", {"name": "Oferta", "description": "D", "target": {"kind": "visit", "id": visit["id"]}})
        self.assertEqual(code, 201)
        self.assertEqual(req("GET", "/attractions")[0], 200)
        self.assertEqual(req("PATCH", "/offers/" + offer["id"], {"expected_version": 1, "name": "Nowa"})[0], 200)
        self.assertEqual(len(req("GET", "/offers/" + offer["id"] + "/versions")[1]), 2)
        self.assertTrue(req("GET", "/offers/" + offer["id"] + "/availability?date=2026-11-03")[1]["available"])
        self.assertEqual(req("DELETE", "/offers/" + offer["id"], {"expected_version": 2})[0], 200)
        self.assertEqual(req("GET", "/visits/missing")[0], 404)


if __name__ == "__main__":
    unittest.main()
