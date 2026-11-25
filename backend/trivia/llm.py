"""The one place the backend talks to the Anthropic API (the admin game builder, answer explanations).

`anthropic` is imported lazily: the request path must not pay for it at cold start (trivia/tests/test_startup.py
guards that), and production does not install it at all until the owner turns the features on
(requirements-ai.txt). available() is how settings know whether it is there.
"""
import importlib.util

from django.conf import settings

FALLBACK_BETA = "server-side-fallback-2026-07-01"
# Models whose safety classifiers can decline a request and that accept the server-side fallback: a declined
# request is re-run on a fallback model inside the same call.
_FALLBACK_MODELS = ("claude-fable-5", "claude-mythos-5", "claude-opus-5", "claude-sonnet-5-5")


class LLMError(Exception):
    """A model call failed. The message is safe to show to the person waiting on it."""


def available():
    """Whether the SDK is installed. A spec lookup: it imports nothing."""
    return importlib.util.find_spec("anthropic") is not None


def _sdk():
    try:
        import anthropic
    except ImportError:
        raise LLMError("The AI features are not installed on this server.")
    return anthropic


def client(timeout):
    anthropic = _sdk()

    return anthropic.Anthropic(api_key=settings.ANTHROPIC_API_KEY, timeout=timeout, max_retries=1)


def fallback_kwargs(model):
    if model.startswith(_FALLBACK_MODELS):
        return {"betas": [FALLBACK_BETA], "fallbacks": "default"}
    return {}


def create(api, *, model, **kwargs):
    """One Messages call, with API failures turned into an LLMError. A refusal or a cut-off answer is an error too:
    neither is something a caller can use."""
    anthropic = _sdk()
    try:
        response = api.beta.messages.create(model=model, **kwargs, **fallback_kwargs(model))
    except anthropic.AuthenticationError:
        raise LLMError("The Anthropic API key was rejected.")
    except anthropic.RateLimitError:
        raise LLMError("The AI service is rate limited right now. Try again in a minute.")
    except anthropic.APITimeoutError:
        raise LLMError("The AI service took too long to answer. Try again.")
    except anthropic.APIConnectionError:
        raise LLMError("Could not reach the AI service.")
    except anthropic.APIStatusError as e:
        raise LLMError(f"The AI service returned an error ({e.status_code}).")
    if response.stop_reason == "refusal":
        raise LLMError("The model declined this request.")
    if response.stop_reason == "max_tokens":
        raise LLMError("The model's answer was cut off.")
    return response


def text_of(response):
    return "\n".join(b.text for b in response.content if b.type == "text" and b.text).strip()
