import {
  Alert,
  Box,
  Button,
  CloseButton,
  Dialog,
  EmptyState,
  Flex,
  HStack,
  Portal,
  Stack,
  Text,
  Textarea,
} from "@chakra-ui/react"
import type { JSX } from "react"
import { Link } from "react-router"
import type { FotoAdjunto, MensajeGuardado } from "../../almacen"
import { etiquetaCategoria, type DocumentoDetalle } from "../../api/tipos"
import { fotoDesdeCita, textoVisible } from "../../chat/contexto"
import { MenuConversacion } from "./ListaConversaciones"

export const EJEMPLOS_CHAT = [
  "¿Cuánto pagué de expensas en marzo?",
  "Compará la luz de enero contra febrero.",
  "¿Qué dice la factura de alquiler sobre el ajuste?",
] as const

const ETIQUETAS_FICHA = ["Acción", "Motivo", "Pedido", "Datos"] as const

const UUID = "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}"

type LineaFicha = { etiqueta: (typeof ETIQUETAS_FICHA)[number]; valor: string }

type Trozo = { tipo: "texto"; texto: string } | { tipo: "enlace"; texto: string; href: string }

function trozosConEnlaces(texto: string): Trozo[] {
  const patron = new RegExp(`\\[comprobante ([^\\s|\\]]+)(?:\\s*\\|[^\\]]*)?\\]|\\bBorrador:\\s*(${UUID})`, "g")
  const trozos: Trozo[] = []
  let cursor = 0
  for (const coincidencia of texto.matchAll(patron)) {
    const inicio = coincidencia.index ?? cursor
    if (inicio > cursor) trozos.push({ tipo: "texto", texto: texto.slice(cursor, inicio) })
    const id = coincidencia[1] || coincidencia[2]
    if (id) {
      trozos.push({ tipo: "enlace", texto: coincidencia[0], href: `/documentos/${encodeURIComponent(id)}` })
    }
    cursor = inicio + coincidencia[0].length
  }
  if (cursor < texto.length) trozos.push({ tipo: "texto", texto: texto.slice(cursor) })
  return trozos.length > 0 ? trozos : [{ tipo: "texto", texto }]
}

function TextoConEnlaces({ texto }: { texto: string }) {
  return (
    <>
      {trozosConEnlaces(texto).map((trozo, indice) =>
        trozo.tipo === "enlace" ? (
          <Link key={`${trozo.href}-${indice}`} to={trozo.href} style={{ textDecoration: "underline", color: "inherit" }}>
            {trozo.texto}
          </Link>
        ) : (
          <span key={`texto-${indice}`}>{trozo.texto}</span>
        ),
      )}
    </>
  )
}

function leerLineasFicha(texto: string): LineaFicha[] | null {
  const halladas: LineaFicha[] = []
  for (const cruda of texto.split(/\r?\n/)) {
    const limpia = cruda.trim()
    for (const etiqueta of ETIQUETAS_FICHA) {
      const prefijo = `${etiqueta}:`
      if (!limpia.startsWith(prefijo)) continue
      halladas.push({ etiqueta, valor: limpia.slice(prefijo.length).trim() })
      break
    }
  }
  return halladas.length > 0 ? halladas : null
}

function DetalleFicha({ texto }: { texto: string }) {
  const lineas = leerLineasFicha(texto)
  if (!lineas) {
    return (
      <Alert.Description>
        <TextoConEnlaces texto={texto} />
      </Alert.Description>
    )
  }
  return (
    <Alert.Description>
      <Stack gap={1}>
        {lineas.map((linea, indice) => (
          <Text key={`${linea.etiqueta}-${indice}`} whiteSpace="pre-wrap" overflowWrap="anywhere">
            <Text as="span" fontWeight="medium">
              {linea.etiqueta}:{" "}
            </Text>
            <TextoConEnlaces texto={linea.valor} />
          </Text>
        ))}
      </Stack>
    </Alert.Description>
  )
}

