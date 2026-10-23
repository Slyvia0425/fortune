"use client";

import type { PersonProfile } from "@/lib/module4/types";
import { useI18n } from "@/lib/i18n";

import styles from "./bazi-chart.module.css";

/**
 * Step 1: whose chart this is.
 *
 * Every record the bazi pages write into the personal knowledge base carries a
 * person, so two people's charts stay apart instead of merging. A profile is
 * saved with the chart the first time it is computed; picking one back up
 * refills the form.
 *
 * The archive is optional: leaving the name empty still computes and records a
 * chart, it just records it as 未命名人物.
 */
export const RELATION_OPTIONS = ["本人", "家人", "亲友", "客户", "研究案例", "其他"] as const;

export function PersonArchive({
  profiles,
  profileId,
  personName,
  personRelation,
  onName,
  onRelation,
  onSelect,
  onClear,
}: {
  profiles: PersonProfile[];
  profileId: string;
  personName: string;
  personRelation: string;
  onName: (value: string) => void;
  onRelation: (value: string) => void;
  onSelect: (profile: PersonProfile) => void;
  onClear: () => void;
}) {
  const { t } = useI18n();
  return (
    <>
      <h2>{t("人物档案")}</h2>
      <p className="panel-intro">{t("记录归到这个人名下，不同人物的命盘分开保存。")}</p>

      <div className={`form-grid bazi-form ${styles.archiveFields}`}>
        <div className="field">
          <div className="field-head">
            <label htmlFor="person-name">{t("人物名称")}</label>
          </div>
          <input
            id="person-name"
            type="text"
            maxLength={40}
            placeholder={t("本人")}
            value={personName}
            onChange={(event) => onName(event.target.value)}
          />
        </div>

        <div className="field">
          <div className="field-head">
            <label htmlFor="person-relation">{t("关系")}</label>
          </div>
          <select id="person-relation" value={personRelation} onChange={(event) => onRelation(event.target.value)}>
            {RELATION_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {t(option)}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <div className="field-head">
            <label htmlFor="person-profile">{t("载入已有档案")}</label>
            <button
              className={styles.archiveClear}
              type="button"
              onClick={onClear}
              disabled={!profileId && personName === "本人" && personRelation === "本人"}
            >
              {t("清空")}
            </button>
          </div>
          <select
            id="person-profile"
            value={profileId}
            onChange={(event) => {
              const picked = profiles.find((profile) => profile.profile_id === event.target.value);
              if (picked) onSelect(picked);
            }}
          >
            <option value="">{t("新档案")}</option>
            {profiles.map((profile) => (
              <option key={profile.profile_id} value={profile.profile_id}>
                {profile.name}
                {profile.relation ? ` (${t(profile.relation)})` : ""}
                {profile.birth_date ? ` · ${profile.birth_date}` : ""}
              </option>
            ))}
          </select>
        </div>

        <p className="form-note">
          {t("生成命盘时，出生信息与命盘会一并存入该人物的档案；档案只属于你本人，不进入公共知识库。")}
        </p>
      </div>
    </>
  );
}
