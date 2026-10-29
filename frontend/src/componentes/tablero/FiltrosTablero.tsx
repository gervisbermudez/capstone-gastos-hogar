import { Alert, Button, Checkbox, Field, Input, NativeSelect, Stack } from "@chakra-ui/react"
import { useEffect, useMemo, useState } from "react"
import { cliente, esAbort } from "../../api/cliente"
import type { CategoriaItem } from "../../api/tipos"
import { opcionActual, opcionesDelCatalogo, opcionesGenerales } from "../../categorias"
import { type FiltrosRegistros } from "../../datos/filtrarRegistros"
import { EsqueletoCampo } from "../esqueleto"

type Props = {
  filtros: FiltrosRegistros
  monedas: string[]
  rangoInvalido: string | null
  monedasPendientes: boolean
  puedeLimpiar: boolean
  onCambio: <K extends keyof FiltrosRegistros>(clave: K, valor: FiltrosRegistros[K]) => void
  onLimpiar: () => void
}

const OPCIONES_ESTADO: readonly FiltrosRegistros["estado"][] = ["todos", "borrador", "confirmado"]

const ETIQUETA_ESTADO: Record<FiltrosRegistros["estado"], string> = {
  todos: "Todos",
  borrador: "Borrador",
  confirmado: "Confirmado",
}

function opcionElegida<T extends string>(valor: string, opciones: readonly T[]): T | null {
  for (const opcion of opciones) {
    if (opcion === valor) return opcion
  }
  return null
}

function listaMonedas(monedas: string[], actual: string): string[] {
  const vistas: string[] = []
  const sumar = (moneda: string) => {
    if (moneda === "" || vistas.includes(moneda)) return
    vistas.push(moneda)
  }
  if (actual !== "" && !monedas.includes(actual)) sumar(actual)
  for (const moneda of monedas) sumar(moneda)
  return vistas
}

export function FiltrosTablero({
  filtros,
  monedas,
  rangoInvalido,
  monedasPendientes,
  puedeLimpiar,
  onCambio,
  onLimpiar,
}: Props) {
  const [catalogo, setCatalogo] = useState<CategoriaItem[] | null>(null)
  const monedasVisibles = listaMonedas(monedas, filtros.moneda)

  useEffect(() => {
    const ctrl = new AbortController()
    cliente
      .listarCategorias(ctrl.signal)
      .then((lista) => setCatalogo(lista.items))
      .catch((falla: unknown) => {
        if (esAbort(falla)) return
        setCatalogo([])
      })
    return () => ctrl.abort()
  }, [])

  const opcionesCategoria = useMemo(() => {
    const propias = opcionesDelCatalogo(catalogo ?? [])
    const ocupados = new Set(propias.map((opcion) => opcion.value))
    const lista = [
      { value: "todas", label: "Todas" },
      { value: "sin", label: "Sin categoría" },
      ...opcionesGenerales(ocupados),
      ...propias,
    ]
    const extra = opcionActual(filtros.categoria, new Set(lista.map((opcion) => opcion.value)))
    if (extra && filtros.categoria !== "todas" && filtros.categoria !== "sin") lista.push(extra)
    return lista
  }, [catalogo, filtros.categoria])

  return (
    <Stack gap={4}>
      {rangoInvalido ? (
        <Alert.Root status="warning">
          <Alert.Indicator />
          <Alert.Description>{rangoInvalido}</Alert.Description>
        </Alert.Root>
      ) : null}
      <Field.Root>
        <Field.Label color="fg" fontSize="sm">
          Desde
        </Field.Label>
        <Input
          w="100%"
          bg="bg.panel"
          type="date"
          aria-invalid={rangoInvalido ? true : undefined}
          value={filtros.desde}
          onChange={(event) => onCambio("desde", event.target.value)}
        />
      </Field.Root>
      <Field.Root>
        <Field.Label color="fg" fontSize="sm">
          Hasta
        </Field.Label>
        <Input
          w="100%"
          bg="bg.panel"
          type="date"
          aria-invalid={rangoInvalido ? true : undefined}
          value={filtros.hasta}
          onChange={(event) => onCambio("hasta", event.target.value)}
        />
      </Field.Root>
      <Field.Root>
        <Field.Label color="fg" fontSize="sm">
          Categoría
        </Field.Label>
        {catalogo === null ? (
          <EsqueletoCampo etiqueta="Cargando categorías" />
        ) : (
          <NativeSelect.Root w="100%">
            <NativeSelect.Field
              bg="bg.panel"
              color="fg"
              value={filtros.categoria}
              onChange={(event) => {
                const elegido = opcionElegida(
                  event.target.value,
                  opcionesCategoria.map((opcion) => opcion.value),
                )
                if (elegido !== null) onCambio("categoria", elegido)
              }}
            >
              {opcionesCategoria.map((opcion) => (
                <option key={opcion.value} value={opcion.value}>
                  {opcion.label}
                </option>
              ))}
            </NativeSelect.Field>
            <NativeSelect.Indicator />
          </NativeSelect.Root>
        )}
      </Field.Root>
      <Field.Root>
        <Field.Label color="fg" fontSize="sm">
          Estado
        </Field.Label>
        <NativeSelect.Root w="100%">
          <NativeSelect.Field
            bg="bg.panel"
            color="fg"
            value={filtros.estado}
            onChange={(event) => {
              const elegido = opcionElegida(event.target.value, OPCIONES_ESTADO)
              if (elegido !== null) onCambio("estado", elegido)
            }}
          >
            {OPCIONES_ESTADO.map((opcion) => (
              <option key={opcion} value={opcion}>
                {ETIQUETA_ESTADO[opcion]}
              </option>
            ))}
          </NativeSelect.Field>
          <NativeSelect.Indicator />
        </NativeSelect.Root>
      </Field.Root>
      <Field.Root>
        <Field.Label color="fg" fontSize="sm">
          Moneda
        </Field.Label>
        {monedasPendientes ? (
          <EsqueletoCampo etiqueta="Cargando monedas" />
        ) : (
          <NativeSelect.Root w="100%">
            <NativeSelect.Field
              bg="bg.panel"
              color="fg"
              value={filtros.moneda}
              onChange={(event) => onCambio("moneda", event.target.value)}
            >
              <option value="">Todas</option>
              {monedasVisibles.map((moneda) => (
                <option key={moneda} value={moneda}>
                  {moneda}
                </option>
              ))}
            </NativeSelect.Field>
            <NativeSelect.Indicator />
          </NativeSelect.Root>
        )}
      </Field.Root>
      <Field.Root>
        <Field.Label color="fg" fontSize="sm">
          Buscar
        </Field.Label>
        <Input
          w="100%"
          bg="bg.panel"
          value={filtros.texto}
          placeholder="Proveedor, número, monto…"
          onChange={(event) => onCambio("texto", event.target.value)}
        />
      </Field.Root>
      <Checkbox.Root
        checked={filtros.incluirSinPeriodo}
        onCheckedChange={({ checked }) => onCambio("incluirSinPeriodo", checked === true)}
      >
        <Checkbox.HiddenInput />
        <Checkbox.Control />
        <Checkbox.Label color="fg" fontSize="sm">
          Incluir sin período
        </Checkbox.Label>
      </Checkbox.Root>
      {puedeLimpiar ? (
        <Button type="button" variant="ghost" borderRadius="full" color="fg" alignSelf="flex-start" onClick={onLimpiar}>
          Limpiar
        </Button>
      ) : null}
    </Stack>
  )
}
