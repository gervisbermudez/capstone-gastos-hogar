import { Box, Button, CloseButton, Drawer, Flex, Portal, Switch, useMediaQuery } from "@chakra-ui/react"
import { useEffect, useState } from "react"
import { Navigate, Outlet, useLocation, useNavigate } from "react-router"
import { ProveedorCanal } from "../canal"
import { useSesion } from "../sesion"
import { useTema } from "../temaModo"
import { BarraLateral, type Seccion } from "./BarraLateral"
import { Campana } from "./Campana"
import { EsqueletoMarco } from "./esqueleto"

function seccionActiva(pathname: string): Seccion | null {
  if (pathname === "/") return "tablero"
  if (pathname === "/registros" || pathname.startsWith("/documentos")) return "registros"
  if (pathname === "/categorias") return "categorias"
  if (pathname === "/cargar" || pathname.startsWith("/cargar")) return "cargar"
  if (pathname === "/chat" || pathname.startsWith("/chat")) return "chat"
  if (pathname === "/opciones") return "opciones"
  return null
}

export function MarcoPrivado() {
  const { token, listo, email, nombre, salir } = useSesion()
  const { oscuro, alternar } = useTema()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const [menuAbierto, setMenuAbierto] = useState(false)
  const [escritorio] = useMediaQuery(["(min-width: 768px)"], { ssr: false })

  useEffect(() => {
    if (escritorio) setMenuAbierto(false)
  }, [escritorio])

  useEffect(() => {
    setMenuAbierto(false)
  }, [pathname])

  if (!listo) return <EsqueletoMarco pathname={pathname} />
  if (!token) return <Navigate to="/ingreso" replace />

  function alSalir() {
    salir()
    navigate("/ingreso", { replace: true })
  }

  return (
    <Flex minH="100vh" h="100vh" direction="column" overflow="hidden" bg="transparent" p={{ base: 2, md: 3 }}>
      <Drawer.Root
        placement="start"
        open={menuAbierto}
        onOpenChange={(detalle) => setMenuAbierto(detalle.open)}
      >
        <Flex
          flex="1"
          minH={0}
          minW={0}
          direction={{ base: "column", md: "row" }}
          bg="bg"
          borderRadius="l3"
          overflow="hidden"
          boxShadow="0 24px 60px rgba(28, 27, 23, 0.12)"
          _dark={{ borderWidth: "1px", borderColor: "borde" }}
        >
          <Box
            as="aside"
            display={{ base: "none", md: "flex" }}
            flexDirection="column"
            w="240px"
            flexShrink={0}
            minH={0}
            bg="bg.subtle"
          >
            <BarraLateral activo={seccionActiva(pathname)} email={email} alias={nombre} onSalir={alSalir} />
          </Box>
          <ProveedorCanal>
            <Flex direction="column" flex="1" minW={0} minH={0}>
              <Flex
                align="center"
                justify="space-between"
                gap={3}
                px={{ base: 3, md: 4 }}
                h="56px"
                flexShrink={0}
                borderBottomWidth="1px"
                borderColor="borde"
              >
                <Box display={{ base: "block", md: "none" }}>
                  <Drawer.Trigger asChild>
                    <Button
                      variant="ghost"
                      bg="bg.panel"
                      color="fg"
                      borderRadius="full"
                      _hover={{ bg: "bg.hover", color: "fg" }}
                    >
                      Menú
                    </Button>
                  </Drawer.Trigger>
                </Box>
                <Box display={{ base: "none", md: "block" }} />
                <Flex align="center" gap={2}>
                  <Switch.Root
                    size="sm"
                    checked={oscuro}
                    aria-label={oscuro ? "Usar tema claro" : "Usar tema oscuro"}
                    onCheckedChange={(detalle) => {
                      if (detalle.checked !== oscuro) alternar()
                    }}
                  >
                    <Switch.HiddenInput />
                    <Switch.Control bg="bg.hover" _checked={{ bg: "marca.sol" }}>
                      <Switch.Thumb bg="fg" _checked={{ bg: "marca.carbon" }} />
                    </Switch.Control>
                    <Switch.Label srOnly>
                      {oscuro ? "Usar tema claro" : "Usar tema oscuro"}
                    </Switch.Label>
                  </Switch.Root>
                  <Campana />
                </Flex>
              </Flex>
              <Box
                as="main"
                flex="1"
                minH={0}
                minW={0}
                display="flex"
                flexDirection="column"
                overflow={pathname === "/chat" ? "hidden" : "auto"}
                px={pathname === "/chat" ? 0 : { base: 4, md: 6 }}
                py={pathname === "/chat" ? 0 : { base: 4, md: 6 }}
              >
                <Outlet />
              </Box>
            </Flex>
          </ProveedorCanal>
        </Flex>
        <Portal>
          <Drawer.Backdrop />
          <Drawer.Positioner>
            <Drawer.Content
              bg="bg.subtle"
              color="fg"
              w="240px"
              maxW="85vw"
              h="100dvh"
              borderTopRightRadius="l3"
              borderBottomRightRadius="l3"
              overflow="hidden"
            >
              <Drawer.Title srOnly>Menú</Drawer.Title>
              <Drawer.Body px={0} py={0} flex="1" minH={0} display="flex" flexDirection="column" overflowY="auto">
                <BarraLateral
                  activo={seccionActiva(pathname)}
                  email={email}
                  alias={nombre}
                  onSalir={alSalir}
                  onNavigate={() => setMenuAbierto(false)}
                />
              </Drawer.Body>
              <Drawer.CloseTrigger asChild>
                <CloseButton aria-label="Cerrar" color="fg" />
              </Drawer.CloseTrigger>
            </Drawer.Content>
          </Drawer.Positioner>
        </Portal>
      </Drawer.Root>
    </Flex>
  )
}
