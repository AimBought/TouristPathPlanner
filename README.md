# Atrakcje atomowe i oferty

Backend w Pythonie 3.10+, bez zewnętrznych bibliotek i bazy danych. Stan jest zapisany w `data/catalog.json` w UTF-8. Punktem wyjścia są jawne struktury w `models.py`, zdefiniowane jako klasy `dataclass`.

## Najważniejsze rozróżnienie

**Atrakcja atomowa** jest miejscem, **produkt zwiedzania** określa sposób zwiedzania tego miejsca, **pakiet** łączy produkty i usługi, a **oferta** określa warunki zaoferowania produktu lub pakietu.

Przykład:

- Jedna atrakcja: wnętrze Katedry, z wyraźnym wyłączeniem wieży z jej zakresu.
- Dwa produkty wskazujące tę samą atrakcję: oprowadzanie i zwiedzanie samodzielne.
- Osobna atrakcja: Dzwon Zygmunta, z własnymi ograniczeniami i wyłączeniami.
- Pakiet: oprowadzanie po wnętrzu Katedry + wejście na wieżę + transfer.
- Dwie oferty tego samego pakietu: indywidualna i grupowa, z różnymi warunkami liczby uczestników.

Atomowość oznacza najmniejszą jednostkę, którą w tym modelu opisujemy i wyłączamy niezależnie. Granice atomów ustala zespół, tak aby ich opisy nie obejmowały niejawnie tych samych części. Nie muszą odpowiadać pojedynczemu biletowi. Program nie wnioskuje z nazw o nakładaniu się zakresów. Katedra i wieża w danych demonstracyjnych mają rozłączne opisy, mimo że są przestrzennie powiązane.

## Struktury

| Klasa i kolekcja JSON | Najważniejsze pola | Relacja |
|---|---|---|
| `AtomicAttraction` / `attractions` | name, description, location, category, tags, ograniczenia, closures | Nie zawiera innych atrakcji |
| `VisitProduct` / `visits` | attraction_id, mode, duration_minutes, admission_included, language, meeting_point | Dokładnie jedna atrakcja; wiele produktów może wskazywać ten sam atom |
| `AdditionalService` / `services` | service_type, details, closures | Usługa bez wymaganej atrakcji, np. transfer lub ubezpieczenie |
| `Package` / `packages` | items | Zbiór produktów, usług i ewentualnie podpakietów |
| `Offer` / `offers` | target, audience, min_participants, max_participants, valid_from, valid_to | Jedna oferta wskazuje jeden produkt, usługę lub pakiet; cel może mieć wiele ofert |
| `Reference` | kind, id | Jednoznaczna referencja do visit, service albo package |
| `PackageItem` | kind, id, quantity | Składnik pakietu z dodatnią ilością |
| `Closure` | start, end, reason | Czasowe wyłączenie atrakcji lub usługi |

`id`, `version` i `saved_at` dodaje katalog przy zapisie. Klasy reprezentują właściwą treść domenową, a powyższe pola metadane wersji. W JSON każda kolekcja jest mapą identyfikatorów do rekordów `{archived, versions}`. Każdy element `versions` zawiera pełną treść danej wersji.

Modele mają konkretne pola zamiast jednej uniwersalnej klasy produktu. `details` pozostaje elastyczne wyłącznie dla specyficznych cech usług dodatkowych. `service_type` może być dowolną niepustą nazwą, więc kolejny rodzaj usługi nie wymaga nowego katalogu.

## Uruchomienie

Rozpakuj archiwum. W terminalu folderu `oferty_atomowe`:

```bash
python server.py
```

Windows: można użyć `py server.py`, Linux/WSL: `python3 server.py`.

Odczyty można wykonywać z przeglądarki:

- http://127.0.0.1:8000/attractions
- http://127.0.0.1:8000/visits
- http://127.0.0.1:8000/services
- http://127.0.0.1:8000/packages
- http://127.0.0.1:8000/offers

To API JSON. Dodawanie i edycję wykonuj klientem HTTP, np. PowerShellem albo Postmanem. Domyślny plik ma dane dydaktyczne: 3 atrakcje, 4 produkty zwiedzania, 2 usługi, 1 pakiet i 4 oferty. Nie są to aktualne warunki sprzedaży Wawelu.

Aby zacząć z pustym katalogiem, użyj nowego pliku:

```bash
python server.py --data data/moj_katalog.json --port 8001
```

