import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { copyText, downloadText } from "./download";
import styles from "./bazi-chart.module.css";

export interface ExportFile {
  name: string;
  mime: string;
  text: string;
}

/** What is about to be saved, shown first: the file's name and its content as it will be written, to save or to leave. */
export function ExportPreview({ file, onClose }: { file: ExportFile; onClose: () => void }) {
  const [copy, setCopy] = useState<"idle" | "done" | "failed">("idle");
  const resetTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(resetTimer.current), []);

  const onCopy = async () => {
    setCopy((await copyText(file.text)) ? "done" : "failed");
    window.clearTimeout(resetTimer.current);
    resetTimer.current = window.setTimeout(() => setCopy("idle"), 2000);
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
    };
  }, [onClose]);

  return createPortal(
    <div className={styles.previewBackdrop} onClick={onClose}>
      <div className={`${styles.previewModal} ${styles.fade}`} role="dialog" aria-modal="true" aria-label="导出预览" onClick={(event) => event.stopPropagation()}>
        <div className={styles.demoHead}>
          <h3>导出预览</h3>
          <button type="button" className={styles.demoClose} onClick={onClose} aria-label="关闭">
            ×
          </button>
        </div>
        <p className={styles.previewName}>
          {file.name}　<small>{file.text.length} 字</small>
        </p>
        <div className={styles.previewBox}>
          <pre className={styles.previewText}>{file.text}</pre>
          <button
            type="button"
            className={`${styles.previewCopy} ${copy === "done" ? styles.previewCopyDone : ""}`}
            onClick={onCopy}
            aria-label="复制内容"
            title={copy === "done" ? "已复制" : copy === "failed" ? "复制失败，请手动选取" : "复制"}
          >
            {copy === "done" ? <CheckIcon /> : <CopyIcon />}
          </button>
        </div>
        <div className={styles.previewActions}>
          <button type="button" className={styles.exportButton} onClick={onClose}>
            取消
          </button>
          <button
            type="button"
            className={styles.previewSave}
            onClick={() => {
              downloadText(file.name, file.mime, file.text);
              onClose();
            }}
          >
            下载
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

const iconProps = { width: 16, height: 16, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true } as const;

function CopyIcon() {
  return (
    <svg {...iconProps}>
      <rect x="9" y="9" width="12" height="12" rx="2" />
      <path d="M5 15V5a2 2 0 0 1 2-2h10" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg {...iconProps}>
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </svg>
  );
}
