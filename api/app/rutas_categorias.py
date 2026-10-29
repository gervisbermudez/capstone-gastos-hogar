"""Catálogo de categorías por persona.

El nombre se puede asignar al confirmar o corregir un gasto. Borrar o
renombrar una fila no reescribe los comprobantes ya guardados.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response

from . import repositorio
from .auth import usuario_actual
from .esquemas import CategoriaCatalogo, CategoriaItem, ListaCategorias

router = APIRouter(tags=["categorias"])

_NOMBRE_REPETIDO = "Ya existe una categoría con ese nombre"
_NO_ENCONTRADA = "No existe esa categoría"


def _user_id(usuario: dict) -> str:
    return usuario["user_id"]


@router.get("/categorias", response_model=ListaCategorias)
async def listar_categorias(usuario: dict = Depends(usuario_actual)) -> ListaCategorias:
    items = await repositorio.listar_categorias(user_id=_user_id(usuario))
    return ListaCategorias.model_validate({"items": items})


@router.post("/categorias", status_code=201, response_model=CategoriaItem)
async def crear_categoria(
    body: CategoriaCatalogo,
    usuario: dict = Depends(usuario_actual),
) -> CategoriaItem:
    try:
        fila = await repositorio.crear_categoria(
            user_id=_user_id(usuario),
            nombre=body.nombre,
            descripcion=body.descripcion,
        )
    except repositorio.NombreDuplicado:
        raise HTTPException(status_code=409, detail=_NOMBRE_REPETIDO) from None
    return CategoriaItem.model_validate(fila)


@router.patch("/categorias/{id}", response_model=CategoriaItem)
async def actualizar_categoria(
    id: str,
    body: CategoriaCatalogo,
    usuario: dict = Depends(usuario_actual),
) -> CategoriaItem:
    try:
        fila = await repositorio.actualizar_categoria(
            user_id=_user_id(usuario),
            categoria_id=id,
            nombre=body.nombre,
            descripcion=body.descripcion,
        )
    except repositorio.NombreDuplicado:
        raise HTTPException(status_code=409, detail=_NOMBRE_REPETIDO) from None
    if fila is None:
        raise HTTPException(status_code=404, detail=_NO_ENCONTRADA)
    return CategoriaItem.model_validate(fila)


@router.delete("/categorias/{id}", status_code=204)
async def borrar_categoria(
    id: str,
    usuario: dict = Depends(usuario_actual),
) -> Response:
    if not await repositorio.borrar_categoria(user_id=_user_id(usuario), categoria_id=id):
        raise HTTPException(status_code=404, detail=_NO_ENCONTRADA)
    return Response(status_code=204)
