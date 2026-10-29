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

from app import db, repositorio
from app.auth import emitir_token
from app.canal import Sala, canal_usuario, emitir
from app.rutas_notificaciones import router
from app.worker import AWAITING_APPROVAL, DONE, FAILED, _notificacion_de_chat, guardar
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


def test_emitir_publica_aunque_falle_el_insert(tmp_path, monkeypatch) -> None:
    _entorno(monkeypatch, tmp_path)

    async def caso() -> None:
        redis = RedisMemoria()
        creado = await emitir(
            redis,
            user_id="usuario-inexistente",
            tipo="chat.estado",
            recurso={"clase": "job", "id": "job-1"},
            payload={"job_id": "job-1"},
            notificacion={
                "titulo": "Listo",
                "cuerpo": "una",
                "accion": {"etiqueta": "Ver", "ruta": "/chat"},
            },
            dedupe="usuario-inexistente:chat.estado:job:job-1:DONE",
        )
        assert creado["notificacion"] is None
        assert creado["creado_en"]
        assert len(redis.publicados) == 1
        canal, mensaje = redis.publicados[0]
        assert canal == canal_usuario("usuario-inexistente")
        evento = json.loads(mensaje)
        assert evento["notificacion"] is None
        assert evento["creado_en"] == creado["creado_en"]
        assert evento["tipo"] == "chat.estado"

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


def test_la_aprobacion_incluye_hilo_y_job(tmp_path, monkeypatch) -> None:
    _entorno(monkeypatch, tmp_path)

    async def caso() -> None:
        user_id = await repositorio.crear_usuario("eva@example.com", "hash-de-test")
        redis = RedisMemoria()
        job = {
            "job_id": "job-aprobar",
            "status": AWAITING_APPROVAL,
            "thread_id": "hilo-9",
            "result": "Falta tu decisión",
            "user_id": user_id,
        }
        await guardar(redis, job)
        lista = await repositorio.listar_notificaciones(user_id=user_id)
        assert len(lista["items"]) == 1
        ruta = lista["items"][0]["accion"]["ruta"]
        assert "hilo=" in ruta
        assert "job=" in ruta
        assert ruta == "/chat?hilo=hilo-9&job=job-aprobar"

        sin_hilo, _ = _notificacion_de_chat(
            {
                "status": AWAITING_APPROVAL,
                "user_id": user_id,
                "job_id": "job-aprobar",
                "thread_id": "",
            }
        )
        assert sin_hilo is not None
        assert sin_hilo["accion"]["ruta"] == "/chat?job=job-aprobar"

        fallo, _ = _notificacion_de_chat(
            {
                "status": FAILED,
                "user_id": user_id,
                "job_id": "job-aprobar",
                "thread_id": "hilo-9",
            }
        )
        assert fallo is not None
        assert fallo["accion"]["ruta"] == "/chat"

    asyncio.run(caso())


def test_marcar_cortadas_reencola_la_recibida_que_no_esta_en_la_cola() -> None:
    async def caso() -> None:
        from app.cargas import QUEUE_KEY, marcar_cortadas
        from app.cargas import guardar as guardar_carga
        from app.cargas import leer as leer_carga

        redis = RedisMemoria()
        await guardar_carga(
            redis,
            {
                "job_id": "job-fuera",
                "user_id": "ana",
                "fase": "recibida",
                "documento_id": None,
                "mensaje": None,
            },
        )
        await guardar_carga(
            redis,
            {
                "job_id": "job-en-cola",
                "user_id": "ana",
                "fase": "recibida",
                "documento_id": None,
                "mensaje": None,
            },
        )
        await redis.rpush(QUEUE_KEY, "job-en-cola")

        assert await marcar_cortadas(redis) == 0
        assert redis.listas[QUEUE_KEY].count("job-en-cola") == 1
        assert redis.listas[QUEUE_KEY].count("job-fuera") == 1
        fuera = await leer_carga(redis, "job-fuera")
        en_cola = await leer_carga(redis, "job-en-cola")
        assert fuera is not None and fuera["fase"] == "recibida"
        assert en_cola is not None and en_cola["fase"] == "recibida"

    asyncio.run(caso())


