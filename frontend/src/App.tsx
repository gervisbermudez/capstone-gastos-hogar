import { Route, Routes, Navigate } from "react-router"
import { MarcoPrivado } from "./componentes/MarcoPrivado"
import { Chat } from "./pantallas/Chat"
import { Ingreso } from "./pantallas/Ingreso"
import { Registro } from "./pantallas/Registro"
import { Revision } from "./pantallas/Revision"
import { Tablero } from "./pantallas/Tablero"

export function App() {
  return (
    <Routes>
      <Route path="/ingreso" element={<Ingreso />} />
      <Route path="/registro" element={<Registro />} />
      <Route element={<MarcoPrivado />}>
        <Route path="/" element={<Tablero />} />
        <Route path="/documentos/:id" element={<Revision />} />
        <Route path="/chat" element={<Chat />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
