import { Box, Button, CloseButton, Drawer, Flex, Portal, useMediaQuery } from "@chakra-ui/react"
import { useEffect, useState } from "react"
import { Navigate, Outlet, useLocation, useNavigate } from "react-router"
import { useSesion } from "../sesion"
import { BarraLateral, type Seccion } from "./BarraLateral"
import { Cargando } from "./Cargando"

function seccionActiva(pathname: string): Seccion | null {
  if (pathname === "/" || pathname.startsWith("/documentos")) return "tablero"
  if (pathname === "/registros") return "registros"
  if (pathname === "/cargar" || pathname.startsWith("/cargar")) return "cargar"
  if (pathname === "/chat" || pathname.startsWith("/chat")) return "chat"
  return null
}

export function MarcoPrivado() {
  const { token, listo, email, salir } = useSesion()
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

  if (!listo) return <Cargando texto="Cargando la sesión" completo />
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
          bg="marca.lino"
          borderRadius="l3"
          overflow="hidden"
          boxShadow="0 24px 60px rgba(28, 27, 23, 0.12)"
        >
          <Box
            as="aside"
            display={{ base: "none", md: "flex" }}
            flexDirection="column"
            w="240px"
            flexShrink={0}
            minH={0}
            bg="marca.alabastro"
          >
            <BarraLateral activo={seccionActiva(pathname)} email={email} onSalir={alSalir} />
          </Box>
          <Flex direction="column" flex="1" minW={0} minH={0}>
            <Box display={{ base: "block", md: "none" }} px={4} pt={4} flexShrink={0}>
              <Drawer.Trigger asChild>
                <Button
                  variant="ghost"
                  bg="marca.papel"
                  color="marca.carbon"
                  borderRadius="full"
                  _hover={{ bg: "marca.alabastro", color: "marca.carbon" }}
                >
                  Menú
                </Button>
              </Drawer.Trigger>
            </Box>
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
        </Flex>
        <Portal>
          <Drawer.Backdrop />
          <Drawer.Positioner>
            <Drawer.Content
              bg="marca.alabastro"
              color="marca.carbon"
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
                  onSalir={alSalir}
                  onNavigate={() => setMenuAbierto(false)}
                />
              </Drawer.Body>
              <Drawer.CloseTrigger asChild>
                <CloseButton aria-label="Cerrar" color="marca.carbon" />
              </Drawer.CloseTrigger>
            </Drawer.Content>
          </Drawer.Positioner>
        </Portal>
      </Drawer.Root>
    </Flex>
  )
}
