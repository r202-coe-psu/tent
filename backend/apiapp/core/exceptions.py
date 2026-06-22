from fastapi import HTTPException, status
import typing as t

class NotFoundError(HTTPException):
    def __init__(self, detail: t.Any = None, headers: t.Optional[t.Dict[str, t.Any]] = None) -> None:
        super().__init__(status.HTTP_404_NOT_FOUND, detail, headers)

class ValidationError(HTTPException):
    def __init__(self, detail: t.Any = None, headers: t.Optional[t.Dict[str, t.Any]] = None, field: t.Optional[str] = None) -> None:
        if field:
            detail = {"message": detail, "field": field}
        super().__init__(status.HTTP_422_UNPROCESSABLE_ENTITY, detail, headers)
