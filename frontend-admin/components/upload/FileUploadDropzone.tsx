"use client";

// TODO i18n: 文案待统一抽取
import { useRef, useState, type DragEvent, type ReactNode } from "react";

/**
 * 通用拖拽上传 dropzone（F2 子轨道）。
 *
 * 支持：
 *  - 拖拽进入高亮 + drop 接收
 *  - 点击触发原生 file input
 *  - accept / multiple props 透传给原生 input
 *  - onFiles 回调：父组件拿到 File[] 自行处理（弹标签 / 备注表单 → 上传）
 */
export function FileUploadDropzone({
  accept,
  multiple = true,
  disabled = false,
  hint,
  onFiles,
  className = "",
}: {
  accept?: string;
  multiple?: boolean;
  disabled?: boolean;
  hint?: ReactNode;
  onFiles: (files: File[]) => void;
  className?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);

  function pickFiles(list: FileList | null) {
    if (!list || list.length === 0) return;
    const arr = Array.from(list);
    onFiles(arr);
  }

  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setOver(false);
    if (disabled) return;
    pickFiles(e.dataTransfer.files);
  }
  function onDragOver(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    if (disabled) return;
    setOver(true);
  }
  function onDragLeave(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setOver(false);
  }

  return (
    <div
      onDrop={onDrop}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onClick={() => !disabled && inputRef.current?.click()}
      className={
        "cursor-pointer rounded-md border-2 border-dashed p-6 text-center transition-colors " +
        (over ? "border-primary bg-primary/5" : "border-muted") +
        (disabled ? " cursor-not-allowed opacity-60" : "") +
        " " + className
      }
      role="button"
      tabIndex={0}
    >
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        multiple={multiple}
        disabled={disabled}
        className="hidden"
        onChange={(e) => {
          pickFiles(e.target.files);
          // 同名文件再次选中也要触发 change → 清空 value
          if (inputRef.current) inputRef.current.value = "";
        }}
      />
      <div className="text-sm">
        <span className="font-medium">点击或拖拽文件到此处</span>
      </div>
      {hint && <div className="mt-1 text-xs text-muted-foreground">{hint}</div>}
    </div>
  );
}
