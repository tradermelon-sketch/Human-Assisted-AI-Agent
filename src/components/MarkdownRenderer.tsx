import React from "react";

interface MarkdownRendererProps {
  content: string;
}

// Inline formatting: parses **bold** and `code` patterns
function parseInline(text: string): React.ReactNode[] {
  const elements: React.ReactNode[] = [];
  let currentText = "";
  let i = 0;
  
  while (i < text.length) {
    if (text.startsWith("**", i)) {
      if (currentText) {
        elements.push(<span key={`txt-${i}`}>{currentText}</span>);
        currentText = "";
      }
      const endIdx = text.indexOf("**", i + 2);
      if (endIdx !== -1) {
        const boldText = text.substring(i + 2, endIdx);
        elements.push(
          <strong key={`bold-${i}`} className="font-semibold text-gray-100 bg-[#30363d]/10 px-0.5 rounded-sm">
            {parseInline(boldText)}
          </strong>
        );
        i = endIdx + 2;
      } else {
        currentText += "**";
        i += 2;
      }
    } else if (text[i] === "`") {
      if (currentText) {
        elements.push(<span key={`txt-${i}`}>{currentText}</span>);
        currentText = "";
      }
      const endIdx = text.indexOf("`", i + 1);
      if (endIdx !== -1) {
        const codeText = text.substring(i + 1, endIdx);
        const isPath = codeText.includes("/") || codeText.includes(".") || codeText.endsWith("/");
        elements.push(
          <code 
            key={`code-${i}`} 
            className={`font-mono text-[11px] px-1.5 py-0.5 rounded border border-[#30363d]/70 ${
              isPath 
                ? "bg-[#1f242c] text-blue-300 font-medium" 
                : "bg-[#11141a] text-amber-300/90"
            }`}
          >
            {codeText}
          </code>
        );
        i = endIdx + 1;
      } else {
        currentText += "`";
        i += 1;
      }
    } else {
      currentText += text[i];
      i++;
    }
  }
  
  if (currentText) {
    elements.push(<span key={`txt-end`}>{currentText}</span>);
  }
  
  return elements;
}

export default function MarkdownRenderer({ content }: MarkdownRendererProps) {
  if (!content) return null;

  const lines = content.split("\n");
  const blocks: React.ReactNode[] = [];
  
  let currentListItems: string[] = [];
  let isInsideCodeBlock = false;
  let codeBlockLines: string[] = [];
  let codeBlockLang = "";

  const flushList = (key: number) => {
    if (currentListItems.length > 0) {
      blocks.push(
        <div key={`list-${key}`} className="space-y-1.5 my-2.5 pl-1.5">
          {currentListItems.map((item, idx) => (
            <div key={idx} className="flex items-start space-x-2.5 text-[13px] text-gray-300 leading-relaxed">
              <span className="text-[#58a6ff] mt-2 flex-shrink-0 select-none w-1.5 h-1.5 rounded-full bg-blue-500/80" />
              <div className="flex-1">{parseInline(item)}</div>
            </div>
          ))}
        </div>
      );
      currentListItems = [];
    }
  };

  const flushCodeBlock = (key: number) => {
    if (isInsideCodeBlock) {
      const code = codeBlockLines.join("\n");
      blocks.push(
        <div key={`code-block-${key}`} className="my-3.5 border border-[#30363d] rounded-lg overflow-hidden bg-[#090d13]">
          <div className="px-3 py-1.5 bg-[#161b22] border-b border-[#30363d] flex justify-between items-center text-[10px] font-mono text-gray-400 select-none">
            <span className="uppercase text-blue-400 font-semibold">{codeBlockLang || "code"}</span>
            <button 
              onClick={() => {
                navigator.clipboard.writeText(code);
              }}
              className="hover:text-white transition-colors flex items-center space-x-1 px-1.5 py-0.5 rounded hover:bg-[#21262d]"
            >
              <span>Salin</span>
            </button>
          </div>
          <pre className="p-3.5 text-[11px] font-mono overflow-auto text-gray-300 leading-relaxed max-h-[350px]">
            <code>{code}</code>
          </pre>
        </div>
      );
      codeBlockLines = [];
      isInsideCodeBlock = false;
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Code block check
    if (trimmed.startsWith("```")) {
      if (isInsideCodeBlock) {
        flushCodeBlock(i);
      } else {
        flushList(i);
        isInsideCodeBlock = true;
        codeBlockLang = trimmed.substring(3).trim();
      }
      continue;
    }

    if (isInsideCodeBlock) {
      codeBlockLines.push(line);
      continue;
    }

    // Horizontal rule check
    if (trimmed === "---") {
      flushList(i);
      blocks.push(<hr key={`hr-${i}`} className="border-[#30363d]/40 my-3.5" />);
      continue;
    }

    // List item check
    const listMatch = line.match(/^(\s*)([-*•]|\d+\.)\s+(.*)$/);
    if (listMatch) {
      const itemContent = listMatch[3];
      currentListItems.push(itemContent);
      continue;
    }

    // Header check
    if (trimmed.startsWith("#")) {
      flushList(i);
      const headerText = trimmed.replace(/^#+\s*/, "");
      
      blocks.push(
        <div key={`header-${i}`} className="flex items-center space-x-2 mt-4.5 mb-2.5 first:mt-1 pb-1 border-b border-[#30363d]/30">
          <div className="w-1 h-3.5 bg-[#58a6ff] rounded-sm"></div>
          <h4 className="text-[13px] font-bold text-white tracking-tight font-sans">
            {parseInline(headerText)}
          </h4>
        </div>
      );
      continue;
    }

    // Blank line
    if (trimmed === "") {
      flushList(i);
      continue;
    }

    // Normal line
    flushList(i);
    // If it is a bold header/title like **Direktori utama** on its own line
    const isStandaloneBold = trimmed.startsWith("**") && trimmed.endsWith("**") && !trimmed.slice(2, -2).includes("**");
    if (isStandaloneBold) {
      const cleanBold = trimmed.substring(2, trimmed.length - 2);
      blocks.push(
        <div key={`subtitle-${i}`} className="text-[12.5px] font-bold text-gray-200 mt-4 mb-1.5 first:mt-1 font-sans tracking-wide">
          {parseInline(cleanBold)}
        </div>
      );
    } else {
      blocks.push(
        <p key={`p-${i}`} className="text-[13px] text-gray-300 leading-relaxed font-sans mb-2 last:mb-0">
          {parseInline(line)}
        </p>
      );
    }
  }

  // Final flush
  flushList(lines.length);
  flushCodeBlock(lines.length);

  return <div className="space-y-1.5 font-sans text-gray-300">{blocks}</div>;
}
