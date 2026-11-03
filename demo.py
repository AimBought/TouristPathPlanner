"""Pokaz struktur i zależności, bez serwera i bez zmiany danych użytkownika."""
import json
from pathlib import Path
from tempfile import TemporaryDirectory

from catalog import Catalog
from seed import seed
from storage import JsonStore


def show(label, data):
    print("\n" + label)
    print(json.dumps(data, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    with TemporaryDirectory() as folder:
        path = Path(folder) / "demo.json"
        ids = seed(path)
        catalog = Catalog(JsonStore(path))
        show("1. ATRAKCJA ATOMOWA", catalog.get("attractions", ids["attraction_id"]))
        show("2. PRODUKT ZWIEDZANIA", catalog.get("visits", ids["visit_id"]))
        show("3. PAKIET", catalog.get("packages", ids["package_id"]))
        offer = catalog.get("offers", ids["offer_id"])
        show("4. OFERTA (kopia danych jest w polu snapshot)", {key: value for key, value in offer.items() if key != "snapshot"})
        show("5. DOSTĘPNOŚĆ PRZED ZAMKNIĘCIEM", catalog.availability(ids["offer_id"], "2026-11-03"))
        catalog.save("attractions", {"expected_version": 1, "closures": [
            {"start": "2026-11-03", "end": "2026-11-05", "reason": "Konserwacja"}]}, ids["attraction_id"])
        show("6. DOSTĘPNOŚĆ PO ZAMKNIĘCIU ATOMU", catalog.availability(ids["offer_id"], "2026-11-03"))
        show("7. HISTORIA ATRAKCJI", [
            {"version": value["version"], "closures": value["closures"]}
            for value in catalog.history("attractions", ids["attraction_id"])])
        print("\nDemo zakończone. Plik tymczasowy usunięto; dane projektu nie zmieniły się.")
