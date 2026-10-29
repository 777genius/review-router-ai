"""Test-only loopback provider. Never copied into the production image."""
import json
import threading
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


def schema_value(schema, root, depth=0):
    """Produce a deterministic no-finding response to the requested schema."""
    if depth > 20:
        raise ValueError("recursive_fixture_schema")
    if "$ref" in schema:
        node = root
        for part in schema["$ref"].split("/")[1:]:
            node = node[part]
        return schema_value(node, root, depth + 1)
    if "default" in schema:
        return schema["default"]
    if "anyOf" in schema:
        option = next((s for s in schema["anyOf"] if s.get("type") != "null"), schema["anyOf"][0])
        return schema_value(option, root, depth + 1)
    if "enum" in schema:
        options = schema["enum"]
        return next((s for s in options if str(s).lower() in ("benign", "safe", "none", "low", "allow")), options[0])
    kind = schema.get("type")
    if kind == "array":
        return []
    if kind == "object" or "properties" in schema:
        return {key: schema_value(value, root, depth + 1) for key, value in schema.get("properties", {}).items()
                if key in schema.get("required", [])}
    if kind == "boolean":
        return False
    if kind in ("number", "integer"):
        return max(0, schema.get("minimum", 0))
    if kind == "null":
        return None
    return "Fixture analysis found no issue."


@contextmanager
def loopback_model():
    received = []

    class Provider(BaseHTTPRequestHandler):
        def log_message(self, *_):
            pass

        def do_POST(self):
            if self.path != "/v1/chat/completions" or self.headers.get("Authorization") != "Bearer fixture-model-key":
                self.send_error(403)
                return
            length = int(self.headers.get("Content-Length", "0"))
            if not 0 < length <= 131072:
                self.send_error(413)
                return
            payload = json.loads(self.rfile.read(length))
            received.append(payload)
            if payload.get("tools"):
                tool = payload["tools"][0]["function"]
                arguments = schema_value(tool["parameters"], tool["parameters"])
                message = {"role": "assistant", "content": None, "tool_calls": [{"id": "fixture-call", "type": "function",
                    "function": {"name": tool["name"], "arguments": json.dumps(arguments)}}]}
                finish = "tool_calls"
            else:
                schema = payload.get("response_format", {}).get("json_schema", {}).get("schema")
                message = {"role": "assistant", "content": json.dumps(schema_value(schema, schema)) if schema else "OK"}
                finish = "stop"
            response = {"id": "fixture", "object": "chat.completion", "created": 1, "model": "fixture-model",
                "choices": [{"index": 0, "finish_reason": finish, "message": message}],
                "usage": {"prompt_tokens": 100, "completion_tokens": 10, "total_tokens": 110}}
            body = json.dumps(response).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

    server = ThreadingHTTPServer(("127.0.0.1", 0), Provider)
    server.daemon_threads = True
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{server.server_port}", received
    finally:
        server.shutdown()
        server.server_close()
        thread.join(2)
