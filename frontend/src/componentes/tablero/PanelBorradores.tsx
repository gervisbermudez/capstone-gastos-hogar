import { useEffect, useRef, useState } from "react"
import { Button, Card, CloseButton, Dialog, Flex, Portal, Stack, Text } from "@chakra-ui/react"
import { Link } from "react-router"
import { etiquetaCategoria, type CamposDocumento } from "../../api/tipos"
import { EsqueletoBorradores } from "../esqueleto"
import { formatMonto } from "../../formato"

const SOMBRA = "0 12px 40px rgba(28, 27, 23, 0.06)"

const botonSolido = {
  bg: "fg",
  color: "fg.sobreSolido",
  _hover: { bg: "solido.hover", color: "fg.sobreSolido" },
} as const

type Borrador = { id: string; campos: CamposDocumento }

function proveedorDe(campos: CamposDocumento): string {
  return campos.proveedor?.trim() || "Sin proveedor"
}

function categoriaDe(campos: CamposDocumento): string {
  return etiquetaCategoria(campos.categoria)
}

function periodoDe(campos: CamposDocumento): string {
  return campos.periodo ?? "Sin período"
}

function detalleDe(campos: CamposDocumento): string {
  return [categoriaDe(campos), periodoDe(campos), formatMonto(campos.monto, campos.moneda)].join(" · ")
}

export function PanelBorradores({
  borradores,
  cargando,
  hayError,
  descartando,
  alDescartar,
}: {
  borradores: Borrador[] | null
  cargando: boolean
  hayError: boolean
  descartando: string | null
  alDescartar: (id: string) => void
}) {
  const [pendiente, setPendiente] = useState<Borrador | null>(null)
  const esperando = useRef(false)
  const ocupado = descartando !== null

  useEffect(() => {
    if (!esperando.current || descartando !== null) return
    esperando.current = false
    setPendiente(null)
  }, [descartando])

  function pedirDescarte(item: Borrador) {
    if (ocupado) return
    setPendiente(item)
  }

  function cerrar() {
    if (ocupado) return
    esperando.current = false
    setPendiente(null)
  }

  function confirmar() {
    if (!pendiente || ocupado) return
    esperando.current = true
    alDescartar(pendiente.id)
  }

  const dialogo = (
    <DialogoDescarte
      abierto={pendiente !== null}
      proveedor={pendiente ? proveedorDe(pendiente.campos) : null}
      ocupado={ocupado}
      alCerrar={cerrar}
      alConfirmar={confirmar}
    />
  )

  if (cargando) {
    return (
      <>
        <Card.Root
          bg="bg.panel"
          borderWidth="0"
          borderLeftWidth="3px"
          borderLeftStyle="solid"
          borderLeftColor="marca.sol"
          borderRadius="20px"
          boxShadow={SOMBRA}
          _dark={{
            borderWidth: "1px",
            borderColor: "borde",
            borderLeftWidth: "3px",
            borderLeftColor: "marca.sol",
          }}
        >
          <Card.Header>
            <Card.Title as="h2" fontWeight="medium" color="fg" letterSpacing="-0.03em">
              Borradores por revisar
            </Card.Title>
          </Card.Header>
          <Card.Body>
            <EsqueletoBorradores />
          </Card.Body>
        </Card.Root>
        {dialogo}
      </>
    )
  }

  if (hayError || borradores === null || borradores.length === 0) return pendiente ? dialogo : null

  const desplaza = borradores.length > 4

  return (
    <Card.Root
      bg="bg.panel"
      borderWidth="0"
      borderLeftWidth="3px"
      borderLeftStyle="solid"
      borderLeftColor="marca.sol"
      borderRadius="20px"
      boxShadow={SOMBRA}
      _dark={{
        borderWidth: "1px",
        borderColor: "borde",
        borderLeftWidth: "3px",
        borderLeftColor: "marca.sol",
      }}
    >
      <Card.Header>
        <Flex justify="space-between" align="center" gap={3}>
          <Card.Title as="h2" fontWeight="medium" color="fg" letterSpacing="-0.03em">
            Borradores por revisar
          </Card.Title>
          <Text color="fg.muted" fontSize="sm" fontVariantNumeric="tabular-nums">
            {borradores.length}
          </Text>
        </Flex>
      </Card.Header>
      <Card.Body>
        <Stack gap={2} maxH={desplaza ? "16rem" : undefined} overflowY={desplaza ? "auto" : undefined}>
          {borradores.map((item) => (
            <Flex
              key={item.id}
              direction={{ base: "column", sm: "row" }}
              justify="space-between"
              align={{ base: "flex-start", sm: "center" }}
              gap={3}
            >
              <Stack gap={0.5} minW={0}>
                <Text fontWeight="medium" color="fg">
                  {proveedorDe(item.campos)}
                </Text>
                <Text fontSize="sm" color="fg.muted">
                  {detalleDe(item.campos)}
                </Text>
              </Stack>
              <Flex gap={2} wrap="wrap">
                <Button
                  asChild
                  size="sm"
                  css={{
                    bg: "marca.sol",
                    color: "marca.carbon",
                    _hover: { bg: "marca.sol", color: "marca.carbon" },
                  }}
                >
                  <Link to={`/documentos/${item.id}`}>Revisar</Link>
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  loading={descartando === item.id}
                  disabled={descartando !== null && descartando !== item.id}
                  onClick={() => pedirDescarte(item)}
                >
                  Descartar
                </Button>
              </Flex>
            </Flex>
          ))}
        </Stack>
      </Card.Body>
      {dialogo}
    </Card.Root>
  )
}

