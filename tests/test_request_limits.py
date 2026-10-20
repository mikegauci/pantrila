from fastapi import FastAPI, Request
from fastapi.testclient import TestClient

from pantrila.request_limits import RequestSizeLimit


def test_body_limit_counts_streamed_bytes_before_the_handler():
    app = FastAPI()
    calls = []
    app.add_middleware(RequestSizeLimit, max_bytes=10)

    @app.post("/")
    async def read(request: Request):
        calls.append(True)
        return {"bytes": len(await request.body())}

    with TestClient(app) as client:
        assert client.post("/", content=b"small").json() == {"bytes": 5}
        assert client.post("/", content=iter([b"123456", b"789012"])).status_code == 413
    assert calls == [True]
