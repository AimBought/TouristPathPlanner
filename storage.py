"""Zapis JSON z atomową podmianą pliku, dla jednego procesu serwera."""
import json
import os
import tempfile
from copy import deepcopy
from pathlib import Path
from threading import RLock

from models import MODELS


class JsonStore:
    def __init__(self, path):
        self.path = Path(path)
        self.lock = RLock()

    def _read(self):
        if not self.path.exists():
            return {"schema_version": 2, **{key: {} for key in MODELS}}
        try:
            data = json.loads(self.path.read_text(encoding="utf-8"))
            if data.get("schema_version") != 2 or any(not isinstance(data.get(key), dict) for key in MODELS):
                raise ValueError("Inna wersja schematu")
            return data
        except (ValueError, AttributeError) as exc:
            raise RuntimeError("Niepoprawny plik lub stary schemat. Plik nie został nadpisany.") from exc

    def read(self):
        with self.lock:
            return deepcopy(self._read())

    def transaction(self, operation):
        with self.lock:
            data = self._read()
            result = operation(data)
            self.path.parent.mkdir(parents=True, exist_ok=True)
            temporary = None
            try:
                with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=self.path.parent,
                                                 suffix=".tmp", delete=False) as handle:
                    temporary = handle.name
                    json.dump(data, handle, ensure_ascii=False, indent=2, allow_nan=False)
                    handle.write("\n"); handle.flush(); os.fsync(handle.fileno())
                os.replace(temporary, self.path)
            finally:
                if temporary and os.path.exists(temporary):
                    os.unlink(temporary)
            return deepcopy(result)