Nieistniejący plik powstanie przy pierwszym zapisie. `python seed.py` tworzy przykłady w pustym domyślnym katalogu; odmawia nadpisania katalogu zawierającego dane. Wcześniejsza wersja projektu używała schematu 1 z ogólnym `products`. Ten projekt używa schematu 2 z osobnymi strukturami. Starego JSON nie migruje automatycznie i go nie nadpisuje; użyj nowego pliku lub dołączonych danych.

## Przykładowe treści żądań

Identyfikatory `ATOM_ID`, `VISIT_ID` itd. są symbolami: zastąp je rzeczywistymi `id` zwróconymi przez API. Nie kopiuj symboli jako gotowych referencji. Dane demonstracyjne mają automatycznie generowane UUID.

### 1. Utworzenie atomu przez POST /attractions

```json
{
  "name": "Wnętrze Katedry",
  "description": "Wnętrze bez wieży dzwonniczej",
  "location": "Wawel",
  "category": "interior",
  "tags": ["historia", "religia"],
  "accessibility_note": "Sprawdź szczegółowe warunki wizyty",
  "stroller_allowed": null,
  "large_luggage_allowed": null,
  "closures": []
}
```

`null` oznacza brak informacji, a nie zakaz ani zgodę. Kategorie: `interior`, `outdoor`, `passage`. Kategorie opisują miejsce; nie uruchamiają algorytmu antyduplikacji.

### 2. Produkt zwiedzania przez POST /visits

```json
{
  "name": "Katedra z przewodnikiem",
  "description": "Oprowadzanie po wnętrzu",
  "attraction_id": "ATOM_ID",
  "mode": "guided",
  "duration_minutes": 60,
  "admission_included": true,
  "language": "pl",
  "meeting_point": "Uzgodniony punkt zbiórki"
}
```

Tryby: `guided`, `self_guided`, `audio`, `exterior`. Samo wspomnienie obiektu w nagraniu nie daje wstępu. `admission_included` opisuje zakres konkretnego produktu. Dla `exterior` musi być `false`. Ograniczenia miejsca przechowujemy na atomie; czas i sposób zwiedzania na produkcie.

### 3. Usługa przez POST /services

```json
{
  "name": "Transfer hotel Wawel",
  "description": "Dowóz do miejsca zwiedzania",
  "service_type": "transfer",
  "details": {"pickup": "Hotel", "destination": "Wawel"},
  "closures": []
}
```

### 4. Pakiet przez POST /packages

```json
{
  "name": "Katedra z transferem",
  "description": "Stały zestaw produktu i usługi",
  "items": [
    {"kind": "visit", "id": "VISIT_ID", "quantity": 1},
    {"kind": "service", "id": "SERVICE_ID", "quantity": 1}
  ]
}
```

`quantity` oznacza liczbę jednostek danego składnika w definicji pakietu. Nie jest pulą miejsc ani mechanizmem rezerwacji. Uczestników opisuje osobno oferta.

### 5. Oferta przez POST /offers

```json
{
  "name": "Pakiet grupowy",
  "description": "Oferta dla grupy od 2 do 30 osób",
  "target": {"kind": "package", "id": "PACKAGE_ID"},
  "audience": "group",
  "min_participants": 2,
  "max_participants": 30,
  "valid_from": "2026-01-01",
  "valid_to": "2027-12-31"
}
```

Oferta nie jest miejscem i nie zawiera ad hoc drugiej definicji pakietu. Wieloskładnikowy zestaw najpierw zapisujemy jako `Package`. Dla pojedynczego produktu wystarczy `target` o `kind: visit` albo `service`. Daty są włączne. Brak granicy (`null`) oznacza brak ograniczenia z tej strony.

## Edycja i historia

Każde utworzenie i edycja dowolnej struktury tworzy kolejną wersję. Użyj `PATCH /attractions/ID` z treścią np.:

```json
{
  "expected_version": 1,
  "closures": [
    {"start": "2026-11-03", "end": "2026-11-05", "reason": "Konserwacja"}
  ]
}
```

`expected_version` chroni przed zapisem opartej na nieaktualnej wersji edycji. Listy i obiekty wewnętrzne, np. `items`, `target` i `closures`, są zastępowane w całości, nie scalane element po elemencie.

Przy zapisie oferty system zamraża jej cel w `snapshot`: kopiuje produkty, skład pakietu i wszystkie wskazane atomy. Edycja atrakcji, produktu czy pakietu nie zmienia starej treści oferty. Edycja samej oferty tworzy nową wersję oraz odświeża kopię celu do jego obecnego stanu.

Operacyjne zamknięcia działają niezależnie od zamrożonych opisów: sprawdzenie dostępności bierze bieżące `closures` i archiwizację atomów i usług. Dzięki temu zamknięcie Katedry blokuje wszystkie oferty zawierające jej produkty, bez edytowania każdej oferty osobno. Skład brany jest z kopii danej oferty, więc późniejsza zmiana definicji pakietu nie zmienia jej zakresu.