def test_marcar_leidas_deja_sin_leer_la_fila_posterior(tmp_path, monkeypatch) -> None:
    _entorno(monkeypatch, tmp_path)

    async def caso() -> None:
        user_id = await repositorio.crear_usuario("flor@example.com", "hash-de-test")
        primera = await repositorio.insertar_notificacion(
            user_id=user_id,
            tipo="chat.estado",
            titulo="Ya",
            cuerpo="una",
            accion_etiqueta=None,
            accion_ruta=None,
            recurso_clase="job",
            recurso_id="job-ya",
            dedupe=None,
        )
        futura = await repositorio.insertar_notificacion(
            user_id=user_id,
            tipo="chat.estado",
            titulo="Después",
            cuerpo="dos",
            accion_etiqueta=None,
            accion_ruta=None,
            recurso_clase="job",
            recurso_id="job-despues",
            dedupe=None,
        )
        async with db.conectar() as conn:
            await conn.execute(
                "UPDATE notificaciones SET creada_en = ? WHERE id = ?",
                ("2999-01-01T00:00:00+00:00", futura["id"]),
            )
        await repositorio.marcar_notificaciones_leidas(user_id=user_id)
        lista = await repositorio.listar_notificaciones(user_id=user_id)
        por_id = {item["id"]: item for item in lista["items"]}
        assert por_id[primera["id"]]["leida"] is True
        assert por_id[futura["id"]]["leida"] is False
        assert lista["no_leidas"] == 1

    asyncio.run(caso())


def test_limpiar_leidas_oculta_sin_revivir_el_aviso(tmp_path, monkeypatch) -> None:
    _entorno(monkeypatch, tmp_path)

    async def caso() -> None:
        mia = await repositorio.crear_usuario("gina@example.com", "hash-de-test")
        ajena = await repositorio.crear_usuario("hugo@example.com", "hash-de-test")
        redis = RedisMemoria()
        dedupe = f"{mia}:chat.estado:job:job-leida:DONE"
        aviso = {
            "titulo": "Listo",
            "cuerpo": "una",
            "accion": {"etiqueta": "Ver", "ruta": "/chat"},
        }
        primera = await emitir(
            redis,
            user_id=mia,
            tipo="chat.estado",
            recurso={"clase": "job", "id": "job-leida"},
            payload={"job_id": "job-leida"},
            notificacion=aviso,
            dedupe=dedupe,
        )
        pendiente = await repositorio.insertar_notificacion(
            user_id=mia,
            tipo="chat.estado",
            titulo="Pendiente",
            cuerpo="dos",
            accion_etiqueta=None,
            accion_ruta=None,
            recurso_clase="job",
            recurso_id="job-pendiente",
            dedupe=f"{mia}:chat.estado:job:job-pendiente:DONE",
        )
        futura = await repositorio.insertar_notificacion(
            user_id=mia,
            tipo="chat.estado",
            titulo="Después",
            cuerpo="tres",
            accion_etiqueta=None,
            accion_ruta=None,
            recurso_clase="job",
            recurso_id="job-futura",
            dedupe=None,
        )
        de_otro = await repositorio.insertar_notificacion(
            user_id=ajena,
            tipo="chat.estado",
            titulo="Ajena",
            cuerpo="cuatro",
            accion_etiqueta=None,
            accion_ruta=None,
            recurso_clase="job",
            recurso_id="job-ajena",
            dedupe=f"{ajena}:chat.estado:job:job-ajena:DONE",
        )
        notificacion_id = primera["notificacion"]["id"]
        await repositorio.marcar_notificacion_leida(user_id=mia, notificacion_id=notificacion_id)
        await repositorio.marcar_notificacion_leida(user_id=mia, notificacion_id=futura["id"])
        await repositorio.marcar_notificacion_leida(user_id=ajena, notificacion_id=de_otro["id"])
        async with db.conectar() as conn:
            await conn.execute(
                "UPDATE notificaciones SET leida_en = ? WHERE id = ?",
                ("2999-01-01T00:00:00+00:00", futura["id"]),
            )
        await repositorio.descartar_notificaciones_leidas(user_id=mia)
        lista = await repositorio.listar_notificaciones(user_id=mia)
        ids = {item["id"] for item in lista["items"]}
        assert notificacion_id not in ids
        assert pendiente["id"] in ids
        assert futura["id"] in ids
        assert lista["no_leidas"] == 1
        ajena_lista = await repositorio.listar_notificaciones(user_id=ajena)
        assert [item["id"] for item in ajena_lista["items"]] == [de_otro["id"]]

        repetida = await emitir(
            redis,
            user_id=mia,
            tipo="chat.estado",
            recurso={"clase": "job", "id": "job-leida"},
            payload={"job_id": "job-leida"},
            notificacion=aviso,
            dedupe=dedupe,
        )
        assert repetida["notificacion"] is None
        lista = await repositorio.listar_notificaciones(user_id=mia)
        assert notificacion_id not in {item["id"] for item in lista["items"]}
        assert len(lista["items"]) == 2
        async with db.conectar() as conn:
            cursor = await conn.execute(
                "SELECT COUNT(*) FROM notificaciones WHERE dedupe = ?",
                (dedupe,),
            )
            fila = await cursor.fetchone()
        assert fila is not None
        assert int(fila[0]) == 1

    asyncio.run(caso())


