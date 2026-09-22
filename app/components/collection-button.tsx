"use client";

import { Bookmark, BookmarkCheck, ExternalLink, LoaderCircle } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { recordFortuneActivity, type FortuneActivity } from "@/lib/module4/activity";

import styles from "./collection-button.module.css";

interface CollectionButtonProps extends FortuneActivity {
  label?: string;
  autoRecord?: boolean;
  compact?: boolean;
}

type SaveState = "idle" | "saving" | "saved" | "error";

export default function CollectionButton({
  label = "收藏本步",
  autoRecord = false,
  compact = false,
  ...activity
}: CollectionButtonProps) {
  const [state, setState] = useState<SaveState>("idle");
  const [message, setMessage] = useState("");
  const autoRecorded = useRef(false);
  const profileKey = activity.profileId || activity.personName?.trim() || "unassigned";
  const storageKey = `fortune-collection:${activity.module}:${activity.step}:${profileKey}:${activity.sourceId}`;

  const save = useCallback(async () => {
    if (state === "saving" || state === "saved") return;
    setState("saving");
    setMessage("正在写入智库…");
    try {
      await recordFortuneActivity(activity);
      if (autoRecord) window.localStorage.setItem(storageKey, "saved");
      setState("saved");
      setMessage("已写入知命智库");
    } catch (error) {
      setState("error");
      setMessage(error instanceof Error ? error.message : "收藏失败");
    }
  }, [activity, autoRecord, setMessage, setState, state, storageKey]);

  useEffect(() => {
    if (!autoRecord || autoRecorded.current) return;
    autoRecorded.current = true;
    if (window.localStorage.getItem(storageKey) === "saved") {
      queueMicrotask(() => {
        setState("saved");
        setMessage("已写入知命智库");
      });
      return;
    }
    queueMicrotask(() => void save());
  }, [autoRecord, save, storageKey]);

  return (
    <span className={`${styles.wrap} ${compact ? styles.compact : ""}`}>
      <button
        className={`${styles.button} ${state === "saved" ? styles.saved : ""}`}
        disabled={state === "saving" || state === "saved"}
        onClick={() => void save()}
        title={message || label}
        type="button"
      >
        {state === "saving" ? (
          <LoaderCircle className={styles.spin} size={15} />
        ) : state === "saved" ? (
          <BookmarkCheck size={15} />
        ) : (
          <Bookmark size={15} />
        )}
        <span>{state === "saved" ? "已收藏" : label}</span>
      </button>
      {state === "saved" ? (
        <a href="/library#collections" rel="noreferrer">
          智库 <ExternalLink size={11} />
        </a>
      ) : state === "error" ? (
        <small className={styles.error}>{message}</small>
      ) : null}
    </span>
  );
}