Jeden niedostępny składnik oznacza niedostępność całego pakietu. System nie usuwa go samodzielnie ani nie przelicza zastępstw. Zapytanie o datę przeszłą sprawdza obecną wiedzę o wyłączeniach; nie odtwarza historycznego stanu operacyjnego.

`DELETE` archiwizuje i zachowuje wersje. Archiwizacja dowolnego obiektu użytego w kopii oferty powoduje niedostępność tej oferty. Nowe oferty nie mogą utrwalać archiwalnych zależności. Lista zwraca również obiekty archiwalne z flagą `archived`.

## API

`{collection}` to `attractions`, `visits`, `services`, `packages` albo `offers`.

| Metoda | Ścieżka | Wynik |
|---|---|---|
| GET | `/health` | Stan i kolekcje |
| GET | `/{collection}` | Lista |
| GET | `/{collection}/{id}` | Bieżąca wersja i flaga archiwizacji |
| POST | `/{collection}` | Utworzenie struktury |
| PATCH | `/{collection}/{id}` | Nowa wersja, wymagane expected_version |
| DELETE | `/{collection}/{id}` | Archiwizacja, JSON z expected_version |
| GET | `/{collection}/{id}/versions` | Historia |
| GET | `/{collection}/{id}/versions/{version}` | Wybrana wersja |
| GET | `/offers/{id}/availability?date=2026-11-03` | Status, dostępność i przyczyny |

Domyślna data sprawdzenia to lokalna data komputera serwera. Statusy: `current`, `planned`, `expired`, `archived`. Status `current` nie oznacza dostępności przy czasowym wyłączeniu. Brak wyszukiwarki i filtrowania.

Błędy mają treść `{ "error": "opis" }`: 400 walidacja, 404 brak obiektu lub wersji, 409 konflikt, 413 limit treści, 500 problem zapisu lub odczytu.

## Szybki przykład w PowerShell

Po uruchomieniu API w osobnym terminalu:

```powershell
$atom = @{ name='Katedra'; description='Wnetrze bez wiezy'; location='Wawel' } | ConvertTo-Json
$a = Invoke-RestMethod http://127.0.0.1:8000/attractions -Method Post -ContentType 'application/json; charset=utf-8' -Body $atom
$visit = @{ name='Zwiedzanie'; description='Oprowadzanie'; attraction_id=$a.id; mode='guided'; duration_minutes=60; admission_included=$true } | ConvertTo-Json
$v = Invoke-RestMethod http://127.0.0.1:8000/visits -Method Post -ContentType 'application/json; charset=utf-8' -Body $visit
$offer = @{ name='Oferta'; description='Warunki indywidualne'; target=@{kind='visit'; id=$v.id} } | ConvertTo-Json -Depth 5
$o = Invoke-RestMethod http://127.0.0.1:8000/offers -Method Post -ContentType 'application/json; charset=utf-8' -Body $offer
Invoke-RestMethod "http://127.0.0.1:8000/offers/$($o.id)/availability?date=2026-11-03"
```

## Demo i testy

```bash
python demo.py
python -m unittest discover -s tests -v
```

Demo pokazuje struktury, ich połączenia i wpływ zamknięcia atomu na ofertę. Pracuje w pliku tymczasowym i nie zmienia `data/catalog.json`. Testy także nie zmieniają danych projektu.

## Pliki i ograniczenia

- `models.py`: jawne struktury i walidacja ich pól.
- `catalog.py`: relacje, operacje, wersjonowanie, kopie i dostępność.
- `storage.py`: transakcje JSON z blokadą wątków i atomową podmianą pliku.
- `server.py`: lokalne API HTTP.
- `seed.py`, `demo.py`: dane przykładowe i scenariusz demonstracyjny.

Jeden proces na plik danych. Równoległe żądania w jego obrębie są synchronizowane; kilka procesów nie ma wspólnej blokady. Nie edytuj pliku ręcznie podczas pracy serwera. Uszkodzony JSON lub schemat 1 powoduje błąd, nie automatyczny reset danych.

API nasłuchuje wyłącznie na 127.0.0.1. To backend dydaktyczny bez logowania, sprzedaży, rezerwacji, cen i planowania tras. Nie zawiera grafiku godzin otwarcia, cyklicznych reguł kalendarza ani silnika realizacji usług. Daty ofert i listy czasowych wyłączeń stanowią zaimplementowany zakres dostępności.