def test_limpiar_leidas_por_http(tmp_path, monkeypatch) -> None:
    _entorno(monkeypatch, tmp_path)

    async def alta() -> str:
        user_id = await repositorio.crear_usuario("iris@example.com", "hash-de-test")
        leida = await repositorio.insertar_notificacion(
            user_id=user_id,
            tipo="chat.estado",
            titulo="Ya",
            cuerpo="una",
            accion_etiqueta=None,
            accion_ruta=None,
            recurso_clase="job",
            recurso_id="job-ya",
            dedupe=None,
        )
        await repositorio.insertar_notificacion(
            user_id=user_id,
            tipo="chat.estado",
            titulo="Pendiente",
            cuerpo="dos",
            accion_etiqueta=None,
            accion_ruta=None,
            recurso_clase="job",
            recurso_id="job-pendiente",
            dedupe=None,
        )
        await repositorio.marcar_notificacion_leida(user_id=user_id, notificacion_id=leida["id"])
        return user_id

    user_id = asyncio.run(alta())
    token = emitir_token(user_id)
    aplicacion = FastAPI()
    aplicacion.include_router(router)

    with TestClient(aplicacion) as cliente:
        assert cliente.delete("/notificaciones/leidas").status_code == 401
        ok = cliente.delete(
            "/notificaciones/leidas",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert ok.status_code == 204
        lista = cliente.get(
            "/notificaciones",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert lista.status_code == 200
        cuerpo = lista.json()
        assert [item["titulo"] for item in cuerpo["items"]] == ["Pendiente"]
        assert cuerpo["items"][0]["leida"] is False
        assert cuerpo["no_leidas"] == 1


def test_una_bandeja_vieja_puede_limpiarse(tmp_path, monkeypatch) -> None:
    import sqlite3

    _entorno(monkeypatch, tmp_path)
    with sqlite3.connect(tmp_path / "gastos.db") as conn:
        conn.execute(
            """
            CREATE TABLE usuarios (
                user_id TEXT PRIMARY KEY,
                email TEXT NOT NULL UNIQUE,
                password_hash TEXT NOT NULL
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE notificaciones (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                tipo TEXT NOT NULL,
                titulo TEXT NOT NULL,
                cuerpo TEXT NOT NULL,
                accion_etiqueta TEXT,
                accion_ruta TEXT,
                recurso_clase TEXT,
                recurso_id TEXT,
                dedupe TEXT,
                leida_en TEXT,
                creada_en TEXT NOT NULL
            )
            """
        )

    async def caso() -> None:
        user_id = await repositorio.crear_usuario("vieja@example.com", "hash-de-test")
        creada = await repositorio.insertar_notificacion(
            user_id=user_id,
            tipo="chat.estado",
            titulo="Sigue",
            cuerpo="una",
            accion_etiqueta=None,
            accion_ruta=None,
            recurso_clase="job",
            recurso_id="job-viejo",
            dedupe=None,
        )
        await repositorio.marcar_notificacion_leida(user_id=user_id, notificacion_id=creada["id"])
        await repositorio.descartar_notificaciones_leidas(user_id=user_id)
        lista = await repositorio.listar_notificaciones(user_id=user_id)
        assert lista["items"] == []
        assert lista["no_leidas"] == 0

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
