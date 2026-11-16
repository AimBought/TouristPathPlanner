"""Operacje domenowe na jawnych modelach i relacjach między nimi."""
from copy import deepcopy
from dataclasses import asdict
from datetime import datetime, timezone
from uuid import uuid4

from models import (MODELS, REF_COLLECTION, DomainError, Reference, check, iso_date, parse_model)


def get_record(data, collection, identity):
    check(collection in MODELS, "Nieznana kolekcja")
    if identity not in data[collection]:
        raise DomainError("Nie znaleziono obiektu: " + identity, 404)
    return data[collection][identity]


def current(data, collection, identity):
    return get_record(data, collection, identity)["versions"][-1]


def active(data, collection, identity):
    item = get_record(data, collection, identity)
    check(not item["archived"], "Obiekt jest zarchiwizowany: " + identity)
    return item["versions"][-1]


class Catalog:
    def __init__(self, store):
        self.store = store

    def _validate_links(self, data, collection, identity, model):
        if collection == "visits":
            active(data, "attractions", model.attraction_id)
        if collection == "offers":
            # Graf zawierania: różne produkty mogą wskazywać tę samą atrakcję.
            def walk(ref, path):
                check((ref.kind, ref.id) not in path, "Cykl w składzie ofert")
                target_collection = REF_COLLECTION[ref.kind]
                if target_collection == "offers" and ref.id == identity:
                    children = model.items
                else:
                    target = active(data, target_collection, ref.id)
                    children = target["items"] if ref.kind == "offer" else []
                    children = [Reference(x["kind"], x["id"]) for x in children]
                for child in children:
                    walk(child, path | {(ref.kind, ref.id)})
            walk(Reference("offer", identity), set())
        if collection == "packages":
            self._snapshot(data, model.target)

    def _snapshot(self, data, ref):
        collection = REF_COLLECTION[ref.kind]
        result = deepcopy(active(data, collection, ref.id))
        result["kind"] = ref.kind
        if ref.kind == "visit":
            result["attraction_snapshot"] = deepcopy(active(data, "attractions", result["attraction_id"]))
        if ref.kind == "offer":
            result["item_snapshots"] = [
                {"quantity": item["quantity"], "snapshot": self._snapshot(data, Reference(item["kind"], item["id"]))}
                for item in result["items"]]
        return result

    def save(self, collection, payload, identity=None):
        check(collection in MODELS, "Nieznana kolekcja")
        check(isinstance(payload, dict), "Wymagany obiekt JSON")
        def operation(data):
            object_id = identity or str(uuid4())
            if identity is None:
                item = {"archived": False, "versions": []}
                body = deepcopy(payload)
            else:
                item = get_record(data, collection, identity)
                previous = active(data, collection, identity)
                expected = payload.get("expected_version")
                if type(expected) is not int or expected != previous["version"]:
                    raise DomainError("Konflikt wersji. Podaj aktualne expected_version.", 409)
                body = {key: deepcopy(value) for key, value in previous.items()
                        if key not in {"id", "version", "saved_at", "snapshot"}}
                body.update({key: deepcopy(value) for key, value in payload.items() if key != "expected_version"})
            model = parse_model(collection, body)
            self._validate_links(data, collection, object_id, model)
            result = asdict(model)
            result.update(id=object_id, version=len(item["versions"]) + 1,
                          saved_at=datetime.now(timezone.utc).isoformat())
            if collection == "packages":
                result["snapshot"] = self._snapshot(data, model.target)
            item["versions"].append(result)
            data[collection][object_id] = item
            return result
        return self.store.transaction(operation)

    def list(self, collection):
        check(collection in MODELS, "Nieznana kolekcja")
        return [dict(item["versions"][-1], archived=item["archived"])
                for item in self.store.read()[collection].values()]

    def get(self, collection, identity, version=None):
        item = get_record(self.store.read(), collection, identity)
        if version is None:
            return dict(item["versions"][-1], archived=item["archived"])
        for body in item["versions"]:
            if body["version"] == version:
                return body
        raise DomainError("Nie znaleziono wersji", 404)

    def history(self, collection, identity):
        return get_record(self.store.read(), collection, identity)["versions"]

    def archive(self, collection, identity, expected_version):
        def operation(data):
            item = get_record(data, collection, identity)
            if type(expected_version) is not int or item["versions"][-1]["version"] != expected_version:
                raise DomainError("Konflikt wersji", 409)
            check(not item["archived"], "Obiekt jest już zarchiwizowany")
            item["archived"] = True
            item["archived_at"] = datetime.now(timezone.utc).isoformat()
            return {"id": identity, "archived": True}
        return self.store.transaction(operation)

    def availability(self, identity, at):
        iso_date(at)
        data = self.store.read()
        item = get_record(data, "packages", identity)
        package = item["versions"][-1]
        status = ("archived" if item["archived"] else
                  "planned" if package["valid_from"] and at < package["valid_from"] else
                  "expired" if package["valid_to"] and at > package["valid_to"] else "current")
        reasons = [] if status == "current" else ["Status pakietu: " + status]
        seen = set()
        def inspect(collection, snapshot):
            key = (collection, snapshot["id"])
            if key in seen:
                return
            seen.add(key)
            item = get_record(data, collection, snapshot["id"])
            if item["archived"]:
                reasons.append("Zarchiwizowano: " + snapshot["name"])
            for closure in item["versions"][-1].get("closures", []):
                if closure["start"] <= at <= closure["end"]:
                    reasons.append(snapshot["name"] + ": " + closure["reason"])
        def walk(snapshot):
            inspect(REF_COLLECTION[snapshot["kind"]], snapshot)
            if snapshot["kind"] == "visit":
                inspect("attractions", snapshot["attraction_snapshot"])
            for child in snapshot.get("item_snapshots", []):
                walk(child["snapshot"])
        walk(package["snapshot"])
        return {"package_id": identity, "date": at, "status": status,
                "available": not reasons, "reasons": reasons}
