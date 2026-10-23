export type VistaLocal = {
  url: string
  mime: string
  nombre: string
}

const vistas = new Map<string, VistaLocal>()

export function guardarVista(id: string, archivo: File): void {
  const anterior = vistas.get(id)
  if (anterior) URL.revokeObjectURL(anterior.url)
  vistas.set(id, {
    url: URL.createObjectURL(archivo),
    mime: archivo.type,
    nombre: archivo.name,
  })
}

export function leerVista(id: string): VistaLocal | undefined {
  return vistas.get(id)
}

export function olvidarVistas(): void {
  for (const vista of vistas.values()) URL.revokeObjectURL(vista.url)
  vistas.clear()
}
