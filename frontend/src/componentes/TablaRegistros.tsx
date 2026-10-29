import { Box, Button, Card, Flex, Menu, Portal, Stack, Table, Text } from "@chakra-ui/react"
import { type ReactNode } from "react"
import { useNavigate } from "react-router"
import { etiquetaCategoria, type CamposDocumento, type DocumentoListado, type EstadoDocumento } from "../api/tipos"
import { formatMonto } from "../formato"
import { IconoPuntos } from "./revision/iconos"

const SOMBRA = "0 12px 40px rgba(28, 27, 23, 0.06)"
const BORDE = "borde"
const HOVER_FILA = "rgba(245, 203, 92, 0.45)"

const itemMenu = {
  px: 3,
  py: 2,
  mx: 1,
  borderRadius: "12px",
  cursor: "pointer",
  color: "fg",
  _highlighted: { bg: "bg.subtle" },
} as const

const itemPeligro = {
  ...itemMenu,
  color: "estadoTexto.falla",
  _highlighted: { bg: "estado.fallaFondo", color: "estado.falla" },
} as const

type Props = {
  items: DocumentoListado[]
  bloqueadoId: string | null
  onAnular: (item: DocumentoListado) => void
  onEliminar: (item: DocumentoListado) => void
}

function vigente(item: DocumentoListado): boolean {
  return item.estado === "confirmado" && item.anulado !== true
}

function proveedorDe(campos: CamposDocumento): string {
  return campos.proveedor?.trim() || "Sin proveedor"
}

function inicialesDe(nombre: string): string {
  const palabras = nombre.trim().split(/\s+/).filter((palabra) => palabra.length > 0)
  if (palabras.length === 0) return "?"
  const letras = (palabra: string) => Array.from(palabra)
  if (palabras.length === 1) {
    const par = letras(palabras[0]).slice(0, 2).join("")
    return par === "" ? "?" : par.toLocaleUpperCase("es-AR")
  }
  const par = `${letras(palabras[0])[0] ?? ""}${letras(palabras[1])[0] ?? ""}`
  return par === "" ? "?" : par.toLocaleUpperCase("es-AR")
}

function categoriaDe(campos: CamposDocumento): string {
  return etiquetaCategoria(campos.categoria)
}

function periodoDe(campos: CamposDocumento): string {
  return campos.periodo?.trim() || "Sin período"
}

function numeroDe(campos: CamposDocumento): string {
  return campos.numero_comprobante?.trim() || "—"
}

function Pastilla({
  fondo,
  color,
  children,
}: {
  fondo: string
  color: string
  children: string
}) {
  return (
    <Box
      as="span"
      display="inline-flex"
      alignItems="center"
      w="fit-content"
      flexShrink={0}
      px={2.5}
      py={0.5}
      borderRadius="full"
      bg={fondo}
      color={color}
      fontSize="xs"
      fontWeight="medium"
      lineHeight="1.2"
      whiteSpace="nowrap"
    >
      {children}
    </Box>
  )
}

function nodoEstado(estado: EstadoDocumento) {
  if (estado === "confirmado") {
    return (
      <Pastilla fondo="estado.okFondo" color="estado.ok">
        Confirmado
      </Pastilla>
    )
  }
  return (
    <Pastilla fondo="estado.avisoFondo" color="estado.aviso">
      Borrador
    </Pastilla>
  )
}

function Proveedor({ campos }: { campos: CamposDocumento }) {
  return (
    <Flex align="center" gap={2.5} minW={0} flex="1">
      <Flex
        aria-hidden
        align="center"
        justify="center"
        flexShrink={0}
        boxSize="32px"
        borderRadius="full"
        bg="bg.subtle"
        color="fg"
        fontSize="xs"
        fontWeight="600"
        lineHeight="1"
      >
        {inicialesDe(campos.proveedor ?? "")}
      </Flex>
      <Text
        minW={0}
        overflow="hidden"
        textOverflow="ellipsis"
        whiteSpace="nowrap"
        fontWeight="medium"
        color="fg"
      >
        {proveedorDe(campos)}
      </Text>
    </Flex>
  )
}

function etiquetaAcciones(item: DocumentoListado): string {
  const proveedor = proveedorDe(item.campos)
  const numero = item.campos.numero_comprobante?.trim()
  return numero ? `Acciones de ${proveedor}, comprobante ${numero}` : `Acciones de ${proveedor}`
}

function MenuRegistro({
  item,
  bloqueado,
  onAnular,
  onEliminar,
}: {
  item: DocumentoListado
  bloqueado: boolean
  onAnular: (item: DocumentoListado) => void
  onEliminar: (item: DocumentoListado) => void
}) {
  const navigate = useNavigate()
  const corregir = vigente(item)

  return (
    <Menu.Root positioning={{ placement: "bottom-end" }}>
      <Menu.Trigger asChild>
        <Button
          type="button"
          aria-label={etiquetaAcciones(item)}
          size="sm"
          variant="ghost"
          borderRadius="full"
          flexShrink={0}
          minW={8}
          h={8}
          px={2}
          color="fg"
          disabled={bloqueado}
          _hover={{ bg: "bg.hover", color: "fg" }}
        >
          <IconoPuntos />
        </Button>
      </Menu.Trigger>
      <Portal>
        <Menu.Positioner zIndex={2000}>
          <Menu.Content
            bg="bg.panel"
            borderWidth="1px"
            borderColor="borde"
            borderRadius="16px"
            boxShadow={SOMBRA}
            minW="11rem"
            py={1}
          >
            <Menu.Item value="ver" onClick={() => navigate(`/documentos/${item.id}`)} css={itemMenu}>
              Ver
            </Menu.Item>
            {corregir ? (
              <Menu.Item
                value="editar"
                onClick={() => navigate(`/documentos/${item.id}`, { state: { corregir: true } })}
                css={itemMenu}
              >
                Editar
              </Menu.Item>
            ) : null}
            <Menu.Item
              value="chat"
              onClick={() =>
                navigate(`/chat?comprobante=${encodeURIComponent(item.id)}`, {
                  state: { nuevoComprobante: item.id },
                })
              }
              css={itemMenu}
            >
              Chat
            </Menu.Item>
            {corregir ? (
              <Menu.Item value="anular" onClick={() => onAnular(item)} css={itemPeligro}>
                Anular
              </Menu.Item>
            ) : null}
            <Menu.Item value="eliminar" onClick={() => onEliminar(item)} css={itemPeligro}>
              Eliminar
            </Menu.Item>
          </Menu.Content>
        </Menu.Positioner>
      </Portal>
    </Menu.Root>
  )
}

