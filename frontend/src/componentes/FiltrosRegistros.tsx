import {
  Alert,
  Box,
  Button,
  Checkbox,
  Field,
  Flex,
  Input,
  NativeSelect,
  Stack,
} from "@chakra-ui/react"
import { useState, type ReactNode } from "react"
import { CATEGORIAS, ETIQUETA_CATEGORIA } from "../api/tipos"
import { FILTROS_INICIALES, type FiltrosRegistros } from "../datos/filtrarRegistros"

type Props = {
  filtros: FiltrosRegistros
  monedas: string[]
  rangoInvalido: string | null
  puedeDescargar: boolean
  onCambio: <K extends keyof FiltrosRegistros>(clave: K, valor: FiltrosRegistros[K]) => void
  onLimpiar: () => void
  onDescargar: () => void
}

const OPCIONES_CATEGORIA: readonly FiltrosRegistros["categoria"][] = ["todas", "sin", ...CATEGORIAS]

const ETIQUETA_FILTRO_CATEGORIA: Record<FiltrosRegistros["categoria"], string> = {
  todas: "Todas",
  sin: "Sin categoría",
  ...ETIQUETA_CATEGORIA,
}

const OPCIONES_ESTADO: readonly FiltrosRegistros["estado"][] = ["todos", "borrador", "confirmado"]

const ETIQUETA_ESTADO: Record<FiltrosRegistros["estado"], string> = {
  todos: "Todos",
  borrador: "Borrador",
  confirmado: "Confirmado",
}

const SOMBRA = "0 12px 40px rgba(28, 27, 23, 0.06)"

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

function extrasActivos(filtros: FiltrosRegistros): number {
  let cantidad = 0
  if (filtros.incluirSinPeriodo !== FILTROS_INICIALES.incluirSinPeriodo) cantidad += 1
  if (filtros.categoria !== FILTROS_INICIALES.categoria) cantidad += 1
  if (filtros.estado !== FILTROS_INICIALES.estado) cantidad += 1
  if (filtros.moneda.trim() !== FILTROS_INICIALES.moneda) cantidad += 1
  return cantidad
}

function hayAlgunFiltro(filtros: FiltrosRegistros): boolean {
  return (
    filtros.desde !== "" ||
    filtros.hasta !== "" ||
    filtros.texto.trim() !== "" ||
    extrasActivos(filtros) > 0
  )
}

function Campo({
  etiqueta,
  crece,
  children,
}: {
  etiqueta: string
  crece?: boolean
  children: ReactNode
}) {
  return (
    <Field.Root
      flex={crece ? "1 1 16rem" : { md: "0 0 11rem" }}
      w={{ base: "100%", md: crece ? "auto" : "11rem" }}
      minW={0}
      maxW={crece ? undefined : { md: "11rem" }}
    >
      <Field.Label color="fg" fontSize="sm">
        {etiqueta}
      </Field.Label>
      <Box w="100%">{children}</Box>
    </Field.Root>
  )
}

function CampoOpcion<T extends string>({
  etiqueta,
  valor,
  opciones,
  etiquetas,
  onCambio,
}: {
  etiqueta: string
  valor: T
  opciones: readonly T[]
  etiquetas: Record<T, string>
  onCambio: (valor: T) => void
}) {
  return (
    <Campo etiqueta={etiqueta}>
      <NativeSelect.Root w="100%">
        <NativeSelect.Field
          bg="bg.panel"
          color="fg"
          value={valor}
          onChange={(event) => {
            const elegido = opcionElegida(event.target.value, opciones)
            if (elegido !== null) onCambio(elegido)
          }}
        >
          {opciones.map((opcion) => (
            <option key={opcion} value={opcion}>
              {etiquetas[opcion]}
            </option>
          ))}
        </NativeSelect.Field>
        <NativeSelect.Indicator />
      </NativeSelect.Root>
    </Campo>
  )
}

