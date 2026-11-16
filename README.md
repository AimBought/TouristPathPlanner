# Atrakcje atomowe, oferty i pakiety

Strona z widokiem klienta i admina oraz backend w Pythonie 3.10+, bez zewnętrznych bibliotek i bazy danych. Stan jest zapisany w `data/catalog.json` w UTF-8. Punktem wyjścia są jawne struktury w `models.py`, zdefiniowane jako klasy `dataclass`.

## Najważniejsze rozróżnienie

**Atrakcja atomowa** jest miejscem, **produkt zwiedzania** określa sposób zwiedzania tego miejsca, **oferta** łączy produkty i usługi, a **pakiet** określa warunki zaoferowania produktu lub oferty.

Przykład:

- Jedna atrakcja: wnętrze Katedry, z wyraźnym wyłączeniem wieży z jej zakresu.
- Dwa produkty wskazujące tę samą atrakcję: oprowadzanie i zwiedzanie samodzielne.
- Osobna atrakcja: Dzwon Zygmunta, z własnymi ograniczeniami i wyłączeniami.
- Oferta: oprowadzanie po wnętrzu Katedry + wejście na wieżę + transfer.
- Dwa pakiety zawierające tę samą ofertę: indywidualny i grupowy, z różnymi warunkami liczby uczestników.

Atomowość oznacza najmniejszą jednostkę, którą w tym modelu opisujemy i wyłączamy niezależnie. Granice atomów ustala zespół, tak aby ich opisy nie obejmowały niejawnie tych samych części. Nie muszą odpowiadać pojedynczemu biletowi. Program nie wnioskuje z nazw o nakładaniu się zakresów. Katedra i wieża w danych demonstracyjnych mają rozłączne opisy, mimo że są przestrzennie powiązane.

## Struktury

| Klasa i kolekcja JSON | Najważniejsze pola | Relacja |
|---|---|---|
| `AtomicAttraction` / `attractions` | name, description, location, category, tags, ograniczenia, closures | Nie zawiera innych atrakcji |
| `VisitProduct` / `visits` | attraction_id, mode, duration_minutes, admission_included, language, meeting_point | Dokładnie jedna atrakcja; wiele produktów może wskazywać ten sam atom |
| `AdditionalService` / `services` | service_type, details, closures | Usługa bez wymaganej atrakcji, np. transfer lub ubezpieczenie |
| `Offer` / `offers` | items | Zbiór produktów, usług i ewentualnie podofert |
| `Package` / `packages` | target, audience, min_participants, max_participants, valid_from, valid_to | Pakiet wskazuje ofertę, produkt lub usługę; ta sama oferta może wchodzić w skład wielu pakietów |
| `Reference` | kind, id | Jednoznaczna referencja do visit, service albo offer |
| `OfferItem` | kind, id, quantity | Składnik oferty z dodatnią ilością |
| `Closure` | start, end, reason | Czasowe wyłączenie atrakcji lub usługi |

`id`, `version` i `saved_at` dodaje katalog przy zapisie. Klasy reprezentują właściwą treść domenową, a powyższe pola metadane wersji. W JSON każda kolekcja jest mapą identyfikatorów do rekordów `{archived, versions}`. Każdy element `versions` zawiera pełną treść danej wersji.

Modele mają konkretne pola zamiast jednej uniwersalnej klasy produktu. `details` pozostaje elastyczne wyłącznie dla specyficznych cech usług dodatkowych. `service_type` może być dowolną niepustą nazwą, więc kolejny rodzaj usługi nie wymaga nowego katalogu.

## Uruchomienie

Rozpakuj archiwum. W terminalu folderu `oferty_atomowe`:

```bash
python server.py
```

Windows: można użyć `py server.py`, Linux/WSL: `python3 server.py`.

Otwórz w przeglądarce:

- http://127.0.0.1:8000/ — katalog klienta, koszyk i zapisane pakiety.
- http://127.0.0.1:8000/admin — zarządzanie katalogiem.

Klient dodaje do koszyka usługi, wizyty i gotowe oferty, ustala ilości i warunki udziału. Zatwierdzenie tworzy nową ofertę ze składem koszyka oraz powiązany pakiet z zamrożoną kopią oferty. Oba rekordy powstają w jednej transakcji; błąd nie zapisuje części wyniku. Roboczy koszyk pozostaje w pamięci przeglądarki po odświeżeniu. Zapisane pakiety można sprawdzać pod kątem dostępności na wybrany dzień.

