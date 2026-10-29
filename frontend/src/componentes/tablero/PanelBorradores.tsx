import { Button, Card, Flex, Skeleton, Stack, Text } from "@chakra-ui/react"
import { Link } from "react-router"
import { ETIQUETA_CATEGORIA, type CamposDocumento } from "../../api/tipos"
import { formatMonto } from "../../formato"

const SOMBRA = "0 12px 40px rgba(28, 27, 23, 0.06)"

function proveedorDe(campos: CamposDocumento): string {
  return campos.proveedor?.trim() || "Sin proveedor"
}

function categoriaDe(campos: CamposDocumento): string {
  return campos.categoria ? ETIQUETA_CATEGORIA[campos.categoria] : "Sin categoría"
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
  borradores: Array<{ id: string; campos: CamposDocumento }> | null
  cargando: boolean
  hayError: boolean
  descartando: string | null
  alDescartar: (id: string) => void
}) {
  if (cargando) {
    return (
      <Card.Root bg="marca.papel" borderWidth="0" borderRadius="20px" boxShadow={SOMBRA} aria-busy>
        <Card.Body>
          <Skeleton height="4.5rem" borderRadius="16px" />
        </Card.Body>
      </Card.Root>
    )
  }

  if (hayError || borradores === null || borradores.length === 0) return null

  const desplaza = borradores.length > 4

  return (
    <Card.Root
      bg="marca.papel"
      borderWidth="0"
      borderLeftWidth="3px"
      borderLeftColor="marca.sol"
      borderRadius="20px"
      boxShadow={SOMBRA}
    >
      <Card.Header>
        <Flex justify="space-between" align="center" gap={3}>
          <Card.Title as="h2" fontWeight="medium" color="marca.carbon" letterSpacing="-0.03em">
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
                <Text fontWeight="medium" color="marca.carbon">
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
                  onClick={() => alDescartar(item.id)}
                >
                  Descartar
                </Button>
              </Flex>
            </Flex>
          ))}
        </Stack>
      </Card.Body>
    </Card.Root>
  )
}
