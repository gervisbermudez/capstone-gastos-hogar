"""Catálogo de categorías del hogar.

Cualquier miembro lista. Crear, editar y borrar es del administrador.
El nombre se puede asignar al confirmar o corregir un gasto. Borrar o
renombrar una fila no reescribe los comprobantes ya guardados.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import Response

from . import repositorio
from .auth import usuario_actual
from .esquemas import CategoriaCatalogo, CategoriaItem, ListaCategorias

router = APIRouter(tags=["categorias"])

_NOMBRE_REPETIDO = "Ya existe una categoría con ese nombre"
_NO_ENCONTRADA = "No existe esa categoría"
_NO_HOGAR = "No existe ese hogar"
_PROHIBIDO = "No tenés permiso para esa acción."


def _user_id(usuario: dict) -> str:
    return usuario["user_id"]


async def _contexto_hogar(request: Request, user_id: str) -> tuple[str, str]:
    """Header ``X-Hogar-Id`` o el hogar que administra. 404 si no es miembro."""
    crudo = request.headers.get("x-hogar-id")
    pedido = crudo.strip() if isinstance(crudo, str) else ""
    if pedido:
        hogar_id: str | None = pedido
    else:
        hogar_id = await repositorio.hogar_por_defecto(user_id)
    if not hogar_id:
        raise HTTPException(status_code=404, detail=_NO_HOGAR)
    rol = await repositorio.membresia(user_id, hogar_id)
    if rol is None:
        raise HTTPException(status_code=404, detail=_NO_HOGAR)
    return hogar_id, rol


def _exigir_administrador(rol: str) -> None:
    if rol != "administrador":
        raise HTTPException(status_code=403, detail=_PROHIBIDO)


@router.get("/categorias", response_model=ListaCategorias)
async def listar_categorias(
    request: Request,
    usuario: dict = Depends(usuario_actual),
) -> ListaCategorias:
    user_id = _user_id(usuario)
    hogar_id, _rol = await _contexto_hogar(request, user_id)
    items = await repositorio.listar_categorias(user_id=user_id, hogar_id=hogar_id)
    return ListaCategorias.model_validate({"items": items})


@router.post("/categorias", status_code=201, response_model=CategoriaItem)
async def crear_categoria(
    body: CategoriaCatalogo,
    request: Request,
    usuario: dict = Depends(usuario_actual),
) -> CategoriaItem:
    user_id = _user_id(usuario)
    hogar_id, rol = await _contexto_hogar(request, user_id)
    _exigir_administrador(rol)
    try:
        fila = await repositorio.crear_categoria(
            user_id=user_id,
            nombre=body.nombre,
            descripcion=body.descripcion,
            hogar_id=hogar_id,
        )
    except repositorio.NombreDuplicado:
        raise HTTPException(status_code=409, detail=_NOMBRE_REPETIDO) from None
    return CategoriaItem.model_validate(fila)


@router.patch("/categorias/{id}", response_model=CategoriaItem)
async def actualizar_categoria(
    id: str,
    body: CategoriaCatalogo,
    request: Request,
    usuario: dict = Depends(usuario_actual),
) -> CategoriaItem:
    user_id = _user_id(usuario)
    hogar_id, rol = await _contexto_hogar(request, user_id)
    _exigir_administrador(rol)
    try:
        fila = await repositorio.actualizar_categoria(
            user_id=user_id,
            categoria_id=id,
            nombre=body.nombre,
            descripcion=body.descripcion,
            hogar_id=hogar_id,
        )
    except repositorio.NombreDuplicado:
        raise HTTPException(status_code=409, detail=_NOMBRE_REPETIDO) from None
    if fila is None:
        raise HTTPException(status_code=404, detail=_NO_ENCONTRADA)
    return CategoriaItem.model_validate(fila)


@router.delete("/categorias/{id}", status_code=204)
async def borrar_categoria(
    id: str,
    request: Request,
    usuario: dict = Depends(usuario_actual),
) -> Response:
    user_id = _user_id(usuario)
    hogar_id, rol = await _contexto_hogar(request, user_id)
    _exigir_administrador(rol)
    if not await repositorio.borrar_categoria(
        user_id=user_id, categoria_id=id, hogar_id=hogar_id
    ):
        raise HTTPException(status_code=404, detail=_NO_ENCONTRADA)
    return Response(status_code=204)
