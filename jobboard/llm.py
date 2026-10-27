"""One small client for several AI providers, configured by environment variables.

    LLM_PROVIDER   anthropic | openai | gemini | openai-compatible | ollama | none
    LLM_API_KEY    your key (not needed for ollama)
    LLM_MODEL      model name; required except for anthropic, which has a default
    LLM_BASE_URL   only for openai-compatible / ollama, e.g. https://api.groq.com/openai/v1

No SDKs: each provider is a single HTTPS call, so adding another is a few lines.
The key is only ever sent in a request header to the provider you chose.
"""

from __future__ import annotations

import json
import os
import re

DEFAULTS = {
    "anthropic": {"model": "claude-haiku-5-5"},
    "openai": {"base_url": "https://api.openai.com/v1"},
    "ollama": {"base_url": "http://localhost:11434/v1"},
}


class LLMError(RuntimeError):
    pass


class LLM:
    def __init__(self, http, provider: str, api_key: str = "", model: str = "", base_url: str = ""):
        self.http = http
        self.provider = (provider or "none").strip().lower()
        d = DEFAULTS.get(self.provider, {})
        self.api_key = api_key.strip()
        self.model = (model or d.get("model", "")).strip()
        self.base_url = (base_url or d.get("base_url", "")).rstrip("/")
        if self.provider in ("none", ""):
            return
        if self.provider not in ("anthropic", "openai", "gemini", "openai-compatible", "ollama"):
            raise LLMError(f"Unknown LLM_PROVIDER '{provider}'. Use anthropic, openai, gemini, openai-compatible, ollama or none.")
        if self.provider != "ollama" and not self.api_key:
            raise LLMError(f"LLM_PROVIDER is '{self.provider}' but LLM_API_KEY is empty.")
        if not self.model:
            raise LLMError(f"Set LLM_MODEL for provider '{self.provider}' (see your provider's model list).")
        if self.provider == "openai-compatible" and not self.base_url:
            raise LLMError("Set LLM_BASE_URL for the openai-compatible provider.")

    @classmethod
    def from_env(cls, http) -> "LLM":
        return cls(
            http,
            os.environ.get("LLM_PROVIDER", "none"),
            os.environ.get("LLM_API_KEY", ""),
            os.environ.get("LLM_MODEL", ""),
            os.environ.get("LLM_BASE_URL", ""),
        )

    @property
    def enabled(self) -> bool:
        return self.provider not in ("none", "")

    def describe(self) -> str:
        return f"{self.provider} ({self.model})" if self.enabled else "keyword scoring (no AI)"

    # ------------------------------------------------------------------ calls

    def complete(self, system: str, user: str, max_tokens: int = 1200) -> str:
        if self.provider == "anthropic":
            data = self.http.post_json(
                "https://api.anthropic.com/v1/messages",
                {"model": self.model, "max_tokens": max_tokens, "system": system,
                 "messages": [{"role": "user", "content": user}]},
                {"x-api-key": self.api_key, "anthropic-version": "2023-06-01"},
            )
            return "".join(b.get("text", "") for b in data.get("content", []) if b.get("type") == "text")

        if self.provider == "gemini":
            data = self.http.post_json(
                f"https://generativelanguage.googleapis.com/v1beta/models/{self.model}:generateContent",
                {"systemInstruction": {"parts": [{"text": system}]},
                 "contents": [{"role": "user", "parts": [{"text": user}]}],
                 "generationConfig": {"maxOutputTokens": max_tokens, "responseMimeType": "application/json"}},
                {"x-goog-api-key": self.api_key},
            )
            cands = data.get("candidates") or [{}]
            parts = (cands[0].get("content") or {}).get("parts") or []
            return "".join(p.get("text", "") for p in parts)

        # openai, openai-compatible, ollama: the Chat Completions shape
        headers = {"Authorization": f"Bearer {self.api_key}"} if self.api_key else {}
        # OpenAI's current models take max_completion_tokens; most compatible servers take max_tokens.
        limit_key = "max_completion_tokens" if self.provider == "openai" else "max_tokens"
        data = self.http.post_json(
            f"{self.base_url}/chat/completions",
            {"model": self.model, limit_key: max_tokens,
             "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}]},
            headers,
        )
        return ((data.get("choices") or [{}])[0].get("message") or {}).get("content") or ""

    def complete_json(self, system: str, user: str, max_tokens: int = 1200) -> dict:
        return parse_json(self.complete(system, user, max_tokens))


def parse_json(text: str) -> dict:
    """Read a JSON object from a model reply, tolerating code fences or a stray sentence."""
    s = (text or "").strip()
    fence = re.search(r"```(?:json)?\s*(.*?)```", s, re.S)
    if fence:
        s = fence.group(1).strip()
    try:
        v = json.loads(s)
    except json.JSONDecodeError:
        a, b = s.find("{"), s.rfind("}")
        if a < 0 or b <= a:
            raise LLMError("Model reply had no JSON object")
        v = json.loads(s[a: b + 1])
    if not isinstance(v, dict):
        raise LLMError("Model reply was JSON but not an object")
    return v
