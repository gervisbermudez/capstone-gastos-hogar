"""Redis mínimo para los tests del canal. No habla con la red."""

from __future__ import annotations

import asyncio
import fnmatch


class PubSubMemoria:
    def __init__(self) -> None:
        self.canales: set[str] = set()
        self.cola: asyncio.Queue[dict] = asyncio.Queue()

    async def subscribe(self, *canales: str) -> None:
        self.canales.update(canales)

    async def unsubscribe(self, *canales: str) -> None:
        for canal in canales:
            self.canales.discard(canal)

    async def _entregar(self, canal: str, mensaje: str) -> None:
        if canal in self.canales:
            await self.cola.put({"type": "message", "channel": canal, "data": mensaje})

    async def get_message(self, ignore_subscribe_messages: bool = False, timeout: float = 0.0):
        espera = timeout if timeout else 0.01
        try:
            return await asyncio.wait_for(self.cola.get(), timeout=espera)
        except TimeoutError:
            return None

    async def aclose(self) -> None:
        self.canales.clear()


class RedisMemoria:
    def __init__(self) -> None:
        self.datos: dict[str, str] = {}
        self.listas: dict[str, list[str]] = {}
        self.publicados: list[tuple[str, str]] = []
        self._subs: list[PubSubMemoria] = []

    def pubsub(self) -> PubSubMemoria:
        sub = PubSubMemoria()
        self._subs.append(sub)
        return sub

    async def publish(self, canal: str, mensaje: str) -> int:
        self.publicados.append((canal, mensaje))
        for sub in self._subs:
            await sub._entregar(canal, mensaje)
        return 1

    async def set(self, nombre: str, valor: str, nx: bool = False, ex: int | None = None):
        if nx and nombre in self.datos:
            return None
        self.datos[nombre] = valor
        return True

    async def get(self, nombre: str):
        return self.datos.get(nombre)

    async def delete(self, *nombres: str) -> int:
        borradas = 0
        for nombre in nombres:
            if nombre in self.datos:
                del self.datos[nombre]
                borradas += 1
        return borradas

    async def rpush(self, nombre: str, valor: str) -> int:
        self.listas.setdefault(nombre, []).append(valor)
        return len(self.listas[nombre])

    async def blpop(self, nombre: str, timeout: int = 0):
        lista = self.listas.get(nombre) or []
        if not lista:
            return None
        return nombre, lista.pop(0)

    async def lrange(self, nombre: str, inicio: int, fin: int) -> list[str]:
        # Redis incluye ``fin``. Un índice negativo cuenta desde el final.
        lista = self.listas.get(nombre) or []
        n = len(lista)
        if n == 0:
            return []
        if inicio < 0:
            inicio += n
        if fin < 0:
            fin += n
        if inicio < 0:
            inicio = 0
        if fin >= n:
            fin = n - 1
        if inicio > fin or inicio >= n:
            return []
        return list(lista[inicio : fin + 1])

    async def incr(self, nombre: str) -> int:
        valor = int(self.datos.get(nombre) or 0) + 1
        self.datos[nombre] = str(valor)
        return valor

    async def expire(self, nombre: str, segundos: int, nx: bool = False) -> bool:
        return True

    async def scan_iter(self, match: str | None = None):
        patron = match or "*"
        for nombre in list(self.datos):
            if fnmatch.fnmatch(nombre, patron):
                yield nombre
