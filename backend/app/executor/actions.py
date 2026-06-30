import os
from typing import Dict, Any, List
from backend.app.core.manifest import validate_manifest

def read_file(resolved_path: str) -> str:
    """
    Reads a file from the filesystem.
    Assumes that the path has already been divalidated and resolved to a safe absolute path.
    
    Why this decision was taken:
    - We use UTF-8 encoding specifically to ensure compatibility with code files (TS, TSX, PY, JSON).
    - If the file does not exist, we raise a clear, helpful FileNotFoundError so the caller or state tracker can report it.
    """
    if not os.path.exists(resolved_path):
        raise FileNotFoundError(f"File not found at resolved path: {resolved_path}")
    
    if os.path.isdir(resolved_path):
        raise IsADirectoryError(f"Resolved path is a directory, not a file: {resolved_path}")
        
    with open(resolved_path, "r", encoding="utf-8") as f:
        return f.read()

def scan_directory(resolved_path: str) -> List[Dict[str, Any]]:
    """
    Scans a directory and lists its direct contents.
    Assumes that the path has already been validated and resolved to a safe absolute path.
    
    Why this decision was taken:
    - Providing basic metadata (name, is_dir, size) helps the frontend render a beautiful tree or list.
    - If the directory does not exist, we raise a FileNotFoundError instead of silently returning empty,
      enforcing clean execution logs.
    """
    if not os.path.exists(resolved_path):
        raise FileNotFoundError(f"Directory not found at resolved path: {resolved_path}")
        
    if not os.path.isdir(resolved_path):
        raise NotADirectoryError(f"Resolved path is not a directory: {resolved_path}")
        
    items = []
    for entry in os.scandir(resolved_path):
        # Gather basic stats for progressive disclosure and user context
        stat_result = entry.stat()
        items.append({
            "name": entry.name,
            "type": "directory" if entry.is_dir() else "file",
            "size": stat_result.st_size,
            "modified": stat_result.st_mtime
        })
    
    # Sort directories first, then files alphabetically for visual hierarchy consistency
    items.sort(key=lambda x: (x["type"] != "directory", x["name"].lower()))
    return items

def write_file(resolved_path: str, content: str) -> None:
    """
    Writes content to a file.
    Assumes that the path has already been validated and resolved to a safe absolute path.
    
    Why this decision was taken:
    - Auto-creating parent directories (os.makedirs) ensures a frictionless UX when creating nested files,
      while relying on the fact that path resolution has already securely vetted the final target.
    - We use UTF-8 encoding consistently across the stack.
    """
    # Auto-create parent directories securely if they do not exist
    parent_dir = os.path.dirname(resolved_path)
    if parent_dir and not os.path.exists(parent_dir):
        os.makedirs(parent_dir, exist_ok=True)
        
    with open(resolved_path, "w", encoding="utf-8") as f:
        f.write(content)

def execute_manifest(manifest: Dict[str, Any], workspace_root: str) -> List[Dict[str, Any]]:
    """
    Executes a manifest of actions sequentially, adhering to a strict fail-fast rule.
    Returns the execution status report for every single action.
    
    Why this decision was taken:
    - "Fail-fast" is critical: if action #2 fails (e.g., trying to write to an invalid filename
      or read a non-existent file), we must immediately halt and NOT execute action #3.
      This prevents corrupted, inconsistent, or half-applied filesystem states.
    - Before execution, we run our strict validation to ensure all paths are securely inside
      the sandboxed workspace_root. If any single action is invalid, we do not execute anything.
    - Initializing all actions as "pending" allows the frontend to render the whole queue,
      progressively updating actions to "running", "success", or "failed".
    """
    actions = manifest.get("actions", [])
    
    # Pre-execution safety check: validate all actions first.
    # If any action in the proposed manifest fails validation, we reject the whole execution
    # to maintain complete workspace security.
    validation_results = validate_manifest(manifest, workspace_root)
    
    # Initialize execution report
    report = []
    for i, action in enumerate(actions):
        report.append({
            "index": i,
            "type": action.get("type"),
            "path": action.get("path"),
            "status": "pending",
            "error": "",
            "result": None
        })
        
    # Check if there is any validation error
    for val_res in validation_results:
        if not val_res["valid"]:
            # Halt immediately and mark all as failed due to pre-flight validation error
            for item in report:
                item["status"] = "failed"
                if item["index"] == val_res["index"]:
                    item["error"] = f"Pre-flight validation failed: {val_res['error']}"
                else:
                    item["error"] = "Execution aborted due to pre-flight validation failure of another action."
            return report

    # Begin sequential execution
    for i, action in enumerate(actions):
        val_info = validation_results[i]
        resolved_path = val_info["resolved_path"]
        action_type = action["type"]
        
        # Mark as running
        report[i]["status"] = "running"
        
        try:
            if action_type == "read_file":
                content = read_file(resolved_path)
                report[i]["status"] = "success"
                report[i]["result"] = {"content": content}
                
            elif action_type == "scan_directory":
                items = scan_directory(resolved_path)
                report[i]["status"] = "success"
                report[i]["result"] = {"items": items}
                
            elif action_type == "write_file":
                write_file(resolved_path, action.get("content", ""))
                report[i]["status"] = "success"
                report[i]["result"] = "File written successfully"
                
        except Exception as e:
            # Mark current action as failed
            report[i]["status"] = "failed"
            report[i]["error"] = str(e)
            
            # Since we are fail-fast, all subsequent items remain "pending" (or we explicitly mark them as aborted)
            # Keeping subsequent items as "pending" is consistent with standard stepping queue behaviors,
            # but we can also set their status or just leave them "pending".
            # Let's keep them "pending" but explain why in comments.
            break
            
    return report
