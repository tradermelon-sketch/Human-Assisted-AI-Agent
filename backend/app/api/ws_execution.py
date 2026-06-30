import json
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from typing import Dict, Any
from backend.app.core.manifest import validate_manifest
from backend.app.executor.actions import read_file, scan_directory, write_file

router = APIRouter()

@router.websocket("/ws/execution")
async def websocket_execution_endpoint(websocket: WebSocket):
    """
    WebSocket Endpoint: WS /ws/execution
    
    Streams the real-time execution status of each action in the manifest to the client.
    
    Why this decision was taken:
    - Instead of a single HTTP response at the end of execution, a WebSocket stream gives 
      immediate, highly granular feedback to the user interface (e.g. stepper animations,
      active lines running, error highlights) as it happens on the disk.
    - Uses the exact same fail-fast execution logic as actions.py, but broadcasts 
      state transitions (pending -> running -> success/failed) step-by-step.
    """
    await websocket.accept()
    workspace_root = websocket.app.state.workspace_root
    
    try:
        while True:
            # Receive the JSON manifest payload from the client
            data = await websocket.receive_text()
            try:
                manifest = json.loads(data)
            except json.JSONDecodeError:
                await websocket.send_json({
                    "event": "error",
                    "message": "Malformed JSON payload provided to WebSocket execution."
                })
                continue
                
            actions = manifest.get("actions", [])
            if not actions:
                await websocket.send_json({
                    "event": "error",
                    "message": "No actions provided in the manifest."
                })
                continue

            # 1. Pre-flight validation check
            # We validate all actions first before running ANY write or read.
            # If any single action is invalid (path traversal, wrong parameters), we reject immediately.
            validation_results = validate_manifest(manifest, workspace_root)
            is_valid = all(action["valid"] for action in validation_results)
            
            if not is_valid:
                # Find the invalid actions and report them immediately
                invalid_details = [
                    {"index": r["index"], "error": r["error"]}
                    for r in validation_results if not r["valid"]
                ]
                await websocket.send_json({
                    "event": "preflight_failed",
                    "errors": invalid_details,
                    "message": "Execution aborted: one or more actions failed pre-flight security validation."
                })
                continue

            # 2. Inform client that pre-flight check succeeded and execution is beginning
            # We initialize the client with the full queue status so they can render a pending state.
            await websocket.send_json({
                "event": "started",
                "total_actions": len(actions),
                "actions": [
                    {
                        "index": i,
                        "type": action.get("type"),
                        "path": action.get("path"),
                        "status": "pending"
                    }
                    for i, action in enumerate(actions)
                ]
            })

            # 3. Execute actions sequentially (Fail-Fast)
            halted = False
            for i, action in enumerate(actions):
                if halted:
                    # Notify remaining aborted actions due to fail-fast
                    await websocket.send_json({
                        "event": "step_update",
                        "index": i,
                        "status": "aborted",
                        "error": "Prior step failed. Sequential execution halted."
                    })
                    continue

                val_info = validation_results[i]
                resolved_path = val_info["resolved_path"]
                action_type = action["type"]

                # Emit: Step is now 'running'
                await websocket.send_json({
                    "event": "step_update",
                    "index": i,
                    "status": "running"
                })

                try:
                    result = None
                    if action_type == "read_file":
                        content = read_file(resolved_path)
                        result = {"content": content}
                        
                    elif action_type == "scan_directory":
                        items = scan_directory(resolved_path)
                        result = {"items": items}
                        
                    elif action_type == "write_file":
                        write_file(resolved_path, action.get("content", ""))
                        result = "File written successfully"

                    # Emit: Step completed successfully
                    await websocket.send_json({
                        "event": "step_update",
                        "index": i,
                        "status": "success",
                        "result": result
                    })

                except Exception as e:
                    # Emit: Step failed
                    await websocket.send_json({
                        "event": "step_update",
                        "index": i,
                        "status": "failed",
                        "error": str(e)
                    })
                    halted = True # Trigger sequential halt

            # 4. Final summary event
            await websocket.send_json({
                "event": "completed",
                "success": not halted
            })

    except WebSocketDisconnect:
        # Secure cleanup if client disconnects mid-flight
        pass
