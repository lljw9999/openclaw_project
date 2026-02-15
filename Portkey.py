import os
from portkey_ai import Portkey

portkey = Portkey(
  base_url = os.environ.get("PORTKEY_BASE_URL", "https://ai-gateway.apps.cloud.rt.nyu.edu/v1"),
  api_key = os.environ["PORTKEY_API_KEY"]
)

response = portkey.chat.completions.create(
    model = "@vertexai/anthropic.claude-opus-4-5@20251101",
    messages = [
      {"role": "system", "content": "You are a helpful assistant."},
      {"role": "user", "content": "What is Portkey"}
    ],
    MAX_TOKENS = 512
)

print(response.choices[0].message.content)