function Encabezado({ children }: { children?: ReactNode }) {
  return (
    <Table.ColumnHeader
      bg="transparent"
      color="fg.muted"
      fontSize="xs"
      fontWeight="medium"
      letterSpacing="0.06em"
      whiteSpace="nowrap"
      borderColor={BORDE}
      verticalAlign="middle"
      px={4}
      py={3}
    >
      {children}
    </Table.ColumnHeader>
  )
}

function Celda({ children }: { children: ReactNode }) {
  return (
    <Table.Cell borderColor={BORDE} verticalAlign="middle" px={4} py={3}>
      {children}
    </Table.Cell>
  )
}

function TarjetaRegistro({
  item,
  bloqueado,
  onAnular,
  onEliminar,
}: {
  item: DocumentoListado
  bloqueado: boolean
  onAnular: (item: DocumentoListado) => void
  onEliminar: (item: DocumentoListado) => void
}) {
  return (
    <Card.Root size="sm" bg="bg.panel" borderWidth="0" borderRadius="20px" boxShadow={SOMBRA} _dark={{ borderWidth: "1px", borderColor: "borde" }}>
      <Card.Body>
        <Stack gap={3}>
          <Flex justify="space-between" gap={3} align="center" minW={0}>
            <Proveedor campos={item.campos} />
            <Flex align="center" gap={1} flexShrink={0}>
              {nodoEstado(item.estado)}
              <MenuRegistro item={item} bloqueado={bloqueado} onAnular={onAnular} onEliminar={onEliminar} />
            </Flex>
          </Flex>
          <Text fontSize="sm" color="fg.muted">
            {categoriaDe(item.campos)} · {periodoDe(item.campos)}
          </Text>
          <Text fontSize="sm" color="fg.muted">
            Número {numeroDe(item.campos)}
          </Text>
          <Text fontVariantNumeric="tabular-nums" fontWeight="medium">
            {formatMonto(item.campos.monto, item.campos.moneda)}
          </Text>
        </Stack>
      </Card.Body>
    </Card.Root>
  )
}

export function TablaRegistros({ items, bloqueadoId, onAnular, onEliminar }: Props) {
  return (
    <>
      <Stack gap={3} display={{ base: "flex", md: "none" }}>
        {items.map((item) => (
          <TarjetaRegistro
            key={item.id}
            item={item}
            bloqueado={bloqueadoId === item.id}
            onAnular={onAnular}
            onEliminar={onEliminar}
          />
        ))}
      </Stack>
      <Box
        display={{ base: "none", md: "block" }}
        bg="bg.panel"
        borderRadius="20px"
        boxShadow={SOMBRA}
        overflow="hidden"
      >
        <Table.ScrollArea>
          <Table.Root size="sm" w="max-content" minW="100%">
            <Table.Header>
              <Table.Row bg="bg.panel">
                <Encabezado>Proveedor</Encabezado>
                <Encabezado>Categoría</Encabezado>
                <Encabezado>Período</Encabezado>
                <Encabezado>Número</Encabezado>
                <Encabezado>Monto</Encabezado>
                <Encabezado>Estado</Encabezado>
                <Encabezado>
                  <Text as="span" srOnly>
                    Acciones
                  </Text>
                </Encabezado>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {items.map((item) => (
                <Table.Row
                  key={item.id}
                  bg="bg.panel"
                  _hover={{ bg: HOVER_FILA }}
                  css={{ "&:last-child td": { borderBottomWidth: 0 } }}
                >
                  <Celda>
                    <Proveedor campos={item.campos} />
                  </Celda>
                  <Celda>{categoriaDe(item.campos)}</Celda>
                  <Celda>{periodoDe(item.campos)}</Celda>
                  <Celda>{numeroDe(item.campos)}</Celda>
                  <Celda>
                    <Text fontVariantNumeric="tabular-nums" fontWeight="medium">
                      {formatMonto(item.campos.monto, item.campos.moneda)}
                    </Text>
                  </Celda>
                  <Celda>{nodoEstado(item.estado)}</Celda>
                  <Celda>
                    <MenuRegistro
                      item={item}
                      bloqueado={bloqueadoId === item.id}
                      onAnular={onAnular}
                      onEliminar={onEliminar}
                    />
                  </Celda>
                </Table.Row>
              ))}
            </Table.Body>
          </Table.Root>
        </Table.ScrollArea>
      </Box>
    </>
  )
}
