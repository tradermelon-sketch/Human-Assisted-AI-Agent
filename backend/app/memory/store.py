import os
import hashlib
import json
import math
from typing import List, Dict, Any, Tuple
from backend.app.memory.embeddings import get_embedding
from backend.app.memory.chunking_ast import chunk_file

# Try to import chromadb, but fall back gracefully if not installed
try:
    import chromadb
    from chromadb.config import Settings
    HAS_CHROMADB = True
except ImportError:
    HAS_CHROMADB = False

PERSIST_DIR = "./chroma_db"
FALLBACK_FILE = "./chroma_fallback.json"

class FallbackVectorStore:
    """
    A pure-Python vector store that acts as a fallback if the 'chromadb' library
    is not installed or fails to compile in the container environment.
    
    Why this decision was taken:
    - ChromaDB has native C++ dependencies that can fail to build on sandboxed environments.
    - Having a lightweight, reliable, file-backed JSON store guarantees that the AI system's
      indexing, deduplication, content-hashing, and top-K search function perfectly out-of-the-box,
      maintaining pristine execution with zero environment headaches.
    """
    def __init__(self, filepath: str = FALLBACK_FILE):
        self.filepath = filepath
        self.data = {
            "files": {},      # filename -> {"hash": str, "timestamp": float}
            "chunks": []      # list of {"id": str, "filename": str, "content": str, "vector": list, "metadata": dict}
        }
        self.load()

    def load(self):
        if os.path.exists(self.filepath):
            try:
                with open(self.filepath, "r", encoding="utf-8") as f:
                    self.data = json.load(f)
            except Exception:
                pass # Use default empty if file is corrupt or empty

    def save(self):
        try:
            with open(self.filepath, "w", encoding="utf-8") as f:
                json.dump(self.data, f, indent=2)
        except Exception as e:
            print(f"Error saving fallback vector store: {e}")

    def delete_by_filename(self, filename: str):
        self.data["chunks"] = [c for c in self.data["chunks"] if c["filename"] != filename]
        if filename in self.data["files"]:
            del self.data["files"][filename]

    def add_chunks(self, filename: str, file_hash: str, chunks: List[Dict[str, Any]]):
        # 1. Clean old entries for this file to prevent duplicates
        self.delete_by_filename(filename)
        
        # 2. Add new chunks
        import time
        self.data["files"][filename] = {
            "hash": file_hash,
            "timestamp": time.time()
        }
        
        for i, chunk in enumerate(chunks):
            content = chunk["content"]
            vector = get_embedding(content)
            
            chunk_id = f"{filename}#chunk_{i}"
            self.data["chunks"].append({
                "id": chunk_id,
                "filename": filename,
                "content": content,
                "vector": vector,
                "metadata": chunk.get("metadata", {})
            })
            
        self.save()

    def get_file_hash(self, filename: str) -> str:
        return self.data["files"].get(filename, {}).get("hash", "")

    def get_status(self) -> List[Dict[str, Any]]:
        status = []
        for filename, info in self.data["files"].items():
            status.append({
                "filename": filename,
                "hash": info["hash"],
                "last_updated": info["timestamp"]
            })
        return status

    def top_k_search(self, query: str, k: int = 5) -> List[Dict[str, Any]]:
        query_vector = get_embedding(query)
        if not self.data["chunks"]:
            return []
            
        def cosine_similarity(v1, v2):
            if not v1 or not v2:
                return 0.0
            # Ensure safe length comparison
            length = min(len(v1), len(v2))
            dot_product = sum(v1[i] * v2[i] for i in range(length))
            norm1 = math.sqrt(sum(v1[i] ** 2 for i in range(length)))
            norm2 = math.sqrt(sum(v2[i] ** 2 for i in range(length)))
            if norm1 == 0 or norm2 == 0:
                return 0.0
            return dot_product / (norm1 * norm2)

        scored_chunks = []
        for chunk in self.data["chunks"]:
            score = cosine_similarity(query_vector, chunk["vector"])
            scored_chunks.append({
                "id": chunk["id"],
                "filename": chunk["filename"],
                "content": chunk["content"],
                "score": score,
                "metadata": chunk["metadata"]
            })
            
        # Sort by similarity score descending
        scored_chunks.sort(key=lambda x: x["score"], reverse=True)
        return scored_chunks[:k]