export function FiltrosRegistros({
  filtros,
  monedas,
  rangoInvalido,
  puedeDescargar,
  onCambio,
  onLimpiar,
  onDescargar,
}: Props) {
  const [extrasAbiertos, setExtrasAbiertos] = useState(false)
  const monedasVisibles = listaMonedas(monedas, filtros.moneda)
  const cantidadExtras = extrasActivos(filtros)
  const mostrarLimpiar = hayAlgunFiltro(filtros)

  function alLimpiar() {
    setExtrasAbiertos(false)
    onLimpiar()
  }

  return (
    <Stack gap={3}>
      <Flex
        direction={{ base: "column", md: "row" }}
        gap={3}
        align={{ md: "flex-end" }}
        bg="bg.panel"
        borderRadius="20px"
        boxShadow={SOMBRA}
        px={4}
        py={3}
      >
        <Campo etiqueta="Desde">
          <Input
            w="100%"
            bg="bg.panel"
            type="date"
            value={filtros.desde}
            onChange={(event) => onCambio("desde", event.target.value)}
          />
        </Campo>
        <Campo etiqueta="Hasta">
          <Input
            w="100%"
            bg="bg.panel"
            type="date"
            value={filtros.hasta}
            onChange={(event) => onCambio("hasta", event.target.value)}
          />
        </Campo>
        <Campo etiqueta="Buscar" crece>
          <Input
            w="100%"
            bg="bg.panel"
            value={filtros.texto}
            placeholder="Proveedor, número, monto…"
            onChange={(event) => onCambio("texto", event.target.value)}
          />
        </Campo>
        <Button
          type="button"
          variant="outline"
          borderRadius="full"
          color="fg"
          alignSelf={{ base: "flex-start", md: "flex-end" }}
          aria-expanded={extrasAbiertos}
          aria-controls="filtros-extra"
          onClick={() => setExtrasAbiertos((abierto) => !abierto)}
        >
          {extrasAbiertos ? "Ocultar filtros" : "Más filtros"}
          {cantidadExtras > 0 ? (
            <Box
              as="span"
              bg="marca.sol"
              color="marca.carbon"
              borderRadius="full"
              px={2}
              py={0.5}
              fontSize="xs"
              fontWeight="medium"
              lineHeight="1"
            >
              {cantidadExtras}
            </Box>
          ) : null}
        </Button>
        <Button
          type="button"
          variant="outline"
          borderRadius="full"
          color="fg"
          alignSelf={{ base: "flex-start", md: "flex-end" }}
          disabled={!puedeDescargar}
          onClick={onDescargar}
        >
          Descargar Excel
        </Button>
        {mostrarLimpiar ? (
          <Button
            type="button"
            variant="ghost"
            borderRadius="full"
            color="fg"
            alignSelf={{ base: "flex-start", md: "flex-end" }}
            onClick={alLimpiar}
          >
            Limpiar
          </Button>
        ) : null}
      </Flex>

      {rangoInvalido ? (
        <Alert.Root status="warning">
          <Alert.Indicator />
          <Alert.Description>{rangoInvalido}</Alert.Description>
        </Alert.Root>
      ) : null}

      {extrasAbiertos ? (
        <Stack id="filtros-extra" gap={4} bg="bg.subtle" borderRadius="20px" px={4} py={4}>
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
          <Flex direction={{ base: "column", md: "row" }} flexWrap={{ md: "wrap" }} gap={3} align={{ md: "flex-end" }}>
          <CampoOpcion
            etiqueta="Categoría"
            valor={filtros.categoria}
            opciones={OPCIONES_CATEGORIA}
            etiquetas={ETIQUETA_FILTRO_CATEGORIA}
            onCambio={(valor) => onCambio("categoria", valor)}
          />
          <CampoOpcion
            etiqueta="Estado"
            valor={filtros.estado}
            opciones={OPCIONES_ESTADO}
            etiquetas={ETIQUETA_ESTADO}
            onCambio={(valor) => onCambio("estado", valor)}
          />
          <Campo etiqueta="Moneda">
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
          </Campo>
          </Flex>
        </Stack>
      ) : null}
    </Stack>
  )
}