export function EncabezadoChat({
  titulo,
  archivada = false,
  puedeGestionar = false,
  bloqueado = false,
  onAbrirHistorial,
  onArchivar,
  onRestaurar,
  onEliminar,
}: {
  titulo: string
  archivada?: boolean
  puedeGestionar?: boolean
  bloqueado?: boolean
  onAbrirHistorial: () => void
  onArchivar?: () => void
  onRestaurar?: () => void
  onEliminar?: () => void
}) {
  const muestraAcciones = puedeGestionar && onArchivar && onRestaurar && onEliminar
  return (
    <Flex
      align="center"
      gap={3}
      px={{ base: 4, md: 6 }}
      py={3}
      borderBottomWidth="1px"
      borderColor="borde"
      flexShrink={0}
    >
      <Button
        type="button"
        size="sm"
        variant="ghost"
        color="fg"
        borderRadius="full"
        display={{ base: "inline-flex", lg: "none" }}
        _hover={{ bg: "bg.hover", color: "fg" }}
        onClick={onAbrirHistorial}
        aria-label="Abrir conversaciones anteriores"
      >
        Historial
      </Button>
      <Text flex="1" minW={0} truncate fontFamily="heading" fontWeight="600" fontSize="lg" color="fg">
        {titulo}
      </Text>
      {archivada ? (
        <Text flexShrink={0} fontSize="xs" fontWeight="medium" color="fg.muted">
          Archivada
        </Text>
      ) : null}
      {muestraAcciones ? (
        <MenuConversacion
          titulo={titulo}
          archivada={archivada}
          bloqueado={bloqueado}
          onArchivar={onArchivar}
          onRestaurar={onRestaurar}
          onEliminar={onEliminar}
        />
      ) : null}
    </Flex>
  )
}

