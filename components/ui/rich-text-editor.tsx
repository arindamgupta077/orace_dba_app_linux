"use client";

import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Color from "@tiptap/extension-color";
import { TextStyle } from "@tiptap/extension-text-style";
import Underline from "@tiptap/extension-underline";
import TextAlign from "@tiptap/extension-text-align";
import Highlight from "@tiptap/extension-highlight";
import Placeholder from "@tiptap/extension-placeholder";
import { Extension } from "@tiptap/core";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Bold,
  Italic,
  Underline as UnderlineIcon,
  List,
  ListOrdered,
  AlignLeft,
  AlignCenter,
  AlignRight,
  Highlighter,
  Palette,
  Undo2,
  Redo2,
  RemoveFormatting,
  Expand,
  Minimize2,
  Minus,
  Plus
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    fontSize: {
      setFontSize: (size: string) => ReturnType;
      unsetFontSize: () => ReturnType;
    };
  }
}

export const FontSize = Extension.create({
  name: "fontSize",

  addOptions() {
    return {
      types: ["textStyle"]
    };
  },

  addGlobalAttributes() {
    return [
      {
        types: this.options.types,
        attributes: {
          fontSize: {
            default: null,
            parseHTML: (element) => element.style.fontSize?.replace(/['"]+/g, "") || null,
            renderHTML: (attributes) => {
              if (!attributes.fontSize) {
                return {};
              }
              return {
                style: `font-size: ${attributes.fontSize}`
              };
            }
          }
        }
      }
    ];
  },

  addCommands() {
    return {
      setFontSize: (fontSize: string) => ({ chain }) => {
        return chain().setMark("textStyle", { fontSize }).run();
      },
      unsetFontSize: () => ({ chain }) => {
        return chain().setMark("textStyle", { fontSize: null }).removeEmptyTextStyle().run();
      }
    };
  }
});

interface RichTextEditorProps {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  className?: string;
  minHeight?: number;
  disabled?: boolean;
  /** When true, hides the Expand/Minimize toolbar button (useful when the editor is already inside a modal). */
  hideExpand?: boolean;
}

const FONT_SIZES = [
  { label: "12px", value: "12px" },
  { label: "14px", value: "14px" },
  { label: "16px", value: "16px" },
  { label: "18px", value: "18px" },
  { label: "20px", value: "20px" },
  { label: "24px", value: "24px" }
];

const TEXT_COLORS = [
  { label: "Default", value: "" },
  { label: "Red", value: "#ef4444" },
  { label: "Orange", value: "#f97316" },
  { label: "Amber", value: "#f59e0b" },
  { label: "Green", value: "#22c55e" },
  { label: "Cyan", value: "#06b6d4" },
  { label: "Blue", value: "#3b82f6" },
  { label: "Purple", value: "#a855f7" },
  { label: "Pink", value: "#ec4899" },
  { label: "White", value: "#f8fafc" },
  { label: "Gray", value: "#94a3b8" }
];

const HIGHLIGHT_COLORS = [
  { label: "None", value: "" },
  { label: "Yellow", value: "#fef08a" },
  { label: "Green", value: "#bbf7d0" },
  { label: "Blue", value: "#bfdbfe" },
  { label: "Red", value: "#fecaca" },
  { label: "Purple", value: "#e9d5ff" }
];

function ToolbarButton({
  icon: Icon,
  onClick,
  isActive,
  disabled,
  title
}: {
  icon: React.ComponentType<{ className?: string }>;
  onClick: () => void;
  isActive?: boolean;
  disabled?: boolean;
  title: string;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className={cn(
        "h-8 w-8 transition-all duration-150",
        isActive
          ? "bg-accent/20 text-accent font-bold border border-accent/40 shadow-xs dark:bg-cyan-500/20 dark:text-cyan-300 dark:border-cyan-500/50"
          : "text-muted-foreground hover:text-foreground hover:bg-secondary/60"
      )}
      onClick={onClick}
      disabled={disabled}
      title={title}
    >
      <Icon className={cn("h-4 w-4", isActive && "stroke-[2.5]")} />
    </Button>
  );
}

function FontSizeControls({
  editor,
  disabled
}: {
  editor: ReturnType<typeof useEditor>;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  if (!editor) return null;

  const currentSize = editor.getAttributes("textStyle").fontSize || "14px";
  const currentIndex = FONT_SIZES.findIndex((f) => f.value === currentSize);
  const activeIndex = currentIndex !== -1 ? currentIndex : 1;

  const handleDecrease = () => {
    if (activeIndex > 0) {
      const newSize = FONT_SIZES[activeIndex - 1].value;
      if (newSize === "14px") {
        editor.chain().focus().unsetFontSize().run();
      } else {
        editor.chain().focus().setFontSize(newSize).run();
      }
    }
  };

  const handleIncrease = () => {
    if (activeIndex < FONT_SIZES.length - 1) {
      const newSize = FONT_SIZES[activeIndex + 1].value;
      editor.chain().focus().setFontSize(newSize).run();
    }
  };

  const handleSelect = (size: string) => {
    if (size === "14px") {
      editor.chain().focus().unsetFontSize().run();
    } else {
      editor.chain().focus().setFontSize(size).run();
    }
    setOpen(false);
  };

  return (
    <div className="flex items-center gap-0.5" ref={containerRef}>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-8 w-8"
        onClick={handleDecrease}
        disabled={disabled || activeIndex <= 0}
        title="Decrease font size (A-)"
      >
        <span className="flex items-center text-xs font-bold">
          A<Minus className="h-2.5 w-2.5 -ml-0.5" />
        </span>
      </Button>

      <div className="relative" onClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          disabled={disabled}
          className="flex h-7 items-center justify-between gap-1 rounded border border-border/60 bg-background px-1.5 text-xs font-medium text-foreground hover:bg-secondary focus:outline-none"
          onClick={(e) => {
            e.stopPropagation();
            setOpen((prev) => !prev);
          }}
          title="Select font size"
        >
          <span>{currentSize}</span>
        </button>

        {open && !disabled && (
          <div
            className="absolute top-full left-0 z-50 mt-1 flex flex-col rounded-md border border-border/70 bg-popover p-1 shadow-lg animate-in fade-in-50 zoom-in-95 w-24"
            onClick={(e) => e.stopPropagation()}
          >
            {FONT_SIZES.map((f) => (
              <button
                key={f.value}
                type="button"
                className={cn(
                  "flex items-center justify-between rounded px-2 py-1 text-xs hover:bg-secondary focus:outline-none",
                  currentSize === f.value && "bg-secondary font-semibold text-primary"
                )}
                onClick={(e) => {
                  e.stopPropagation();
                  handleSelect(f.value);
                }}
              >
                <span style={{ fontSize: f.value }}>{f.label}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-8 w-8"
        onClick={(e) => {
          e.stopPropagation();
          handleIncrease();
        }}
        disabled={disabled || activeIndex >= FONT_SIZES.length - 1}
        title="Increase font size (A+)"
      >
        <span className="flex items-center text-xs font-bold">
          A<Plus className="h-2.5 w-2.5 -ml-0.5" />
        </span>
      </Button>
    </div>
  );
}

function ColorPickerButton({
  icon: Icon,
  colors,
  onPick,
  disabled,
  title,
  activeColor
}: {
  icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
  colors: Array<{ label: string; value: string }>;
  onPick: (color: string) => void;
  disabled?: boolean;
  title: string;
  activeColor?: string;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  return (
    <div className="relative inline-block" ref={containerRef} onClick={(e) => e.stopPropagation()}>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className={cn(
          "h-8 w-8 relative flex items-center justify-center",
          open && "bg-secondary text-foreground",
          activeColor && "bg-secondary/70"
        )}
        disabled={disabled}
        title={title}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((prev) => !prev);
        }}
      >
        <Icon className="h-4 w-4" style={{ color: activeColor || undefined }} />
        {activeColor && (
          <span
            className="absolute bottom-1 left-2 right-2 h-0.5 rounded-full"
            style={{ backgroundColor: activeColor }}
          />
        )}
      </Button>

      {open && !disabled && (
        <div
          className="absolute top-full left-0 z-50 mt-1 flex flex-wrap gap-1 rounded-md border border-border/70 bg-popover p-2 shadow-lg animate-in fade-in-50 zoom-in-95"
          style={{ width: "180px" }}
          onClick={(e) => e.stopPropagation()}
        >
          {colors.map((c) => (
            <button
              key={c.label}
              type="button"
              disabled={disabled}
              className={cn(
                "flex h-6 w-6 items-center justify-center rounded border border-border/50 text-xs transition-transform hover:scale-110 focus:outline-none focus:ring-1 focus:ring-ring",
                activeColor === c.value && "ring-2 ring-primary"
              )}
              style={{ backgroundColor: c.value || "transparent" }}
              title={c.label}
              onClick={(e) => {
                e.stopPropagation();
                onPick(c.value);
                setOpen(false);
              }}
            >
              {!c.value && <span className="text-[10px] text-muted-foreground font-semibold">A</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Sanitizes and cleans HTML pasted from Microsoft Outlook, MS Word, and Office 365
 * to preserve text formatting, colors, font sizes, background highlights, and lists in TipTap.
 */
function cleanOutlookHtml(html: string): string {
  if (!html) return html;

  let clean = html;

  // 1. Strip MS Office XML blocks, HTML comments, and internal MSO style blocks
  clean = clean.replace(/<!--[\s\S]*?-->/gi, "");
  clean = clean.replace(/<xml[\s\S]*?<\/xml>/gi, "");
  clean = clean.replace(/<style[\s\S]*?<\/style>/gi, "");
  clean = clean.replace(/<meta[\s\S]*?>/gi, "");
  clean = clean.replace(/<link[\s\S]*?>/gi, "");
  clean = clean.replace(/<head[\s\S]*?<\/head>/gi, "");

  // 2. Remove MSO list paragraph bullet markers and convert to clean list text
  clean = clean.replace(
    /<p[^>]*class="[^"]*MsoListParagraph[^"]*"[^>]*>[\s\S]*?<span[^>]*>(?:·|o|§|\d+\.|\w+\.)<\/span>[\s\S]*?<span>(.*?)<\/span><\/p>/gi,
    "<p>• $1</p>"
  );

  // 3. Replace MSO namespace tags (<o:p>, <w:sdt>, etc.)
  clean = clean.replace(/<\/?o:p[^>]*>/gi, "<br/>");
  clean = clean.replace(/<\/?(?:o|w|v|m):[^>]*>/gi, "");

  // 4. Convert font-size in pt (Outlook standard) to px for TipTap FontSize compatibility
  clean = clean.replace(/font-size:\s*([\d.]+)\s*pt/gi, (_, pt) => {
    const ptNum = parseFloat(pt);
    const px = Math.round(ptNum * 1.33);
    return `font-size: ${px}px`;
  });

  // 5. Convert MSO background highlight to standard CSS background-color
  clean = clean.replace(/mso-highlight:\s*([^;"]+)/gi, (_, color) => {
    return `background-color: ${color.trim()}`;
  });

  // 6. Clean inline style attributes (keep valid CSS like color, background-color, font-size, font-weight, text-align, text-decoration)
  clean = clean.replace(/style="([^"]*)"/gi, (match, styleString: string) => {
    const rules = styleString.split(";");
    const validRules: string[] = [];
    for (const rule of rules) {
      const trimmed = rule.trim();
      if (!trimmed) continue;
      const lower = trimmed.toLowerCase();
      if (lower.startsWith("mso-") || lower.startsWith("margin-") || lower.startsWith("line-height:")) {
        continue;
      }
      validRules.push(trimmed);
    }
    return validRules.length ? `style="${validRules.join("; ")}"` : "";
  });

  // 7. Remove empty or redundant <span> tags
  clean = clean.replace(/<span>(.*?)<\/span>/gi, "$1");

  return clean;
}

export function RichTextEditor({
  value,
  onChange,
  placeholder = "Write your notes...",
  className,
  minHeight = 120,
  disabled = false,
  hideExpand = false
}: RichTextEditorProps) {
  const [fullscreen, setFullscreen] = useState(false);
  const [, setTick] = useState(0);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] }
      }),
      Underline,
      TextStyle,
      FontSize,
      Color,
      Highlight.configure({ multicolor: true }),
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      Placeholder.configure({
        placeholder,
        emptyEditorClass: "is-editor-empty",
        showOnlyWhenEditable: true
      })
    ],
    content: value,
    editable: !disabled,
    parseOptions: {
      preserveWhitespace: "full"
    },
    editorProps: {
      transformPastedHTML(html) {
        return cleanOutlookHtml(html);
      },
      attributes: {
        class: "tiptap-content prose prose-sm dark:prose-invert max-w-none focus:outline-none px-3 py-2 text-sm h-full min-h-full",
        style: `min-height: ${fullscreen ? "100%" : `${minHeight}px`};`,
        "data-placeholder": placeholder
      }
    },
    onTransaction: () => {
      setTick((t) => t + 1);
    },
    onSelectionUpdate: () => {
      setTick((t) => t + 1);
    },
    onUpdate: ({ editor: ed }) => {
      onChange(ed.getHTML());
    }
  });

  // Sync external value changes (e.g. when clearing after submit or copying previous handover),
  // but only when editor is NOT focused to prevent cursor jumps while typing.
  useEffect(() => {
    if (editor && value !== editor.getHTML() && !editor.isFocused) {
      editor.commands.setContent(value);
    }
  }, [editor, value]);

  // Sync editability when disabled prop changes.
  useEffect(() => {
    if (editor) {
      editor.setEditable(!disabled);
    }
  }, [editor, disabled]);

  // Update editor content height when fullscreen toggles.
  useEffect(() => {
    if (editor) {
      editor.setOptions({
        editorProps: {
          transformPastedHTML(html) {
            return cleanOutlookHtml(html);
          },
          attributes: {
            class: "tiptap-content prose prose-sm dark:prose-invert max-w-none focus:outline-none px-3 py-2 text-sm h-full min-h-full",
            style: `min-height: ${fullscreen ? "100%" : `${minHeight}px`};`,
            "data-placeholder": placeholder
          }
        }
      });
    }
  }, [editor, fullscreen, minHeight, placeholder]);

  // Exit full screen on Esc.
  useEffect(() => {
    if (!fullscreen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setFullscreen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fullscreen]);

  if (!editor) {
    return (
      <div
        className={cn("rounded-md border border-input bg-background/50 px-3 py-2 text-sm text-muted-foreground", className)}
        style={{ minHeight: fullscreen ? "calc(100vh - 12rem)" : minHeight }}
      >
        Loading editor...
      </div>
    );
  }

  const activeTextColor = editor.getAttributes("textStyle").color;
  const activeHighlightColor = editor.getAttributes("highlight").color;

  const toolbar = (
    <div className="flex flex-wrap sm:flex-nowrap items-center gap-0.5 border-b border-border/60 px-1 py-1 relative z-20">
      <ToolbarButton
        icon={Bold}
        onClick={() => editor.chain().focus().toggleBold().run()}
        isActive={editor.isActive("bold")}
        disabled={disabled}
        title="Bold"
      />
      <ToolbarButton
        icon={Italic}
        onClick={() => editor.chain().focus().toggleItalic().run()}
        isActive={editor.isActive("italic")}
        disabled={disabled}
        title="Italic"
      />
      <ToolbarButton
        icon={UnderlineIcon}
        onClick={() => editor.chain().focus().toggleUnderline().run()}
        isActive={editor.isActive("underline")}
        disabled={disabled}
        title="Underline"
      />

      <div className="mx-0.5 h-5 w-px bg-border/60" />

      {/* Font Size controls (Increase A+ / Decrease A- / Dropdown) */}
      <FontSizeControls editor={editor} disabled={disabled} />

      <div className="mx-0.5 h-5 w-px bg-border/60" />

      <ToolbarButton
        icon={List}
        onClick={() => editor.chain().focus().toggleBulletList().run()}
        isActive={editor.isActive("bulletList")}
        disabled={disabled}
        title="Bullet List"
      />
      <ToolbarButton
        icon={ListOrdered}
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
        isActive={editor.isActive("orderedList")}
        disabled={disabled}
        title="Numbered List"
      />

      <div className="mx-0.5 h-5 w-px bg-border/60" />

      <ToolbarButton
        icon={AlignLeft}
        onClick={() => editor.chain().focus().setTextAlign("left").run()}
        isActive={editor.isActive({ textAlign: "left" })}
        disabled={disabled}
        title="Align Left"
      />
      <ToolbarButton
        icon={AlignCenter}
        onClick={() => editor.chain().focus().setTextAlign("center").run()}
        isActive={editor.isActive({ textAlign: "center" })}
        disabled={disabled}
        title="Align Center"
      />
      <ToolbarButton
        icon={AlignRight}
        onClick={() => editor.chain().focus().setTextAlign("right").run()}
        isActive={editor.isActive({ textAlign: "right" })}
        disabled={disabled}
        title="Align Right"
      />

      <div className="mx-0.5 h-5 w-px bg-border/60" />

      <ColorPickerButton
        icon={Palette}
        colors={TEXT_COLORS}
        activeColor={activeTextColor}
        onPick={(color) => {
          if (color) {
            editor.chain().focus().setColor(color).run();
          } else {
            editor.chain().focus().unsetColor().run();
          }
        }}
        disabled={disabled}
        title="Text Color"
      />
      <ColorPickerButton
        icon={Highlighter}
        colors={HIGHLIGHT_COLORS}
        activeColor={activeHighlightColor}
        onPick={(color) => {
          if (color) {
            editor.chain().focus().setHighlight({ color }).run();
          } else {
            editor.chain().focus().unsetHighlight().run();
          }
        }}
        disabled={disabled}
        title="Highlight"
      />

      <div className="mx-0.5 h-5 w-px bg-border/60" />

      <ToolbarButton
        icon={Undo2}
        onClick={() => editor.chain().focus().undo().run()}
        disabled={disabled || !editor.can().undo()}
        title="Undo"
      />
      <ToolbarButton
        icon={Redo2}
        onClick={() => editor.chain().focus().redo().run()}
        disabled={disabled || !editor.can().redo()}
        title="Redo"
      />
      <ToolbarButton
        icon={RemoveFormatting}
        onClick={() => editor.chain().focus().unsetAllMarks().clearNodes().run()}
        disabled={disabled}
        title="Clear Formatting"
      />

      <div className="mx-0.5 h-5 w-px bg-border/60" />

      {!hideExpand && (
        <ToolbarButton
          icon={fullscreen ? Minimize2 : Expand}
          onClick={() => setFullscreen((v) => !v)}
          disabled={disabled}
          title={fullscreen ? "Close expanded editor" : "Expand editor"}
        />
      )}
    </div>
  );

  // Inline (non-expanded) editor
  const inlineEditor = (
    <div
      className={cn("rounded-md border border-input bg-background/50 cursor-text", className)}
      onClick={(e) => {
        if (editor && !(e.target as HTMLElement).closest(".border-b")) {
          editor.chain().focus().run();
        }
      }}
    >
      {toolbar}
      <EditorContent editor={editor} />
    </div>
  );

  // Expanded modal editor — rendered via portal as a centered modal overlay
  const modalEditor = createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6"
      role="dialog"
      aria-modal
      aria-label="Expanded rich text editor"
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={() => setFullscreen(false)}
      />
      {/* Modal */}
      <div
        className="relative z-10 flex flex-col rounded-xl border border-border/70 bg-popover shadow-2xl overflow-hidden"
        style={{ width: "90vw", maxWidth: "1100px", height: "80vh", maxHeight: "800px" }}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border/60 px-4 py-3 bg-muted/40">
          <span className="text-sm font-medium text-foreground">Handover Notes — Expanded Editor</span>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => setFullscreen(false)}
            title="Close expanded editor (Esc)"
          >
            <Minimize2 className="h-4 w-4" />
          </Button>
        </div>
        {/* Toolbar */}
        {toolbar}
        {/* Editor content wrapper — clicking anywhere in this box focuses the editor */}
        <div
          className="flex-1 overflow-y-auto cursor-text flex flex-col"
          onClick={(e) => {
            if (editor && !(e.target as HTMLElement).closest("button") && !(e.target as HTMLElement).closest(".border-b")) {
              editor.chain().focus().run();
            }
          }}
        >
          <EditorContent editor={editor} className="flex-1 h-full min-h-full" />
        </div>
      </div>
    </div>,
    document.body
  );

  return fullscreen ? modalEditor : inlineEditor;
}