Admin tworzy, edytuje i archiwizuje atrakcje, wizyty, usługi, oferty oraz pakiety. Formularze pozwalają zmieniać skład ofert i czasowe wyłączenia atrakcji lub usług. Edycja zachowuje wersjonowanie i ochronę przed konfliktem zapisu. Panel admina jest lokalnym widokiem bez logowania; API nie rozdziela uprawnień użytkowników. Serwer nasłuchuje tylko na `127.0.0.1`.

API JSON jest nadal dostępne:

- http://127.0.0.1:8000/attractions
- http://127.0.0.1:8000/visits
- http://127.0.0.1:8000/services
- http://127.0.0.1:8000/offers
- http://127.0.0.1:8000/packages

Dodawanie i edycję można wykonywać również klientem HTTP, np. PowerShellem albo Postmanem. Domyślny plik ma dane dydaktyczne: 3 atrakcje, 4 produkty zwiedzania, 2 usługi, 1 ofertę i 4 pakiety. Nie są to aktualne warunki sprzedaży Wawelu.

Aby zacząć z pustym katalogiem, użyj nowego pliku:

```bash
python server.py --data data/moj_katalog.json --port 8001
```

Nieistniejący plik powstanie przy pierwszym zapisie. `python seed.py` tworzy przykłady w pustym domyślnym katalogu; odmawia nadpisania katalogu zawierającego dane. Projekt obsługuje wyłącznie schemat 3: dawne pakiety nazywają się ofertami, a dawne oferty pakietami. Starsze schematy nie są automatycznie migrowane; użyj nowego pliku lub dołączonych danych.

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

### 4. Oferta przez POST /offers

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

`quantity` oznacza liczbę jednostek danego składnika w definicji oferty. Nie jest pulą miejsc ani mechanizmem rezerwacji. Uczestników opisuje osobno pakiet.

### 5. Pakiet przez POST /packages

```json
{
  "name": "Pakiet grupowy",
  "description": "Pakiet dla grupy od 2 do 30 osób",
  "target": {"kind": "offer", "id": "OFFER_ID"},
  "audience": "group",
  "min_participants": 2,
  "max_participants": 30,
  "valid_from": "2026-01-01",
  "valid_to": "2027-12-31"
}
```

Pakiet nie jest miejscem i nie zawiera ad hoc drugiej definicji oferty. Wieloskładnikowy zestaw najpierw zapisujemy jako `Offer`. Dla pojedynczego produktu wystarczy `target` o `kind: visit` albo `service`. Daty są włączne. Brak granicy (`null`) oznacza brak ograniczenia z tej strony.

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

Przy zapisie pakietu system zamraża jego cel w `snapshot`: kopiuje produkty, skład oferty i wszystkie wskazane atomy. Edycja atrakcji, produktu czy oferty nie zmienia starej treści pakietu. Edycja samego pakietu tworzy nową wersję oraz odświeża kopię celu do jego obecnego stanu.

Operacyjne zamknięcia działają niezależnie od zamrożonych opisów: sprawdzenie dostępności bierze bieżące `closures` i archiwizację atomów i usług. Dzięki temu zamknięcie Katedry blokuje wszystkie pakiety zawierające jej produkty, bez edytowania każdego pakietu osobno. Skład brany jest z kopii danego pakietu, więc późniejsza zmiana definicji oferty nie zmienia jego zakresu.

Jeden niedostępny składnik oznacza niedostępność całego pakietu. System nie usuwa go samodzielnie ani nie przelicza zastępstw. Zapytanie o datę przeszłą sprawdza obecną wiedzę o wyłączeniach; nie odtwarza historycznego stanu operacyjnego.

`DELETE` archiwizuje i zachowuje wersje. Archiwizacja dowolnego obiektu użytego w kopii pakietu powoduje niedostępność tego pakietu. Nowe pakiety nie mogą utrwalać archiwalnych zależności. Lista zwraca również obiekty archiwalne z flagą `archived`.

## API

`{collection}` to `attractions`, `visits`, `services`, `offers` albo `packages`.

