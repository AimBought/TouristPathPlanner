"""Jawne struktury domenowe. Dataclass definiuje schemat zapisywany w JSON."""
from dataclasses import dataclass, field
from datetime import date


class DomainError(Exception):
    def __init__(self, message, status=400):
        super().__init__(message)
        self.status = status


def check(condition, message):
    if not condition:
        raise DomainError(message)


def string(value, name):
    check(isinstance(value, str) and bool(value.strip()), f"{name}: wymagany niepusty tekst")


def iso_date(value):
    try:
        check(isinstance(value, str) and date.fromisoformat(value).isoformat() == value,
              "Wymagany format daty YYYY-MM-DD")
    except ValueError:
        raise DomainError("Nieprawidłowa data")


def period(start, end):
    for value in (start, end):
        if value is not None:
            iso_date(value)
    check(start is None or end is None or start <= end, "Koniec okresu jest przed początkiem")


@dataclass(frozen=True)
class Closure:
    start: str
    end: str
    reason: str

    def __post_init__(self):
        iso_date(self.start); iso_date(self.end)
        period(self.start, self.end)
        string(self.reason, "reason")


@dataclass(frozen=True)
class Reference:
    kind: str
    id: str

    def __post_init__(self):
        check(self.kind in {"visit", "service", "package"}, "kind: visit, service albo package")
        string(self.id, "id")


@dataclass(frozen=True)
class PackageItem(Reference):
    quantity: int = 1

    def __post_init__(self):
        super().__post_init__()
        check(type(self.quantity) is int and self.quantity > 0, "quantity musi być dodatnią liczbą całkowitą")


@dataclass(frozen=True)
class AtomicAttraction:
    """Niepodzielny punkt zwiedzania, niezależny od sposobu jego oferowania."""
    name: str
    description: str
    location: str
    category: str = "interior"
    tags: list[str] = field(default_factory=list)
    accessibility_note: str = "Brak informacji"
    stroller_allowed: bool | None = None
    large_luggage_allowed: bool | None = None
    closures: list[Closure] = field(default_factory=list)

    def __post_init__(self):
        for key in ("name", "description", "location", "accessibility_note"):
            string(getattr(self, key), key)
        check(self.category in {"interior", "outdoor", "passage"}, "Nieznana category atrakcji")
        check(isinstance(self.tags, list) and all(isinstance(x, str) and x.strip() for x in self.tags),
              "tags: lista niepustych tekstów")
        for value in (self.stroller_allowed, self.large_luggage_allowed):
            check(value is None or type(value) is bool, "Ograniczenia: true, false lub null")


@dataclass(frozen=True)
class VisitProduct:
    """Sposób zwiedzania jednej atrakcji. Wiele miejsc łączymy przez Package."""
    name: str
    description: str
    attraction_id: str
    mode: str
    duration_minutes: int
    admission_included: bool
    language: str = "pl"
    meeting_point: str = "Do ustalenia"

    def __post_init__(self):
        for key in ("name", "description", "attraction_id", "language", "meeting_point"):
            string(getattr(self, key), key)
        check(self.mode in {"guided", "self_guided", "audio", "exterior"}, "Nieznany mode zwiedzania")
        check(type(self.duration_minutes) is int and self.duration_minutes > 0, "Czas musi być dodatnią liczbą minut")
        check(type(self.admission_included) is bool, "admission_included wymaga true lub false")
        check(self.mode != "exterior" or not self.admission_included,
              "Oglądanie z zewnątrz nie może oznaczać wstępu do wnętrza")


@dataclass(frozen=True)
class AdditionalService:
    name: str
    description: str
    service_type: str
    details: dict = field(default_factory=dict)
    closures: list[Closure] = field(default_factory=list)

    def __post_init__(self):
        for key in ("name", "description", "service_type"):
            string(getattr(self, key), key)
        check(isinstance(self.details, dict), "details musi być obiektem JSON")


@dataclass(frozen=True)
class Package:
    name: str
    description: str
    items: list[PackageItem]

    def __post_init__(self):
        string(self.name, "name"); string(self.description, "description")
        check(bool(self.items), "Pakiet wymaga co najmniej jednego składnika")
        refs = [(x.kind, x.id) for x in self.items]
        check(len(refs) == len(set(refs)), "Powtórzony składnik; użyj quantity")


@dataclass(frozen=True)
class Offer:
    """Warunki zaoferowania jednego produktu albo gotowego pakietu."""
    name: str
    description: str
    target: Reference
    audience: str = "individual"
    min_participants: int = 1
    max_participants: int = 1
    valid_from: str | None = None
    valid_to: str | None = None

    def __post_init__(self):
        string(self.name, "name"); string(self.description, "description")
        check(self.audience in {"individual", "group"}, "audience: individual albo group")
        check(type(self.min_participants) is int and type(self.max_participants) is int
              and 0 < self.min_participants <= self.max_participants, "Nieprawidłowy zakres liczby uczestników")
        period(self.valid_from, self.valid_to)


MODELS = {"attractions": AtomicAttraction, "visits": VisitProduct,
          "services": AdditionalService, "packages": Package, "offers": Offer}
REF_COLLECTION = {"visit": "visits", "service": "services", "package": "packages"}


def parse_model(collection, body):
    """Zbuduj dataclass, odrzucając nieznane pola i wadliwe struktury zagnieżdżone."""
    check(isinstance(body, dict), "Wymagany obiekt JSON")
    data = dict(body)
    try:
        if "closures" in data:
            check(collection in {"attractions", "services"} and isinstance(data["closures"], list),
                  "closures dozwolone jako lista dla atrakcji i usług")
            data["closures"] = [Closure(**item) for item in data["closures"]]
        if collection == "packages":
            check(isinstance(data.get("items"), list), "items musi być listą")
            data["items"] = [PackageItem(**item) for item in data["items"]]
        if collection == "offers":
            check(isinstance(data.get("target"), dict), "target musi być referencją {kind, id}")
            data["target"] = Reference(**data["target"])
        return MODELS[collection](**data)
    except (TypeError, AttributeError) as exc:
        raise DomainError("Niepoprawna struktura: " + str(exc))