function DialogoDescarte({
  abierto,
  proveedor,
  ocupado,
  alCerrar,
  alConfirmar,
}: {
  abierto: boolean
  proveedor: string | null
  ocupado: boolean
  alCerrar: () => void
  alConfirmar: () => void
}) {
  return (
    <Dialog.Root
      role="alertdialog"
      open={abierto}
      onOpenChange={(detalle) => {
        if (!detalle.open) alCerrar()
      }}
      closeOnEscape={!ocupado}
      closeOnInteractOutside={!ocupado}
    >
      <Portal>
        <Dialog.Backdrop />
        <Dialog.Positioner>
          <Dialog.Content
            bg="bg.panel"
            color="fg"
            borderWidth="0"
            borderRadius="l3"
            boxShadow="0 24px 60px rgba(28, 27, 23, 0.12)"
            w="calc(100vw - 2rem)"
            maxW="28rem"
            _dark={{ borderWidth: "1px", borderColor: "borde" }}
          >
            <Dialog.Header>
              <Dialog.Title fontWeight="500" fontSize="1.5rem" letterSpacing="-0.03em" color="fg">
                Descartar borrador
              </Dialog.Title>
            </Dialog.Header>
            <Dialog.Body>
              <Dialog.Description color="fg.muted">
                {proveedor ? (
                  <>
                    ¿Descartás el borrador de{" "}
                    <Text as="span" fontWeight="medium" color="fg" overflowWrap="anywhere">
                      {proveedor}
                    </Text>
                    ? No se puede deshacer.
                  </>
                ) : (
                  "¿Descartás este borrador? No se puede deshacer."
                )}
              </Dialog.Description>
            </Dialog.Body>
            <Dialog.Footer gap={3}>
              <Button
                type="button"
                variant="ghost"
                borderRadius="full"
                color="fg"
                disabled={ocupado}
                onClick={alCerrar}
              >
                Cancelar
              </Button>
              <Button
                type="button"
                borderRadius="full"
                loading={ocupado}
                disabled={ocupado}
                aria-label={proveedor ? `Confirmar descarte de ${proveedor}` : "Confirmar descarte"}
                onClick={alConfirmar}
                css={botonSolido}
              >
                Descartar
              </Button>
            </Dialog.Footer>
            <Dialog.CloseTrigger asChild>
              <CloseButton aria-label="Cerrar" color="fg" disabled={ocupado} />
            </Dialog.CloseTrigger>
          </Dialog.Content>
        </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
  )
}
