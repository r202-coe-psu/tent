import typing as t

from fastapi import HTTPException, status


class DuplicatedError(HTTPException):
    def __init__(self, detail: t.Any = None, headers: dict[str, t.Any] | None = None) -> None:
        super().__init__(status.HTTP_400_BAD_REQUEST, detail, headers)


class MismatchError(HTTPException):
    def __init__(self, detail: t.Any = None, headers: dict[str, t.Any] | None = None) -> None:
        super().__init__(status.HTTP_400_BAD_REQUEST, detail, headers)


class AuthError(HTTPException):
    def __init__(self, detail: t.Any = None, headers: dict[str, t.Any] | None = None) -> None:
        super().__init__(status.HTTP_401_UNAUTHORIZED, detail, headers)


class NotFoundError(HTTPException):
    def __init__(self, detail: t.Any = None, headers: dict[str, t.Any] | None = None) -> None:
        super().__init__(status.HTTP_404_NOT_FOUND, detail, headers)


class ValidationError(HTTPException):
    def __init__(
        self,
        detail: t.Any = None,
        headers: dict[str, t.Any] | None = None,
        field: str | None = None,
    ) -> None:
        if field:
            detail = {"message": detail, "field": field}
        super().__init__(status.HTTP_422_UNPROCESSABLE_CONTENT, detail, headers)


class ConflictError(HTTPException):
    def __init__(self, detail: t.Any = None, headers: dict[str, t.Any] | None = None) -> None:
        super().__init__(status.HTTP_409_CONFLICT, detail, headers)


class NoPermission(HTTPException):
    def __init__(self, detail: t.Any = None, headers: dict[str, t.Any] | None = None) -> None:
        super().__init__(status.HTTP_403_FORBIDDEN, detail, headers)


class BusinessLogicError(HTTPException):
    def __init__(
        self,
        detail: t.Any = None,
        headers: dict[str, t.Any] | None = None,
        code: str | None = None,
    ) -> None:
        if code:
            detail = {"message": detail, "code": code}
        super().__init__(status.HTTP_400_BAD_REQUEST, detail, headers)