| Metoda | Ścieżka | Wynik |
|---|---|---|
| GET | `/health` | Stan i kolekcje |
| GET | `/` albo `/admin` | Strona klienta albo panel admina |
| POST | `/packages/from-cart` | Utworzenie oferty i pakietu z koszyka w jednej transakcji |
| GET | `/{collection}` | Lista |
| GET | `/{collection}/{id}` | Bieżąca wersja i flaga archiwizacji |
| POST | `/{collection}` | Utworzenie struktury |
| PATCH | `/{collection}/{id}` | Nowa wersja, wymagane expected_version |
| DELETE | `/{collection}/{id}` | Archiwizacja, JSON z expected_version |
| GET | `/{collection}/{id}/versions` | Historia |
| GET | `/{collection}/{id}/versions/{version}` | Wybrana wersja |
| GET | `/packages/{id}/availability?date=2026-11-03` | Status, dostępność i przyczyny |

Domyślna data sprawdzenia to lokalna data komputera serwera. Statusy: `current`, `planned`, `expired`, `archived`. Status `current` nie oznacza dostępności przy czasowym wyłączeniu. Wyszukiwanie w stronie filtruje katalog pobrany do przeglądarki; API nie ma parametrów wyszukiwania.

`POST /packages/from-cart` przyjmuje `name`, `description`, `items` jak w ofercie oraz opcjonalne warunki pakietu: `audience`, `min_participants`, `max_participants`, `valid_from` i `valid_to`. Zwraca `{ "offer": {...}, "package": {...} }` ze statusem 201.

Błędy mają treść `{ "error": "opis" }`: 400 walidacja, 404 brak obiektu lub wersji, 409 konflikt, 413 limit treści, 500 problem zapisu lub odczytu.

## Szybki przykład w PowerShell

Po uruchomieniu API w osobnym terminalu:

```powershell
$atom = @{ name='Katedra'; description='Wnetrze bez wiezy'; location='Wawel' } | ConvertTo-Json
$a = Invoke-RestMethod http://127.0.0.1:8000/attractions -Method Post -ContentType 'application/json; charset=utf-8' -Body $atom
$visit = @{ name='Zwiedzanie'; description='Oprowadzanie'; attraction_id=$a.id; mode='guided'; duration_minutes=60; admission_included=$true } | ConvertTo-Json
$v = Invoke-RestMethod http://127.0.0.1:8000/visits -Method Post -ContentType 'application/json; charset=utf-8' -Body $visit
$offer = @{ name='Oferta zwiedzania'; description='Sklad oferty'; items=@(@{kind='visit'; id=$v.id; quantity=1}) } | ConvertTo-Json -Depth 5
$o = Invoke-RestMethod http://127.0.0.1:8000/offers -Method Post -ContentType 'application/json; charset=utf-8' -Body $offer
$package = @{ name='Pakiet'; description='Warunki indywidualne'; target=@{kind='offer'; id=$o.id} } | ConvertTo-Json -Depth 5
$p = Invoke-RestMethod http://127.0.0.1:8000/packages -Method Post -ContentType 'application/json; charset=utf-8' -Body $package
Invoke-RestMethod "http://127.0.0.1:8000/packages/$($p.id)/availability?date=2026-11-03"
```

## Demo i testy

```bash
python demo.py
python -m unittest discover -s tests -v
```

Demo pokazuje struktury, ich połączenia i wpływ zamknięcia atomu na pakiet. Pracuje w pliku tymczasowym i nie zmienia `data/catalog.json`. Testy także nie zmieniają danych projektu.

## Pliki i ograniczenia

- `models.py`: jawne struktury i walidacja ich pól.
- `catalog.py`: relacje, operacje, wersjonowanie, kopie i dostępność.
- `storage.py`: transakcje JSON z blokadą wątków i atomową podmianą pliku.
- `server.py`: lokalne API HTTP.
- `static/`: strona HTML, style CSS i JavaScript; bez instalacji zależności i kroku budowania.
- `seed.py`, `demo.py`: dane przykładowe i scenariusz demonstracyjny.

Jeden proces na plik danych. Równoległe żądania w jego obrębie są synchronizowane; kilka procesów nie ma wspólnej blokady. Nie edytuj pliku ręcznie podczas pracy serwera. Uszkodzony JSON lub schemat inny niż 3 powoduje błąd, nie automatyczny reset danych.

API nasłuchuje wyłącznie na 127.0.0.1. To backend dydaktyczny bez logowania, sprzedaży, rezerwacji, cen i planowania tras. Nie zawiera grafiku godzin otwarcia, cyklicznych reguł kalendarza ani silnika realizacji usług. Daty pakietów i listy czasowych wyłączeń stanowią zaimplementowany zakres dostępności.