export function DialogoEliminarConversacion({
  titulo,
  abierto,
  ocupado,
  error,
  onCerrar,
  onConfirmar,
}: {
  titulo: string
  abierto: boolean
  ocupado: boolean
  error: string | null
  onCerrar: () => void
  onConfirmar: () => void
}): JSX.Element {
  return (
    <Dialog.Root
      open={abierto}
      onOpenChange={(detalle) => {
        if (!detalle.open) onCerrar()
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
                Eliminar conversación
              </Dialog.Title>
            </Dialog.Header>
            <Dialog.Body>
              <Stack gap={4}>
                <Dialog.Description color="fg.muted">
                  ¿Eliminar{" "}
                  <Text as="span" fontWeight="medium" color="fg" overflowWrap="anywhere">
                    {titulo}
                  </Text>
                  ? Se borra el historial y no se puede deshacer.
                </Dialog.Description>
                {error ? (
                  <Alert.Root status="error">
                    <Alert.Indicator />
                    <Alert.Description>{error}</Alert.Description>
                  </Alert.Root>
                ) : null}
              </Stack>
            </Dialog.Body>
            <Dialog.Footer gap={3}>
              <Button
                type="button"
                variant="ghost"
                borderRadius="full"
                color="fg"
                disabled={ocupado}
                onClick={onCerrar}
              >
                Cancelar
              </Button>
              <Button
                type="button"
                borderRadius="full"
                loading={ocupado}
                aria-label={`Confirmar eliminación de ${titulo}`}
                onClick={onConfirmar}
                css={{
                  bg: "fg",
                  color: "fg.sobreSolido",
                  _hover: { bg: "solido.hover", color: "fg.sobreSolido" },
                }}
              >
                Eliminar
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

export type AdjuntoComprobante = {
  id: string
  documento: DocumentoDetalle | null
  cargando: boolean
  falla: boolean
}

function resumenCampos(campos: DocumentoDetalle["campos"]): { titulo: string; detalle: string } {
  const numero = campos.numero_comprobante?.trim()
  const detalle = [
    etiquetaCategoria(campos.categoria),
    campos.periodo?.trim() || "Sin período",
    numero ? `Nº ${numero}` : null,
  ]
    .filter((item): item is string => Boolean(item))
    .join(" · ")
  return { titulo: campos.proveedor?.trim() || "Sin proveedor", detalle }
}

function resumenAdjunto(adjunto: AdjuntoComprobante): { titulo: string; detalle: string } {
  if (adjunto.documento && !adjunto.falla) return resumenCampos(adjunto.documento.campos)
  if (adjunto.cargando) return { titulo: "Comprobante", detalle: "Abriendo…" }
  return { titulo: "Comprobante", detalle: "No se pudieron leer los datos" }
}

export function fotoDeAdjunto(adjunto: AdjuntoComprobante): FotoAdjunto {
  const { titulo, detalle } = resumenAdjunto(adjunto)
  return { id: adjunto.id, titulo, detalle }
}

function IconoComprobante() {
  return (
    <svg aria-hidden="true" width="18" height="18" viewBox="0 0 16 16" fill="none">
      <path
        d="M4.25 1.75h5.1L12.75 5.1v9.15H4.25V1.75Z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      <path d="M9.15 1.75v3.35h3.6M6.1 8.1h4.8M6.1 10.6h3.2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  )
}

function IconoQuitar() {
  return (
    <svg aria-hidden="true" width="12" height="12" viewBox="0 0 12 12" fill="none">
      <path d="M2.5 2.5 9.5 9.5M9.5 2.5 2.5 9.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

function ChipAdjunto({
  id,
  titulo,
  detalle,
  onQuitar,
  fondo = "bg.subtle",
}: {
  id: string
  titulo: string
  detalle: string
  onQuitar?: () => void
  fondo?: "bg.subtle" | "bg.panel"
}) {
  return (
    <Flex
      align="center"
      gap={2}
      alignSelf="flex-start"
      maxW="min(100%, 16rem)"
      bg={fondo}
      borderRadius="14px"
      pl={2}
      pr={onQuitar ? 1 : 2}
      py={1.5}
    >
      <Flex
        align="center"
        justify="center"
        flexShrink={0}
        boxSize="32px"
        borderRadius="10px"
        bg={fondo === "bg.panel" ? "bg.subtle" : "bg.panel"}
        color="fg"
      >
        <IconoComprobante />
      </Flex>
      <Stack gap={0} minW={0} py={0.5}>
        <Link
          to={`/documentos/${encodeURIComponent(id)}`}
          style={{ minWidth: 0, color: "inherit", textDecoration: "none" }}
        >
          <Text fontSize="sm" fontWeight="medium" color="fg" truncate>
            {titulo}
          </Text>
        </Link>
        {detalle ? (
          <Text fontSize="xs" color="fg.muted" truncate>
            {detalle}
          </Text>
        ) : null}
      </Stack>
      {onQuitar ? (
        <Button
          type="button"
          aria-label="Quitar comprobante"
          size="xs"
          variant="ghost"
          borderRadius="full"
          minW="28px"
          h="28px"
          px={0}
          color="fg"
          flexShrink={0}
          _hover={{ bg: "bg.hover", color: "fg" }}
          onClick={onQuitar}
        >
          <IconoQuitar />
        </Button>
      ) : null}
    </Flex>
  )
}

export function EstadoVacio({
  bloqueado,
  onElegir,
}: {
  bloqueado: boolean
  onElegir: (texto: string) => void
}) {
  return (
    <EmptyState.Root size="sm">
      <EmptyState.Content>
        <EmptyState.Title color="fg" fontFamily="heading">
          Preguntale a tus gastos
        </EmptyState.Title>
        <EmptyState.Description color="fg.muted">
          Los montos salen de lo que confirmaste. También podés preguntar qué dice una factura.
        </EmptyState.Description>
        <Flex gap={2} flexWrap="wrap" justify="center" mt={4}>
          {EJEMPLOS_CHAT.map((ejemplo) => (
            <Button
              key={ejemplo}
              type="button"
              size="sm"
              variant="outline"
              height="auto"
              whiteSpace="normal"
              textAlign="left"
              py={2}
              px={3}
              borderRadius="full"
              disabled={bloqueado}
              onClick={() => onElegir(ejemplo)}
              css={{
                bg: "bg.panel",
                color: "fg",
                borderColor: "borde",
                _hover: { bg: "#fbe8b4", borderColor: "marca.sol", color: "marca.carbon" },
                _disabled: {
                  opacity: 0.72,
                  bg: "bg.panel",
                  color: "fg",
                  borderColor: "borde",
                },
              }}
            >
              {ejemplo}
            </Button>
          ))}
        </Flex>
      </EmptyState.Content>
    </EmptyState.Root>
  )
}

export function MensajeChat({
  mensaje,
  ocupado,
  onDecidir,
}: {
  mensaje: MensajeGuardado
  ocupado: boolean
  onDecidir: (jobId: string, aprobado: boolean) => void
}) {
  if (mensaje.tipo === "aprobacion") {
    return (
      <Alert.Root
        status="warning"
        w="100%"
        css={{
          bg: "estado.avisoFondo",
          color: "marca.carbon",
          borderRadius: "20px",
        }}
      >
        <Alert.Indicator color="estado.aviso" />
        <Alert.Content>
          <Alert.Title color="marca.carbon">
            {mensaje.resuelta === "si"
              ? "Aprobaste la acción."
              : mensaje.resuelta === "no"
                ? "Rechazaste la acción."
                : "Hace falta tu decisión"}
          </Alert.Title>
          <DetalleFicha texto={mensaje.texto} />
          {mensaje.resuelta === null ? (
            <HStack mt={3}>
              <Button
                type="button"
                size="sm"
                disabled={ocupado}
                onClick={() => onDecidir(mensaje.jobId, true)}
                css={{
                  bg: "estado.ok",
                  color: "marca.papel",
                  borderRadius: "full",
                  _hover: { bg: "#164a30", color: "marca.papel" },
                  _disabled: { opacity: 0.75, bg: "estado.ok", color: "marca.papel" },
                }}
              >
                Aprobar
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={ocupado}
                onClick={() => onDecidir(mensaje.jobId, false)}
                css={{
                  bg: "transparent",
                  color: "estadoTexto.falla",
                  borderColor: "estadoTexto.falla",
                  borderRadius: "full",
                  _hover: { bg: "estado.fallaFondo", color: "estado.falla" },
                  _disabled: {
                    opacity: 0.75,
                    bg: "transparent",
                    color: "estadoTexto.falla",
                    borderColor: "estadoTexto.falla",
                  },
                }}
              >
                Rechazar
              </Button>
            </HStack>
          ) : null}
        </Alert.Content>
      </Alert.Root>
    )
  }

  if (mensaje.tipo === "nota") {
    return (
      <Flex justify="center">
        <Text
          fontSize="sm"
          color="fg.muted"
          textAlign="center"
          maxW="36rem"
          whiteSpace="pre-wrap"
          overflowWrap="anywhere"
        >
          {mensaje.texto}
        </Text>
      </Flex>
    )
  }

  if (mensaje.tipo === "persona") {
    const visible = textoVisible(mensaje.texto)
    const adjunto = mensaje.adjunto ?? fotoDesdeCita(mensaje.texto)
    return (
      <Flex justify="flex-end">
        <Box
          position="relative"
          maxW={{ base: "88%", md: "75%" }}
          bg="marca.sol"
          color="marca.carbon"
          px={4}
          py={3}
          borderTopRadius="20px"
          borderBottomLeftRadius="20px"
          borderBottomRightRadius="6px"
          boxShadow="0 8px 24px rgba(28, 27, 23, 0.08)"
          _dark={{ borderWidth: "1px", borderColor: "borde" }}
        >
          <Text as="span" srOnly>
            Vos
          </Text>
          {adjunto ? (
            <Stack gap={2} w="fit-content" maxW="100%">
              <ChipAdjunto id={adjunto.id} titulo={adjunto.titulo} detalle={adjunto.detalle} fondo="bg.panel" />
              {visible ? (
                <Text whiteSpace="pre-wrap" overflowWrap="anywhere">
                  {visible}
                </Text>
              ) : null}
            </Stack>
          ) : (
            <Text whiteSpace="pre-wrap" overflowWrap="anywhere">
              {visible}
            </Text>
          )}
        </Box>
      </Flex>
    )
  }

  return (
    <Flex justify="flex-start">
      <Box
        position="relative"
        maxW={{ base: "88%", md: "75%" }}
        bg="bg.panel"
        color="fg"
        px={4}
        py={3}
        borderRadius="20px"
        boxShadow="0 12px 40px rgba(28, 27, 23, 0.06)"
        _dark={{ borderWidth: "1px", borderColor: "borde" }}
      >
        <Text as="span" srOnly>
          Asistente
        </Text>
        <Text whiteSpace="pre-wrap" overflowWrap="anywhere">
          <TextoConEnlaces texto={mensaje.texto} />
        </Text>
      </Box>
    </Flex>
  )
}

export function Compositor({
  valor,
  onCambio,
  onEnviar,
  ocupado,
  bloqueado,
  adjunto = null,
  onQuitarAdjunto,
}: {
  valor: string
  onCambio: (valor: string) => void
  onEnviar: () => void
  ocupado: boolean
  bloqueado: boolean
  adjunto?: AdjuntoComprobante | null
  onQuitarAdjunto?: () => void
}) {
  const resumen = adjunto ? resumenAdjunto(adjunto) : null
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        onEnviar()
      }}
    >
      <Stack gap={2}>
        {bloqueado && !ocupado ? (
          <Text fontSize="sm" color="fg.muted">
            Resolvé la decisión pendiente para seguir.
          </Text>
        ) : null}
        <Stack direction={{ base: "column", sm: "row" }} gap={3} align={{ sm: "flex-end" }}>
          <Stack
            flex="1"
            w="100%"
            gap={1}
            borderRadius="24px"
            bg="bg.panel"
            borderWidth="1px"
            borderColor="borde"
            px={3}
            pt={adjunto ? 3 : 2}
            pb={2}
            css={{ "&:focus-within": { borderColor: "var(--chakra-colors-marca-sol)" } }}
          >
            {adjunto && resumen && onQuitarAdjunto ? (
              <ChipAdjunto id={adjunto.id} titulo={resumen.titulo} detalle={resumen.detalle} onQuitar={onQuitarAdjunto} />
            ) : null}
            <Textarea
              rows={2}
              borderWidth="0"
              borderRadius="16px"
              bg="transparent"
              color="fg"
              px={1}
              py={1}
              resize="none"
              focusRing="none"
              _placeholder={{ color: "fg.muted" }}
              _disabled={{ opacity: 1, bg: "transparent", color: "fg.muted" }}
              value={valor}
              disabled={ocupado || bloqueado}
              placeholder="Escribí tu pregunta"
              onChange={(event) => onCambio(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault()
                  onEnviar()
                }
              }}
            />
          </Stack>
          <Button
            type="submit"
            alignSelf={{ sm: "flex-end" }}
            borderRadius="full"
            loading={ocupado}
            disabled={bloqueado || valor.trim() === ""}
            css={{
              bg: "marca.sol",
              color: "marca.carbon",
              borderRadius: "full",
              _hover: { bg: "#e8bc45", color: "marca.carbon" },
              _disabled: {
                opacity: 1,
                bg: "#f0d48a",
                color: "marca.carbon",
                cursor: "not-allowed",
              },
            }}
          >
            Enviar
          </Button>
        </Stack>
      </Stack>
    </form>
  )
}
