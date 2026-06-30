import ast
from typing import List, Dict, Any

def chunk_python_code(source_code: str, filename: str = "source.py") -> List[Dict[str, Any]]:
    """
    Chunks Python source code using the AST (Abstract Syntax Tree) module.
    It identifies class definitions and function definitions, extracting them as
    whole, semantically-complete blocks of code.
    
    Why this decision is taken:
    - Splitting code by fixed character lengths or tokens often cuts class/function definitions
      in half, which destroys context for an AI or search system.
      AST-based chunking preserves complete declarations, docstrings, and context.
    - Global module-level statements are grouped together as module-level chunks.
    """
    chunks = []
    
    try:
        tree = ast.parse(source_code, filename=filename)
    except SyntaxError as e:
        # Fall back to paragraph-based chunking if there is a syntax error
        return chunk_text_fallback(source_code, filename, error=str(e))
        
    lines = source_code.splitlines()
    
    # Track which lines are part of functions or classes so we can collect global module-level lines
    processed_lines = set()
    
    def get_node_source(node: ast.AST) -> str:
        # ast.unparse is available in Python 3.9+, but slicing original text is safer and preserves comments/formatting
        start_line = node.lineno - 1
        end_line = getattr(node, "end_lineno", len(lines))
        return "\n".join(lines[start_line:end_line])

    # 1. Extract classes and functions
    for node in ast.walk(tree):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            # We only chunk top-level classes and top-level functions to avoid duplicate nested chunks
            # We can verify parentage or just use depth-first walking
            # Let's check if the node's line range is already enclosed in a class or function we already chunked
            start_line = node.lineno - 1
            end_line = getattr(node, "end_lineno", len(lines))
            
            # Extract content
            chunk_content = get_node_source(node)
            
            # Determine type label
            node_type = "function"
            if isinstance(node, ast.ClassDef):
                node_type = "class"
                
            chunks.append({
                "type": node_type,
                "name": node.name,
                "content": chunk_content,
                "start_line": start_line + 1,
                "end_line": end_line,
                "metadata": {
                    "filename": filename,
                    "entity_name": node.name,
                    "entity_type": node_type
                }
            })
            
            for l in range(start_line, end_line):
                processed_lines.add(l)
                
    # 2. Extract remaining global module-level chunks (e.g. imports, global variables)
    global_lines = []
    global_start = None
    
    for idx, line in enumerate(lines):
        if idx not in processed_lines:
            if global_start is None:
                global_start = idx
            global_lines.append(line)
        else:
            if global_lines:
                content = "\n".join(global_lines).strip()
                if content:
                    chunks.append({
                        "type": "module_level",
                        "name": "global_scope",
                        "content": content,
                        "start_line": global_start + 1,
                        "end_line": idx,
                        "metadata": {
                            "filename": filename,
                            "entity_name": "global_scope",
                            "entity_type": "module_level"
                        }
                    })
                global_lines = []
                global_start = None
                
    if global_lines:
        content = "\n".join(global_lines).strip()
        if content:
            chunks.append({
                "type": "module_level",
                "name": "global_scope",
                "content": content,
                "start_line": global_start + 1,
                "end_line": len(lines),
                "metadata": {
                    "filename": filename,
                    "entity_name": "global_scope",
                    "entity_type": "module_level"
                }
            })
            
    # Sort chunks by starting line so they are stored in logical order
    chunks.sort(key=lambda x: x["start_line"])
    return chunks

def chunk_text_fallback(content: str, filename: str, error: str = "") -> List[Dict[str, Any]]:
    """
    Standard paragraph/block chunker for non-Python files or files with syntax errors.
    
    Why this decision is taken:
    - The repository has React (.tsx) and TypeScript files, as well as configuration files.
      AST parsing for those is not native in Python without node-level parsers,
      so fallback block chunking by double newlines (paragraphs/blocks) keeps it general.
    """
    chunks = []
    paragraphs = content.split("\n\n")
    current_line = 1
    
    for idx, p in enumerate(paragraphs):
        p_strip = p.strip()
        if not p_strip:
            continue
            
        p_lines = p.splitlines()
        end_line = current_line + len(p_lines) - 1
        
        chunks.append({
            "type": "block",
            "name": f"block_{idx}",
            "content": p_strip,
            "start_line": current_line,
            "end_line": end_line,
            "metadata": {
                "filename": filename,
                "entity_name": f"block_{idx}",
                "entity_type": "text_block",
                "fallback_reason": error if error else "non_python_file"
            }
        })
        current_line = end_line + 2 # plus one for the empty double newline separation
        
    return chunks

def chunk_file(content: str, filename: str) -> List[Dict[str, Any]]:
    """
    Chooses the appropriate chunking strategy based on file extension.
    """
    if filename.endswith(".py"):
        return chunk_python_code(content, filename)
    else:
        return chunk_text_fallback(content, filename)
