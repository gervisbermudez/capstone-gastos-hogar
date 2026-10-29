import { Combobox, Portal, useFieldContext, useFilter, useListCollection } from "@chakra-ui/react"
import { useEffect, useRef } from "react"
import { cliente, esAbort } from "../../api/cliente"
import type { DocumentoListado } from "../../api/tipos"

const FILTRO = { sensitivity: "base" } as const

function nombresProveedor(items: readonly DocumentoListado[]): string[] {
  const vistos = new Map<string, string>()
  for (const item of items) {
    const nombre = item.campos.proveedor?.trim() ?? ""
    if (nombre === "") continue
    const clave = nombre.toLocaleLowerCase("es")
    if (!vistos.has(clave)) vistos.set(clave, nombre)
  }
  return [...vistos.values()].sort((a, b) => a.localeCompare(b, "es", { sensitivity: "base" }))
}

export function CampoProveedor({
  valor,
  onChange,
}: {
  valor: string
  onChange: (valor: string) => void
}) {
  const campo = useFieldContext()
  const entrada = campo?.getInputProps()
  const { contains } = useFilter(FILTRO)
  const { collection, filter, set } = useListCollection({
    initialItems: [] as string[],
    itemToValue: (item) => item,
    itemToString: (item) => item,
    filter: contains,
  })
  const valorRef = useRef(valor)
  valorRef.current = valor
  const escrito = useRef(false)

  useEffect(() => {
    const ctrl = new AbortController()
    let vivo = true
    cliente
      .listarDocumentos(ctrl.signal)
      .then((lista) => {
        if (!vivo) return
        set(nombresProveedor(lista.items))
        if (escrito.current) filter(valorRef.current)
      })
      .catch((error: unknown) => {
        if (!vivo || esAbort(error)) return
      })
    return () => {
      vivo = false
      ctrl.abort()
    }
  }, [filter, set])

  return (
    <Combobox.Root
      collection={collection}
      inputValue={valor}
      invalid={Boolean(campo?.invalid)}
      allowCustomValue
      openOnClick
      inputBehavior="autohighlight"
      positioning={{ sameWidth: true }}
      w="100%"
      onOpenChange={(detalle) => {
        if (!detalle.open) return
        if (detalle.reason === "input-click" || detalle.reason === "trigger-click") filter("")
      }}
      onInputValueChange={(detalle) => {
        onChange(detalle.inputValue)
        if (detalle.reason === "input-change" || detalle.reason === "clear-trigger") {
          escrito.current = true
          filter(detalle.inputValue)
        }
      }}
    >
      <Combobox.Control>
        <Combobox.Input
          id={entrada?.id}
          aria-invalid={entrada?.["aria-invalid"]}
          aria-describedby={entrada?.["aria-describedby"]}
          aria-errormessage={entrada?.["aria-errormessage"]}
          disabled={entrada?.disabled}
          autoComplete="off"
          css={{
            bg: "bg.panel",
            color: "fg",
            borderRadius: "16px",
            borderColor: "borde",
            userSelect: "text",
            focusVisibleRing: "outside",
            focusRingColor: "marca.sol",
          }}
        />
        <Combobox.IndicatorGroup>
          <Combobox.Trigger aria-label="Proveedores ya cargados" color="fg" />
        </Combobox.IndicatorGroup>
      </Combobox.Control>
      <Portal>
        <Combobox.Positioner>
          <Combobox.Content
            css={{
              bg: "bg.panel",
              color: "fg",
              borderWidth: "1px",
              borderColor: "borde",
              borderRadius: "16px",
              boxShadow: "0 12px 40px rgba(28, 27, 23, 0.12)",
            }}
          >
            {collection.items.map((item) => (
              <Combobox.Item
                key={item}
                item={item}
                css={{ color: "fg", borderRadius: "12px", _highlighted: { bg: "bg.subtle" } }}
              >
                <Combobox.ItemText>{item}</Combobox.ItemText>
              </Combobox.Item>
            ))}
          </Combobox.Content>
        </Combobox.Positioner>
      </Portal>
    </Combobox.Root>
  )
}
