"""Scenariusz dydaktyczny; identyfikatory generuje katalog."""
from pathlib import Path

from catalog import Catalog
from storage import JsonStore


def seed(path):
    catalog = Catalog(JsonStore(path))
    if any(catalog.list(key) for key in ("attractions", "visits", "services", "offers", "packages")):
        raise ValueError("Katalog nie jest pusty; nie nadpisano danych")
    cathedral = catalog.save("attractions", {"name": "Katedra Wawelska",
        "description": "Wnętrze Katedry, bez wejścia na wieżę.", "location": "Wawel",
        "tags": ["historia", "religia"], "accessibility_note": "Warunki wymagają sprawdzenia"})
    bell = catalog.save("attractions", {"name": "Dzwon Zygmunta",
        "description": "Osobny punkt zwiedzania wieży.", "location": "Wawel",
        "accessibility_note": "Schody", "stroller_allowed": False})
    courtyard = catalog.save("attractions", {"name": "Dziedziniec Arkadowy",
        "description": "Przykładowa przestrzeń zewnętrzna.", "location": "Wawel", "category": "passage"})
    guided = catalog.save("visits", {"name": "Katedra z przewodnikiem", "description": "Wariant oprowadzania.",
        "attraction_id": cathedral["id"], "mode": "guided", "duration_minutes": 60,
        "admission_included": True})
    independent = catalog.save("visits", {"name": "Katedra samodzielnie", "description": "Inny produkt tego samego miejsca.",
        "attraction_id": cathedral["id"], "mode": "self_guided", "duration_minutes": 45,
        "admission_included": True})
    tower = catalog.save("visits", {"name": "Wejście na wieżę", "description": "Produkt zwiedzania wieży.",
        "attraction_id": bell["id"], "mode": "self_guided", "duration_minutes": 20,
        "admission_included": True})
    audio = catalog.save("visits", {"name": "Dziedziniec z nagraniem", "description": "Audio po przestrzeni zewnętrznej.",
        "attraction_id": courtyard["id"], "mode": "audio", "duration_minutes": 30,
        "admission_included": False})
    transfer = catalog.save("services", {"name": "Transfer hotel Wawel", "description": "Przykład usługi bez atrakcji.",
        "service_type": "transfer", "details": {"pickup": "Hotel", "destination": "Wawel"}})
    insurance = catalog.save("services", {"name": "Ubezpieczenie", "description": "Dydaktyczna usługa dodatkowa.",
        "service_type": "insurance", "details": {"coverage": "Zakres przykładowy"}})
    offer = catalog.save("offers", {"name": "Katedra i wieża z transferem", "description": "Zestaw produktów i usług.",
        "items": [{"kind": "visit", "id": guided["id"], "quantity": 1},
                  {"kind": "visit", "id": tower["id"], "quantity": 1},
                  {"kind": "service", "id": transfer["id"], "quantity": 1}]})
    individual = catalog.save("packages", {"name": "Pakiet indywidualny", "description": "Warunki indywidualne.",
        "target": {"kind": "offer", "id": offer["id"]},
        "valid_from": "2026-01-01", "valid_to": "2027-12-31"})
    group = catalog.save("packages", {"name": "Pakiet grupowy", "description": "Ta sama oferta, inny pakiet.",
        "target": {"kind": "offer", "id": offer["id"]}, "audience": "group",
        "min_participants": 2, "max_participants": 30,
        "valid_from": "2026-01-01", "valid_to": "2027-12-31"})
    catalog.save("packages", {"name": "Samodzielna Katedra", "description": "Pakiet jednego produktu.",
        "target": {"kind": "visit", "id": independent["id"]}})
    catalog.save("packages", {"name": "Ubezpieczenie osobno", "description": "Pakiet bez lokalizacji.",
        "target": {"kind": "service", "id": insurance["id"]}})
    return {"attraction_id": cathedral["id"], "visit_id": guided["id"],
            "offer_id": offer["id"], "package_id": individual["id"], "group_package_id": group["id"]}


if __name__ == "__main__":
    print(seed(Path(__file__).parent / "data" / "catalog.json"))
