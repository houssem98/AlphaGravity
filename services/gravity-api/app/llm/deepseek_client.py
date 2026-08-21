"""
Gravity Search — DeepSeek Client
DeepSeek V3.2: 95% cheaper than frontier models ($0.28/$0.42 per M tokens).
Uses OpenAI-compatible API format.
"""

import time
from typing import AsyncIterator

import openai
import structlog

from app.config import settings
from app.llm.base import BaseLLMClient, LLMConfig, LLMMessage, LLMResponse, ModelProvider

logger = structlog.get_logger()

PRICING = {
    "deepseek-chat": {"input": 0.28, "output": 0.42},
    "deepseek-v4-flash": {"input": 0.28, "output": 0.42},
}


class DeepSeekClient(BaseLLMClient):
    provider = ModelProvider.DEEPSEEK

    def __init__(self, model_id: str = "deepseek-chat"):
        self.model_id = model_id
        self.client = openai.AsyncOpenAI(
            api_key=settings.deepseek_api_key,
            base_url="https://api.deepseek.com",
        )

    async def generate(self, messages: list[LLMMessage], config: LLMConfig | None = None) -> LLMResponse:
        from app.llm.headroom import compress_messages
        config = config or LLMConfig()
        messages = await compress_messages(messages, self.model_id)
        api_msgs = [{"role": m.role, "content": m.content} for m in messages]
        start = time.perf_counter()
        response = await self.client.chat.completions.create(
            model=self.model_id, messages=api_msgs,
            max_tokens=config.max_tokens, temperature=config.temperature,
        )
        latency_ms = (time.perf_counter() - start) * 1000
        choice = response.choices[0]
        content = choice.message.content or ""
        # deepseek-v4-flash is a REASONING model: chain-of-thought goes to
        # `reasoning_content` and the answer to `content`. When reasoning alone
        # exhausts max_tokens the API returns finish_reason="length" with
        # content=None -- measured 17,726 chars of reasoning and 0 of answer on a
        # 4096-token budget. Returning that as a successful empty string makes the
        # pipeline emit a blank answer instead of falling through to the next
        # client, so the whole Company Brief renders "No data available".
        if not content.strip():
            reasoning = getattr(choice.message, "reasoning_content", None) or ""
            logger.warning(
                "deepseek_empty_content", model=self.model_id,
                finish_reason=choice.finish_reason, reasoning_chars=len(reasoning),
                max_tokens=config.max_tokens,
            )
            raise RuntimeError(
                f"{self.model_id} returned no content "
                f"(finish_reason={choice.finish_reason}, "
                f"reasoning_chars={len(reasoning)}, max_tokens={config.max_tokens})"
            )
        usage = response.usage
        inp, out = (usage.prompt_tokens if usage else 0), (usage.completion_tokens if usage else 0)
        return LLMResponse(content=content, model=self.model_id, input_tokens=inp,
                           output_tokens=out, latency_ms=latency_ms,
                           cost_usd=self._estimate_cost(inp, out))

    async def generate_stream(self, messages: list[LLMMessage], config: LLMConfig | None = None) -> AsyncIterator[str]:
        config = config or LLMConfig()
        api_msgs = [{"role": m.role, "content": m.content} for m in messages]
        stream = await self.client.chat.completions.create(
            model=self.model_id, messages=api_msgs,
            max_tokens=config.max_tokens, temperature=config.temperature, stream=True,
        )
        async for chunk in stream:
            if chunk.choices and chunk.choices[0].delta.content:
                yield chunk.choices[0].delta.content

    def _estimate_cost(self, input_tokens: int, output_tokens: int) -> float:
        p = PRICING.get(self.model_id, {"input": 0.28, "output": 0.42})
        return (input_tokens * p["input"] + output_tokens * p["output"]) / 1_000_000
