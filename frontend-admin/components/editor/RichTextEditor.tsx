"use client";

import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import Image from "@tiptap/extension-image";
import { useEffect, useState } from "react";

type Mode = "edit" | "html" | "preview";

type Props = {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  /** 富文本中粘贴/插入图片时的上传函数；返回 url */
  onUploadImage?: (file: File) => Promise<string>;
};

export function RichTextEditor({ value, onChange, placeholder, onUploadImage }: Props) {
  const [mode, setMode] = useState<Mode>("edit");
  const [htmlSource, setHtmlSource] = useState(value);

  const editor = useEditor({
    extensions: [
      StarterKit,
      Link.configure({ openOnClick: false }),
      Image.configure({ allowBase64: false, inline: false }),
    ],
    content: value,
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class:
          "prose prose-sm max-w-none min-h-[240px] px-3 py-2 focus:outline-none",
      },
    },
    onUpdate: ({ editor }) => {
      const html = editor.getHTML();
      setHtmlSource(html);
      onChange(html);
    },
  });

  // 外部值变化（如载入详情）时同步
  useEffect(() => {
    if (editor && value !== editor.getHTML()) {
      editor.commands.setContent(value || "", { emitUpdate: false });
      setHtmlSource(value);
    }
  }, [value, editor]);

  function applyHtmlSource() {
    if (editor) {
      editor.commands.setContent(htmlSource, { emitUpdate: false });
      onChange(htmlSource);
    }
  }

  async function pickImage() {
    if (!onUploadImage) return;
    const inp = document.createElement("input");
    inp.type = "file";
    inp.accept = "image/*";
    inp.onchange = async () => {
      const f = inp.files?.[0];
      if (!f || !editor) return;
      const url = await onUploadImage(f);
      editor.chain().focus().setImage({ src: url }).run();
    };
    inp.click();
  }

  if (!editor) return null;

  return (
    <div className="overflow-hidden rounded-md border bg-background">
      {/* 模式切换 + 工具栏 */}
      <div className="flex flex-wrap items-center gap-1 border-b bg-muted/40 px-2 py-1">
        {/* 模式切换 */}
        <div className="flex rounded border bg-background">
          {(["edit", "html", "preview"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => {
                if (m === "edit" && mode === "html") applyHtmlSource();
                setMode(m);
              }}
              className={
                "px-2 py-1 text-xs transition-colors " +
                (mode === m
                  ? "bg-primary text-primary-foreground"
                  : "hover:bg-accent")
              }
            >
              {m === "edit" ? "编辑" : m === "html" ? "HTML 源码" : "预览"}
            </button>
          ))}
        </div>

        {mode === "edit" && (
          <>
            <Sep />
            <Btn active={editor.isActive("bold")} onClick={() => editor.chain().focus().toggleBold().run()}>
              <strong>B</strong>
            </Btn>
            <Btn active={editor.isActive("italic")} onClick={() => editor.chain().focus().toggleItalic().run()}>
              <em>I</em>
            </Btn>
            <Btn active={editor.isActive("strike")} onClick={() => editor.chain().focus().toggleStrike().run()}>
              <s>S</s>
            </Btn>
            <Sep />
            <Btn active={editor.isActive("heading", { level: 2 })} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}>
              H2
            </Btn>
            <Btn active={editor.isActive("heading", { level: 3 })} onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}>
              H3
            </Btn>
            <Btn active={editor.isActive("paragraph")} onClick={() => editor.chain().focus().setParagraph().run()}>
              P
            </Btn>
            <Sep />
            <Btn active={editor.isActive("bulletList")} onClick={() => editor.chain().focus().toggleBulletList().run()}>
              • 列表
            </Btn>
            <Btn active={editor.isActive("orderedList")} onClick={() => editor.chain().focus().toggleOrderedList().run()}>
              1. 列表
            </Btn>
            <Btn active={editor.isActive("blockquote")} onClick={() => editor.chain().focus().toggleBlockquote().run()}>
              引用
            </Btn>
            <Btn active={editor.isActive("codeBlock")} onClick={() => editor.chain().focus().toggleCodeBlock().run()}>
              {"</>"}
            </Btn>
            <Sep />
            <Btn
              onClick={() => {
                const url = prompt("输入链接 URL：");
                if (url) editor.chain().focus().setLink({ href: url }).run();
              }}
            >
              🔗 链接
            </Btn>
            {onUploadImage && (
              <Btn onClick={pickImage}>🖼 图片</Btn>
            )}
            <Sep />
            <Btn onClick={() => editor.chain().focus().undo().run()}>↶</Btn>
            <Btn onClick={() => editor.chain().focus().redo().run()}>↷</Btn>
          </>
        )}
      </div>

      {/* 内容区 */}
      {mode === "edit" && (
        <EditorContent editor={editor} />
      )}
      {mode === "html" && (
        <textarea
          value={htmlSource}
          onChange={(e) => setHtmlSource(e.target.value)}
          onBlur={applyHtmlSource}
          rows={12}
          spellCheck={false}
          className="w-full px-3 py-2 font-mono text-xs focus:outline-none"
          placeholder={placeholder}
        />
      )}
      {mode === "preview" && (
        <div
          className="prose prose-sm max-w-none px-3 py-2"
          dangerouslySetInnerHTML={{ __html: htmlSource || "<p class='text-muted-foreground'>无内容</p>" }}
        />
      )}
    </div>
  );
}

function Btn({ children, onClick, active }: { children: React.ReactNode; onClick: () => void; active?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        "rounded px-2 py-1 text-xs transition-colors " +
        (active ? "bg-primary text-primary-foreground" : "hover:bg-accent")
      }
    >
      {children}
    </button>
  );
}

function Sep() {
  return <span className="mx-0.5 h-5 w-px bg-border" />;
}
