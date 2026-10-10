import { useEffect } from "react";
import { createPortal } from "react-dom";
import { downloadText } from "./download";
import styles from "./bazi-chart.module.css";

export interface ExportFile {
  name: string;
  mime: string;
  text: string;
}

/** What is about to be saved, shown first: the file's name and its content as it will be written, to save or to leave. */
export function ExportPreview({ file, onClose }: { file: ExportFile; onClose: () => void }) {
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
        <pre className={styles.previewText}>{file.text}</pre>
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
