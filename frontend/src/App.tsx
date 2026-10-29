import { Route, Routes, Navigate } from "react-router"
import { MarcoPrivado } from "./componentes/MarcoPrivado"
import { Chat } from "./pantallas/Chat"
import { Cargar } from "./pantallas/Cargar"
import { Categorias } from "./pantallas/Categorias"
import { Ingreso } from "./pantallas/Ingreso"
import { Opciones } from "./pantallas/Opciones"
import { Registro } from "./pantallas/Registro"
import { Registros } from "./pantallas/Registros"
import { Revision } from "./pantallas/Revision"
import { Tablero } from "./pantallas/Tablero"

export function App() {
  return (
    <Routes>
      <Route path="/ingreso" element={<Ingreso />} />
      <Route path="/registro" element={<Registro />} />
      <Route element={<MarcoPrivado />}>
        <Route path="/" element={<Tablero />} />
        <Route path="/registros" element={<Registros />} />
        <Route path="/categorias" element={<Categorias />} />
        <Route path="/documentos/:id" element={<Revision />} />
        <Route path="/chat" element={<Chat />} />
        <Route path="/cargar" element={<Cargar />} />
        <Route path="/opciones" element={<Opciones />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
