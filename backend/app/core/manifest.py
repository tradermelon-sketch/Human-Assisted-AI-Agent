import os
import json
from typing import Dict, Any, List, Tuple

# Whitelist of allowed actions as defined in the system specifications.
# Keeping a tight, hardcoded whitelist prevents any arbitrary action injection.
ALLOWED_ACTIONS = {"read_file", "scan_directory", "write_file"}

def parse_manifest(raw_json: str) -> Tuple[bool, Any, str]:
    """
    Parses raw JSON and returns (is_valid, parsed_manifest, error_message).
    Ensures that the input is a valid JSON structure representing a manifest.
    
    Decision explanation:
    We must use a safe JSON parser (Python's built-in json module) and handle exceptions
    to prevent malformed payloads from crashing the validation or routing pipeline.
    """
    try:
        data = json.loads(raw_json)
        if not isinstance(data, dict):
            return False, None, "Manifest must be a JSON object/dictionary."
        if "actions" not in data:
            return False, None, "Manifest must contain an 'actions' list."
        if not isinstance(data["actions"], list):
            return False, None, "'actions' field must be a list."
        return True, data, ""
    except json.JSONDecodeError as e:
        return False, None, f"Malformed JSON: {str(e)}"

def resolve_and_sandbox_path(path: str, workspace_root: str) -> Tuple[bool, str, str]:
    """
    Resolves and sandboxes a relative path against the workspace_root.
    Returns (is_safe, resolved_absolute_path, error_message).
    
    Why this decision is taken:
    Path traversal attacks (e.g. using '../../' or absolute paths like '/etc/passwd')
    can expose sensitive host files. To prevent this, we:
    1. Clean the workspace_root by resolving its absolute, real path (resolving symlinks too).
    2. Join the paths securely.
    3. Resolve the full destination path with os.path.realpath to eliminate '..' and symlinks.
    4. Check if the resolved destination path strictly starts with the resolved workspace path prefix.
    """
    # 1. Resolve workspace root to absolute, canonical form
    abs_root = os.path.realpath(workspace_root)
    
    # 2. Prevent absolute paths from bypassing our joining logic
    # If the provided path looks absolute (e.g., starts with '/' or 'C:\\'), we treat it
    # as relative to prevent it from replacing the workspace root when joined.
    safe_relative = path.lstrip(os.path.sep).lstrip("/")
    
    # 3. Join and resolve target path to its absolute, canonical form
    joined_path = os.path.join(abs_root, safe_relative)
    abs_target = os.path.realpath(joined_path)
    
    # 4. Enforce containment check
    # Check if the absolute target path is inside the absolute root.
    # Adding trailing separator prevents partial folder name matches, e.g., '/workspace_root_fake' matching '/workspace_root'
    prefix = abs_root if abs_root.endswith(os.path.sep) else abs_root + os.path.sep
    
    # If target is exactly the root itself, that is also safe
    if abs_target == abs_root:
        return True, abs_target, ""
        
    if not abs_target.startswith(prefix):
        return False, "", f"Path traversal detected: Path '{path}' resolves to '{abs_target}' which is outside workspace root '{abs_root}'"
        
    return True, abs_target, ""

def validate_manifest(manifest: Dict[str, Any], workspace_root: str) -> List[Dict[str, Any]]:
    """
    Validates each action in the manifest individually.
    Returns a list of dictionaries with validation status for each action:
    [
      {
        "index": int,
        "action": dict,
        "valid": bool,
        "error": str,
        "resolved_path": str (if safe)
      }
    ]
    
    Why this decision is taken:
    Instead of rejecting the entire manifest instantly, returning granular validation
    results per-action allows the user interface to display detailed diagnostic errors
    specifically next to the violating action, greatly improving debugging and trust.
    """
    results = []
    actions = manifest.get("actions", [])
    
    for i, action in enumerate(actions):
        res = {
            "index": i,
            "action": action,
            "valid": False,
            "error": "",
            "resolved_path": ""
        }
        
        # 1. Ensure action is a dictionary
        if not isinstance(action, dict):
            res["error"] = "Action entry must be a JSON object."
            results.append(res)
            continue
            
        action_type = action.get("type")
        action_path = action.get("path")
        
        # 2. Check if action type is in Whitelist
        if not action_type:
            res["error"] = "Missing required 'type' field in action."
            results.append(res)
            continue
        if action_type not in ALLOWED_ACTIONS:
            res["error"] = f"Action type '{action_type}' is not supported. Must be one of {list(ALLOWED_ACTIONS)}."
            results.append(res)
            continue
            
        # 3. Validate path parameter
        if action_path is None:
            res["error"] = "Missing required 'path' field in action."
            results.append(res)
            continue
        if not isinstance(action_path, str):
            res["error"] = f"Field 'path' must be a string, got {type(action_path).__name__}."
            results.append(res)
            continue
            
        # 4. Perform Sandbox and Path Traversal validation
        is_safe, resolved_path, err_msg = resolve_and_sandbox_path(action_path, workspace_root)
        if not is_safe:
            res["error"] = err_msg
            results.append(res)
            continue
            
        # 5. Type-specific parameter validation
        if action_type == "write_file":
            content = action.get("content")
            if content is None:
                res["error"] = "Missing required 'content' field for write_file action."
                results.append(res)
                continue
            if not isinstance(content, str):
                res["error"] = f"Field 'content' must be a string, got {type(content).__name__}."
                results.append(res)
                continue
                
        # If all checks pass, action is valid
        res["valid"] = True
        res["resolved_path"] = resolved_path
        results.append(res)
        
    return results

# ==============================================================================
# Unit Tests (Pytest compatible)
# To run these: pytest backend/app/core/manifest.py
# ==============================================================================
def test_parse_manifest_valid():
    raw = '{"actions": [{"type": "read_file", "path": "test.txt"}]}'
    is_valid, data, err = parse_manifest(raw)
    assert is_valid is True
    assert len(data["actions"]) == 1

def test_parse_manifest_invalid_json():
    raw = '{"actions": [{"type": "read_file", "path": "test.txt"}' # missing brackets
    is_valid, data, err = parse_manifest(raw)
    assert is_valid is False
    assert "Malformed JSON" in err

def test_path_traversal_detection():
    # Setup temporary mock workspace root
    temp_workspace = os.path.abspath("./mock_workspace")
    if not os.path.exists(temp_workspace):
        os.makedirs(temp_workspace)
        
    # Standard clean paths should succeed
    is_safe, path, err = resolve_and_sandbox_path("src/App.tsx", temp_workspace)
    assert is_safe is True
    assert path.startswith(os.path.realpath(temp_workspace))
    
    # Path traversal containing ".." escaping the root should fail
    is_safe, path, err = resolve_and_sandbox_path("../../etc/passwd", temp_workspace)
    assert is_safe is False
    assert "Path traversal detected" in err
    
    # Absolute path trying to escape root should fail
    is_safe, path, err = resolve_and_sandbox_path("/etc/passwd", temp_workspace)
    # The clean path resolver strips starting separators or ensures containment:
    # If absolute paths are processed, they must stay inside mock_workspace.
    # Our implementation treats absolute path as relative to mock_workspace to prevent escaping.
    # So `/etc/passwd` becomes `etc/passwd` inside mock_workspace which resolves safe.
    # Let's verify absolute path safety:
    assert is_safe is True
    assert os.path.realpath(temp_workspace) in path

    # Clean up mock workspace
    try:
        os.rmdir(temp_workspace)
    except Exception:
        pass
