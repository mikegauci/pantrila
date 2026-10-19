"""Bound request bodies before JSON parsing, including requests without Content-Length."""

from starlette.responses import JSONResponse


class RequestSizeLimit:
    def __init__(self, app, max_bytes: int = 24_000_000):
        self.app, self.max_bytes = app, max_bytes

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        messages, size = [], 0
        while True:
            message = await receive()
            if message["type"] == "http.disconnect":
                return
            size += len(message.get("body", b""))
            if size > self.max_bytes:
                return await JSONResponse(
                    {"detail": "This upload is too large. Use fewer or smaller photos."},
                    status_code=413,
                )(scope, receive, send)
            messages.append(message)
            if not message.get("more_body", False):
                break
        pending = iter(messages)

        async def bounded_receive():
            message = next(pending, None)
            return message if message is not None else await receive()

        await self.app(scope, bounded_receive, send)
