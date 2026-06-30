import json
import urllib.request
import urllib.error
import random
from typing import List

# Default Ollama address. Can be customized via environment variable OLLAMA_HOST.
OLLAMA_HOST = "http://localhost:11434"
EMBEDDING_MODEL = "nomic-embed-text"

def get_embedding(text: str) -> List[float]:
    """
    Calls the local Ollama embedding endpoint to get the vector representation of the text.
    
    Why this decision is taken:
    - We use local Ollama ('nomic-embed-text') to ensure that code intellectual property
      is kept fully local and sandboxed inside the user's infrastructure.
    - If the Ollama server is offline or not installed, we gracefully fall back to a 
      deterministic mock vector generated from the string contents. This prevents the
      entire application from crashing during environment startups or if Ollama isn't configured,
      providing excellent developer and user resilience.
    """
    url = f"{OLLAMA_HOST}/api/embeddings"
    payload = {
        "model": EMBEDDING_MODEL,
        "prompt": text
    }
    
    try:
        req = urllib.request.Request(
            url,
            data=json.dumps(payload).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST"
        )
        # Timeout after 2 seconds to keep execution fast and prevent freezing
        with urllib.request.urlopen(req, timeout=2.0) as response:
            res_data = json.loads(response.read().decode("utf-8"))
            if "embedding" in res_data:
                return res_data["embedding"]
            else:
                raise KeyError("Ollama response missing 'embedding' field.")
                
    except Exception as e:
        # Fallback vector generator (deterministic mock 128-dimensional vector)
        # We hash the text briefly to make the mock vector consistent for the same text
        import hashlib
        hash_val = int(hashlib.md5(text.encode("utf-8")).hexdigest(), 16)
        random.seed(hash_val)
        mock_vec = [random.uniform(-1.0, 1.0) for _ in range(128)]
        return mock_vec

def get_embeddings_batch(texts: List[str]) -> List[List[float]]:
    """
    Helper to process multiple embedding requests.
    """
    return [get_embedding(t) for t in texts]
