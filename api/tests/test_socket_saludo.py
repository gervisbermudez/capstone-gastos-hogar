"""El primer mensaje del socket trae el token. No va en la URL."""

import json

from app.auth import emitir_token, usuario_de_saludo

SECRETO = "secreto-de-test-aislado-con-32-bytes"


def test_saludo_sin_token() -> None:
    assert usuario_de_saludo("") is None
    assert usuario_de_saludo("no es json") is None
    assert usuario_de_saludo("[]") is None
    assert usuario_de_saludo('{"token": ""}') is None
    assert usuario_de_saludo('{"otro": "x"}') is None


def test_saludo_con_token(monkeypatch) -> None:
    monkeypatch.setenv("JWT_SECRET", SECRETO)
    token = emitir_token("user-1")
    assert usuario_de_saludo(json.dumps({"token": token})) == "user-1"
    assert usuario_de_saludo(json.dumps({"token": "no-es-un-jwt"})) is None
