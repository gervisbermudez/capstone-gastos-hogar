"""Bandeja y el WebSocket de la sesión. El token va en el primer mensaje."""

from __future__ import annotations

import asyncio

from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.responses import Response

from . import repositorio
from .auth import usuario_actual, usuario_de_saludo
from .canal import Sala, origen_del_socket
from .esquemas import ListaNotificaciones

router = APIRouter(tags=["notificaciones"])

_WS_ORIGEN = 1008
_WS_SESION = 4401
_PING_SEGUNDOS = 5.0


async def _cerrar(websocket: WebSocket, code: int) -> None:
    try:
        await websocket.close(code=code)
    except (RuntimeError, WebSocketDisconnect):
        return


@router.get("/notificaciones", response_model=ListaNotificaciones)
async def listar_notificaciones(
    usuario: dict = Depends(usuario_actual),
) -> ListaNotificaciones:
    cuerpo = await repositorio.listar_notificaciones(user_id=usuario["user_id"])
    return ListaNotificaciones.model_validate(cuerpo)


@router.post("/notificaciones/leidas", status_code=204)
async def marcar_todas(
    usuario: dict = Depends(usuario_actual),
) -> Response:
    await repositorio.marcar_notificaciones_leidas(user_id=usuario["user_id"])
    return Response(status_code=204)


@router.delete("/notificaciones/leidas", status_code=204)
async def limpiar_leidas(
    usuario: dict = Depends(usuario_actual),
) -> Response:
    await repositorio.descartar_notificaciones_leidas(user_id=usuario["user_id"])
    return Response(status_code=204)


@router.post("/notificaciones/{notificacion_id}/leida", status_code=204)
async def marcar_una(
    notificacion_id: str,
    usuario: dict = Depends(usuario_actual),
) -> Response:
    ok = await repositorio.marcar_notificacion_leida(
        user_id=usuario["user_id"],
        notificacion_id=notificacion_id,
    )
    if not ok:
        raise HTTPException(status_code=404, detail="No existe esa notificación")
    return Response(status_code=204)


@router.websocket("/sesion/ws")
async def socket_sesion(websocket: WebSocket) -> None:
    """Un socket por pestaña. El saludo es ``{"token": "..."}``."""
    if not origen_del_socket(websocket):
        await websocket.accept()
        await _cerrar(websocket, _WS_ORIGEN)
        return
    await websocket.accept()
    try:
        crudo = await asyncio.wait_for(websocket.receive_text(), timeout=5)
    except (TimeoutError, WebSocketDisconnect, RuntimeError):
        await _cerrar(websocket, _WS_SESION)
        return
    user_id = usuario_de_saludo(crudo)
    if user_id is None or await repositorio.buscar_usuario_por_id(user_id) is None:
        await _cerrar(websocket, _WS_SESION)
        return
    sala = getattr(websocket.app.state, "sala", None)
    if not isinstance(sala, Sala):
        await _cerrar(websocket, 1011)
        return
    unido = False
    try:
        await sala.unir(user_id, websocket)
        unido = True
        await websocket.send_json({"tipo": "listo"})
        while True:
            try:
                mensaje = await asyncio.wait_for(websocket.receive(), timeout=_PING_SEGUNDOS)
            except TimeoutError:
                await websocket.send_json({"tipo": "ping"})
                continue
            if isinstance(mensaje, dict) and mensaje.get("type") == "websocket.disconnect":
                return
    except (WebSocketDisconnect, RuntimeError):
        return
    finally:
        if unido:
            await sala.salir(user_id, websocket)
        await _cerrar(websocket, 1000)
