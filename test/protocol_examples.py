import json
from pathlib import Path

EXAMPLES = Path(__file__).resolve().parent.parent / "protocol" / "examples"


def example_text(file: str) -> str:
    return (EXAMPLES / f"{file}.json").read_text()


def example(file: str, /, **fields: object) -> dict:
    return json.loads(example_text(file)) | fields
