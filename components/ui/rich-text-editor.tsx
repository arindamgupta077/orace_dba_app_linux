"use client";

import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Color from "@tiptap/extension-color";
import { TextStyle } from "@tiptap/extension-text-style";
import Underline from "@tiptap/extension-underline";
import TextAlign from "@tiptap/extension-text-align";
import Highlight from "@tiptap/extension-highlight";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import {
  Bold,
  Italic,
  Underline as UnderlineIcon,
  Strikethrough,
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
  Minimize2
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface RichTextEditorProps {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  className?: string;
  minHeight?: number;
  disabled?: boolean;
}

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
        "h-8 w-8",
        isActive && "bg-secondary text-foreground"
      )}
      onClick={onClick}
      disabled={disabled}
      title={title}
    >
      <Icon className="h-4 w-4" />
    </Button>
  );
}

function ColorPickerButton({
  icon: Icon,
  colors,
  onPick,
  disabled,
  title
}: {
  icon: React.ComponentType<{ className?: string }>;
  colors: Array<{ label: string; value: string }>;
  onPick: (color: string) => void;
  disabled?: boolean;
  title: string;
}) {
  return (
    <div className="relative group">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-8 w-8"
        disabled={disabled}
        title={title}
      >
        <Icon className="h-4 w-4" />
      </Button>
      <div className="invisible absolute top-full left-0 z-50 mt-1 flex flex-wrap gap-1 rounded-md border border-border/70 bg-popover p-2 shadow-md opacity-0 transition-all group-hover:visible group-hover:opacity-100" style={{ width: "180px" }}>
        {colors.map((c) => (
          <button
            key={c.label}
            type="button"
            className="flex h-6 w-6 items-center justify-center rounded border border-border/50 text-xs transition-transform hover:scale-110"
            style={{ backgroundColor: c.value || "transparent" }}
            title={c.label}
            onClick={() => onPick(c.value)}
          >
            {!c.value && <span className="text-[10px] text-muted-foreground">A</span>}
          </button>
        ))}
      </div>
    </div>
  );
}

export function RichTextEditor({
  value,
  onChange,
  placeholder = "Write your notes...",
  className,
  minHeight = 120,
  disabled = false
}: RichTextEditorProps) {
  const [fullscreen, setFullscreen] = useState(false);
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] }
      }),
      Underline,
      TextStyle,
      Color,
      Highlight.configure({ multicolor: true }),
      TextAlign.configure({ types: ["heading", "paragraph"] })
    ],
    content: value,
    editable: !disabled,
    editorProps: {
      attributes: {
        class: "tiptap-content prose prose-sm prose-invert max-w-none focus:outline-none px-3 py-2 text-sm",
        style: `min-height: ${fullscreen ? "calc(100vh - 12rem)" : `${minHeight}px`};`,
        "data-placeholder": placeholder
      }
    },
    onUpdate: ({ editor: ed }) => {
      onChange(ed.getHTML());
    }
  });

  // Sync external value changes (e.g. when clearing after submit).
  useEffect(() => {
    if (editor && value !== editor.getHTML()) {
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
          attributes: {
            class: "tiptap-content prose prose-sm prose-invert max-w-none focus:outline-none px-3 py-2 text-sm",
            style: `min-height: ${fullscreen ? "calc(100vh - 12rem)" : `${minHeight}px`};`,
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

  const editorContent = (
    <div
      className={cn(
        "rounded-md border border-input bg-background/50",
        fullscreen && "fixed inset-0 z-[100] flex flex-col rounded-none border-0 bg-popover p-5 shadow-glass",
        className
      )}
      role={fullscreen ? "dialog" : undefined}
      aria-modal={fullscreen || undefined}
      aria-label={fullscreen ? "Full screen rich text editor" : undefined}
    >
      {fullscreen && (
        <div className="mb-2 flex items-center justify-between">
          <span className="text-sm font-medium text-muted-foreground">Handover Notes — Full Screen Editor</span>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => setFullscreen((v) => !v)}
            title="Exit full screen (Esc)"
          >
            <Minimize2 className="h-4 w-4" />
          </Button>
        </div>
      )}
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-0.5 border-b border-border/60 px-1.5 py-1">
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
        <ToolbarButton
          icon={Strikethrough}
          onClick={() => editor.chain().focus().toggleStrike().run()}
          isActive={editor.isActive("strike")}
          disabled={disabled}
          title="Strikethrough"
        />

        <div className="mx-1 h-5 w-px bg-border/60" />

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

        <div className="mx-1 h-5 w-px bg-border/60" />

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

        <div className="mx-1 h-5 w-px bg-border/60" />

        <ColorPickerButton
          icon={Palette}
          colors={TEXT_COLORS}
          onPick={(color) => editor.chain().focus().setColor(color || "").run()}
          disabled={disabled}
          title="Text Color"
        />
        <ColorPickerButton
          icon={Highlighter}
          colors={HIGHLIGHT_COLORS}
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

        <div className="mx-1 h-5 w-px bg-border/60" />

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

        <div className="mx-1 h-5 w-px bg-border/60" />

        <ToolbarButton
          icon={fullscreen ? Minimize2 : Expand}
          onClick={() => setFullscreen((v) => !v)}
          disabled={disabled}
          title={fullscreen ? "Exit full screen" : "Expand to full screen"}
        />
      </div>

      {/* Editor content */}
      <div className={cn(fullscreen && "flex-1 overflow-y-auto")}>
        <EditorContent editor={editor} />
      </div>
    </div>
  );

  return fullscreen ? createPortal(editorContent, document.body) : editorContent;
}
