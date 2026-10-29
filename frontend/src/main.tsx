import { ChakraProvider } from "@chakra-ui/react"
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { BrowserRouter } from "react-router"
import { App } from "./App"
import { Avisos } from "./avisos"
import { ProveedorHogar } from "./hogar"
import { ProveedorSesion } from "./sesion"
import { sistema } from "./tema"
import { ProveedorTema } from "./temaModo"

const raiz = document.getElementById("root")
if (!raiz) throw new Error("Falta el nodo raíz")

createRoot(raiz).render(
  <StrictMode>
    <ChakraProvider value={sistema}>
      <ProveedorTema>
        <Avisos />
        <BrowserRouter>
          <ProveedorSesion>
            <ProveedorHogar>
              <App />
            </ProveedorHogar>
          </ProveedorSesion>
        </BrowserRouter>
      </ProveedorTema>
    </ChakraProvider>
  </StrictMode>,
)