class ChromaDBStore:
    """
    Standard ChromaDB integrated store. Falls back to FallbackVectorStore if not available.
    """
    def __init__(self):
        self.use_fallback = not HAS_CHROMADB
        if self.use_fallback:
            self.store = FallbackVectorStore()
        else:
            try:
                self.client = chromadb.PersistentClient(path=PERSIST_DIR)
                self.collection = self.client.get_or_create_collection(
                    name="workspace_memory",
                    metadata={"hnsw:space": "cosine"}
                )
                # Keep a separate file ledger to maintain file hashes and timestamps easily
                self.ledger_path = os.path.join(PERSIST_DIR, "file_ledger.json")
                self.ledger = {}
                self.load_ledger()
            except Exception as e:
                print(f"Error initializing ChromaDB: {e}. Falling back to fallback JSON store.")
                self.use_fallback = True
                self.store = FallbackVectorStore()

    def load_ledger(self):
        if os.path.exists(self.ledger_path):
            try:
                with open(self.ledger_path, "r", encoding="utf-8") as f:
                    self.ledger = json.load(f)
            except Exception:
                self.ledger = {}

    def save_ledger(self):
        try:
            os.makedirs(os.path.dirname(self.ledger_path), exist_ok=True)
            with open(self.ledger_path, "w", encoding="utf-8") as f:
                json.dump(self.ledger, f, indent=2)
        except Exception as e:
            print(f"Error saving file ledger: {e}")

    def get_status(self) -> List[Dict[str, Any]]:
        if self.use_fallback:
            return self.store.get_status()
            
        status = []
        for filename, info in self.ledger.items():
            status.append({
                "filename": filename,
                "hash": info["hash"],
                "last_updated": info["timestamp"]
            })
        return status

    def delete_by_filename(self, filename: str):
        if self.use_fallback:
            self.store.delete_by_filename(filename)
            return
            
        # ChromaDB deletes by metadata filtering
        try:
            self.collection.delete(where={"filename": filename})
        except Exception:
            pass
        if filename in self.ledger:
            del self.ledger[filename]
            self.save_ledger()

    def index_or_update_file(self, filename: str, content: str) -> bool:
        """
        Check-and-update algorithm:
        1. Calculate MD5 hash of the file content.
        2. Compare hash against stored ledger.
        3. If hash is identical, skip chunking/re-embedding (performance boost!).
        4. If hash is different or doesn't exist, delete old chunks, run chunking, and insert new chunks.
        
        Returns True if newly indexed/updated, False if skipped because hash was unchanged.
        """
        file_hash = hashlib.md5(content.encode("utf-8")).hexdigest()
        
        # Check if hash matches
        current_hash = self.store.get_file_hash(filename) if self.use_fallback else self.ledger.get(filename, {}).get("hash", "")
        if current_hash == file_hash:
            return False # Unchanged, skip
            
        # Perform chunking
        chunks = chunk_file(content, filename)
        if not chunks:
            return False
            
        if self.use_fallback:
            self.store.add_chunks(filename, file_hash, chunks)
            return True
            
        # Standard ChromaDB flow
        self.delete_by_filename(filename)
        
        import time
        self.ledger[filename] = {
            "hash": file_hash,
            "timestamp": time.time()
        }
        self.save_ledger()
        
        ids = []
        documents = []
        embeddings = []
        metadatas = []
        
        for i, chunk in enumerate(chunks):
            chunk_content = chunk["content"]
            vector = get_embedding(chunk_content)
            
            ids.append(f"{filename}#chunk_{i}")
            documents.append(chunk_content)
            embeddings.append(vector)
            
            # Metadata must be simple types for Chroma
            meta = {
                "filename": filename,
                "type": chunk["type"],
                "name": chunk["name"],
                "start_line": chunk["start_line"],
                "end_line": chunk["end_line"]
            }
            metadatas.append(meta)
            
        try:
            self.collection.add(
                ids=ids,
                documents=documents,
                embeddings=embeddings,
                metadatas=metadatas
            )
        except Exception as e:
            print(f"Error adding to ChromaDB: {e}")
            
        return True

    def top_k_search(self, query: str, k: int = 5) -> List[Dict[str, Any]]:
        if self.use_fallback:
            return self.store.top_k_search(query, k)
            
        try:
            query_vector = get_embedding(query)
            results = self.collection.query(
                query_embeddings=[query_vector],
                n_results=k
            )
            
            formatted = []
            if results and results["ids"] and len(results["ids"][0]) > 0:
                for i in range(len(results["ids"][0])):
                    formatted.append({
                        "id": results["ids"][0][i],
                        "filename": results["metadatas"][0][i]["filename"],
                        "content": results["documents"][0][i],
                        "score": results["distances"][0][i] if results["distances"] else 1.0,
                        "metadata": results["metadatas"][0][i]
                    })
            return formatted
        except Exception as e:
            print(f"Error searching ChromaDB: {e}")
            return []

# Singleton instance of memory store for easy import across modules
memory_store = ChromaDBStore()
