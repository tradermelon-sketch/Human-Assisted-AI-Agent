from fastapi import APIRouter, Request, HTTPException
from pydantic import BaseModel, Field
from typing import List, Dict, Any
from backend.app.core.manifest import validate_manifest, parse_manifest
from backend.app.executor.actions import execute_manifest
from backend.app.memory.store import memory_store

router = APIRouter()

class ActionModel(BaseModel):
    type: str = Field(..., description="Action type: read_file, scan_directory, or write_file")
    path: str = Field(..., description="Path relative to the workspace root")
    content: str = Field(None, description="File content (required only for write_file)")

class ManifestModel(BaseModel):
    actions: List[ActionModel] = Field(..., description="List of proposed filesystem actions")

@router.get("/memory/status")
async def get_memory_status():
    """
    Endpoint: GET /api/memory/status
    
    Returns a list of all indexed files currently resident in our persistent vector store
    along with their last-updated timestamps and content hashes.
    """
    try:
        status_list = memory_store.get_status()
        return {
            "status": "success",
            "indexed_files": status_list,
            "count": len(status_list)
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to fetch memory status: {str(e)}")

@router.post("/manifest/validate")
async def validate_manifest_endpoint(request: Request, payload: Dict[str, Any]):
    """
    Endpoint: POST /api/manifest/validate
    
    Receives raw manifest JSON and returns a highly detailed, granular validation report
    per-action, conforming to our contract.
    
    Why this decision was taken:
    - Path validation and safety checking are executed on the backend.
    - Path traversal or whitelist failures are marked per-action, letting the frontend
      highlight exactly which items are safe (valid) vs unsafe (invalid) before the user clicks Approve.
    """
    workspace_root = request.app.state.workspace_root
    
    # We validate the schema structurally first
    validation_report = validate_manifest(payload, workspace_root)
    
    # Check if there's any absolute show-stopper
    is_overall_valid = all(action["valid"] for action in validation_report)
    
    return {
        "valid": is_overall_valid,
        "results": validation_report
    }

@router.post("/manifest/execute")
async def execute_manifest_endpoint(request: Request, payload: Dict[str, Any]):
    """
    Endpoint: POST /api/manifest/execute
    
    Executes a validated manifest of actions.
    
    Why this decision was taken:
    - This is the manual approval execution path.
    - Uses the sequential, fail-fast implementation from actions.py.
    - Aborts execution immediately at the first failure to prevent corrupted filesystem states.
    - Hooked to Vector Memory: Succeeded read_file and write_file actions are automatically
      chunked, embedded via Ollama (or safe mock), and indexed in the persistent vector store.
    """
    workspace_root = request.app.state.workspace_root
    
    try:
        execution_report = execute_manifest(payload, workspace_root)
        
        # Determine if execution succeeded completely or failed partially
        any_failed = any(action["status"] == "failed" for action in execution_report)
        status = "failed" if any_failed else "success"
        
        # Optional integration to Vector Memory Store for succeeded reads and writes
        for item in execution_report:
            if item["status"] == "success":
                try:
                    # Index the file on a successful read
                    if item["type"] == "read_file" and item["result"] and "content" in item["result"]:
                        memory_store.index_or_update_file(item["path"], item["result"]["content"])
                    # Index the file on a successful write
                    elif item["type"] == "write_file":
                        # Find the original write payload content
                        orig_action = next((act for act in payload.get("actions", []) if act.get("path") == item["path"]), None)
                        if orig_action and "content" in orig_action:
                            memory_store.index_or_update_file(item["path"], orig_action["content"])
                except Exception as mem_err:
                    # Print or log memory failure, but do NOT fail the execution report since
                    # file write/read succeeded on filesystem level and indexing is secondary memory.
                    print(f"Vector memory indexing warning: {mem_err}")
        
        return {
            "status": status,
            "report": execution_report
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Execution server error: {str(e)}")

