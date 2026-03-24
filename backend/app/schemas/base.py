from pydantic import BaseModel


class ErrorResponse(BaseModel):
    code: str
    detail: str


ERROR_RESPONSES = {
    401: {"model": ErrorResponse, "description": "Not authenticated"},
    403: {"model": ErrorResponse, "description": "Forbidden"},
    404: {"model": ErrorResponse, "description": "Not found"},
}