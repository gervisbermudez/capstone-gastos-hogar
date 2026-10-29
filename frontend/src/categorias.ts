import {
  CATEGORIAS,
  ETIQUETA_CATEGORIA,
  etiquetaCategoria,
  valorCategoria,
  type CategoriaItem,
} from "./api/tipos"

export type OpcionCategoria = {
  value: string
  label: string
}

export function opcionesDelCatalogo(items: readonly CategoriaItem[]): OpcionCategoria[] {
  const vistas: OpcionCategoria[] = []
  const valores = new Set<string>()
  for (const item of items) {
    const value = valorCategoria(item.nombre)
    if (value === "" || valores.has(value)) continue
    valores.add(value)
    vistas.push({ value, label: item.nombre })
  }
  return vistas
}

export function opcionesGenerales(ocupados: ReadonlySet<string>): OpcionCategoria[] {
  return CATEGORIAS.filter((categoria) => !ocupados.has(categoria)).map((categoria) => ({
    value: categoria,
    label: ETIQUETA_CATEGORIA[categoria],
  }))
}

export function opcionActual(actual: string, ocupados: ReadonlySet<string>): OpcionCategoria | null {
  if (actual === "" || ocupados.has(actual)) return null
  return { value: actual, label: etiquetaCategoria(actual) }
}
