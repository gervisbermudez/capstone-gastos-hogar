"""Canal de sesión, bandeja y el aislamiento entre personas."""

from __future__ import annotations

import asyncio
import json
import sys
from contextlib import asynccontextmanager
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

RAIZ = Path(__file__).resolve().parent.parent
if str(RAIZ) not in sys.path:
    sys.path.insert(0, str(RAIZ))

from app import repositorio
from app.auth import emitir_token
from app.canal import Sala, canal_usuario, emitir
from app.rutas_notificaciones import router
from app.worker import DONE, guardar
from tests.redis_memoria import RedisMemoria

SECRETO = "secreto-de-test-sesion-con-32-bytes"
ORIGEN = "http://localhost:5173"


def _entorno(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.setenv("SQLITE_PATH", str(tmp_path / "gastos.db"))
    monkeypatch.setenv("JWT_SECRET", SECRETO)
    monkeypatch.setenv("FRONTEND_ORIGIN", ORIGEN)


class _Socket:
    def __init__(self) -> None:
        self.enviados: list[dict] = []

    async def send_json(self, data: dict) -> None:
        self.enviados.append(data)


def test_emitir_no_duplica_la_fila(tmp_path, monkeypatch) -> None:
    _entorno(monkeypatch, tmp_path)

    async def caso() -> None:
        user_id = await repositorio.crear_usuario("ana@example.com", "hash-de-test")
        redis = RedisMemoria()
        aviso = {
            "titulo": "Listo",
            "cuerpo": "una",
            "accion": {"etiqueta": "Ver", "ruta": "/chat"},
        }
        primera = await emitir(
            redis,
            user_id=user_id,
            tipo="chat.estado",
            recurso={"clase": "job", "id": "job-1"},
            payload={"job_id": "job-1"},
            notificacion=aviso,
            dedupe=f"{user_id}:chat.estado:job:job-1:DONE",
        )
        segunda = await emitir(
            redis,
            user_id=user_id,
            tipo="chat.estado",
            recurso={"clase": "job", "id": "job-1"},
            payload={"job_id": "job-1"},
            notificacion=aviso,
            dedupe=f"{user_id}:chat.estado:job:job-1:DONE",
        )
        assert primera["notificacion"]["id"] == segunda["notificacion"]["id"]
        assert len(redis.publicados) == 2
        lista = await repositorio.listar_notificaciones(user_id=user_id)
        assert lista["no_leidas"] == 1
        assert len(lista["items"]) == 1

    asyncio.run(caso())


def test_chat_done_avisa_con_ruta_al_hilo(tmp_path, monkeypatch) -> None:
    _entorno(monkeypatch, tmp_path)

    async def caso() -> None:
        user_id = await repositorio.crear_usuario("bea@example.com", "hash-de-test")
        redis = RedisMemoria()
        job = {
            "job_id": "job-chat",
            "status": DONE,
            "thread_id": "hilo-7",
            "result": "El total de marzo es 10.00",
            "user_id": user_id,
        }
        await guardar(redis, job)
        await guardar(redis, job)
        lista = await repositorio.listar_notificaciones(user_id=user_id)
        assert len(lista["items"]) == 1
        item = lista["items"][0]
        assert item["tipo"] == "chat.estado"
        assert item["accion"]["etiqueta"] == "Ver respuesta"
        assert item["accion"]["ruta"] == "/chat?hilo=hilo-7"
        assert "10.00" in item["cuerpo"]
        eventos = [
            json.loads(mensaje)["tipo"]
            for canal, mensaje in redis.publicados
            if canal == canal_usuario(user_id)
        ]
        assert eventos == ["chat.estado", "chat.estado"]

    asyncio.run(caso())


def test_borrar_la_cuenta_tambien_borra_la_bandeja(tmp_path, monkeypatch) -> None:
    _entorno(monkeypatch, tmp_path)

    async def caso() -> None:
        user_id = await repositorio.crear_usuario("dora@example.com", "hash-de-test")
        redis = RedisMemoria()
        await emitir(
            redis,
            user_id=user_id,
            tipo="chat.estado",
            recurso={"clase": "job", "id": "job-baja"},
            payload={"job_id": "job-baja"},
            notificacion={
                "titulo": "Listo",
                "cuerpo": "una",
                "accion": {"etiqueta": "Ver", "ruta": "/chat"},
            },
            dedupe=f"{user_id}:chat.estado:job:job-baja:DONE",
        )
        await repositorio.eliminar_usuario(user_id=user_id)
        assert await repositorio.buscar_usuario_por_id(user_id) is None

    asyncio.run(caso())


def test_la_sala_no_entrega_el_evento_de_otra_persona() -> None:
    async def caso() -> None:
        redis = RedisMemoria()
        sala = Sala()
        await sala.arrancar(redis)
        ana = _Socket()
        bea = _Socket()
        try:
            await sala.unir("ana", ana)
            await sala.unir("bea", bea)
            await redis.publish(
                canal_usuario("bea"),
                json.dumps({"id": "evt-1", "tipo": "chat.estado", "payload": {"job_id": "x"}}),
            )
            for _ in range(20):
                if bea.enviados:
                    break
                await asyncio.sleep(0.05)
            assert ana.enviados == []
            assert bea.enviados
            assert bea.enviados[0]["tipo"] == "chat.estado"
            assert bea.enviados[0]["payload"]["job_id"] == "x"
        finally:
            await sala.cerrar()

    asyncio.run(caso())


def test_el_socket_rechaza_otro_origen_y_un_token_ajeno(tmp_path, monkeypatch) -> None:
    _entorno(monkeypatch, tmp_path)

    async def alta() -> str:
        return await repositorio.crear_usuario("cata@example.com", "hash-de-test")

    user_id = asyncio.run(alta())
    token = emitir_token(user_id)

    @asynccontextmanager
    async def vida(aplicacion: FastAPI):
        redis = RedisMemoria()
        aplicacion.state.redis = redis
        sala = Sala()
        await sala.arrancar(redis)
        aplicacion.state.sala = sala
        try:
            yield
        finally:
            await sala.cerrar()

    aplicacion = FastAPI(lifespan=vida)
    aplicacion.include_router(router)

    with TestClient(aplicacion) as cliente:
        with pytest.raises(WebSocketDisconnect) as malo:
            with cliente.websocket_connect("/sesion/ws", headers={"origin": "http://otro"}) as socket:
                socket.receive_json()
        assert malo.value.code == 1008

        with pytest.raises(WebSocketDisconnect) as sin_token:
            with cliente.websocket_connect("/sesion/ws", headers={"origin": ORIGEN}) as socket:
                socket.send_text(json.dumps({"token": "no-es-jwt"}))
                socket.receive_json()
        assert sin_token.value.code == 4401

        ajeno = emitir_token("usuario-que-no-existe")
        with pytest.raises(WebSocketDisconnect) as de_otro:
            with cliente.websocket_connect("/sesion/ws", headers={"origin": ORIGEN}) as socket:
                socket.send_text(json.dumps({"token": ajeno}))
                socket.receive_json()
        assert de_otro.value.code == 4401

        with cliente.websocket_connect("/sesion/ws", headers={"origin": ORIGEN}) as socket:
            socket.send_text(json.dumps({"token": token}))
            assert socket.receive_json()["tipo"] == "listo"
