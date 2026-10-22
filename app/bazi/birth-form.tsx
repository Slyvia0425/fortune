import { AXES, type Axis, type Dms, daysIn, digitsOnly } from "@/lib/bazi/birth-input";
import { useI18n } from "@/lib/i18n";
import { SourceLink } from "./knowledge-link";
import type { Gender, BirthFormState } from "./use-birth-form";

/** Step 1: the birth form. All state lives in `useBirthForm`; this only draws it. */

const MINUTES = Array.from({ length: 60 }, (_, i) => i);
const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);

/** A short row of exclusive choices, shown as one segmented control. */
function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
  block = false,
}: {
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (next: T) => void;
  label: string;
  /** Fill the width of the field, as the control itself rather than a switch in its label. */
  block?: boolean;
}) {
  return (
    <div className={`seg ${block ? "seg-block" : ""}`} role="group" aria-label={label}>
      {options.map((option) => (
        <button key={option.value} type="button" aria-pressed={option.value === value} onClick={() => onChange(option.value)}>
          {option.label}
        </button>
      ))}
    </div>
  );
}

/** A field's input with its unit written inside the box, on the right. */
function Unit({ unit, children }: { unit: string; children: React.ReactNode }) {
  return (
    <span className="unit">
      {children}
      <i aria-hidden="true">{unit}</i>
    </span>
  );
}

/**
 * Degrees-and-minutes coordinate entry. Bounding each part separately keeps the value valid by construction: there is no way to
 * type a nonsense coordinate the way a free-text field allows.
 */
function DmsField({ axis, value, onChange }: { axis: Axis; value: Dms; onChange: (next: Dms) => void }) {
  const { t } = useI18n();
  const { name, maxDegrees, hemispheres } = AXES[axis];
  return (
    <div className="field">
      <div className="field-head">
        <label htmlFor={`${axis}-deg`}>{t(name)}</label>
      </div>
      <div className="dms-row">
        <select aria-label={`${name}半球`} value={value.hemisphere} onChange={(e) => onChange({ ...value, hemisphere: e.target.value })}>
          {hemispheres.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <input
          id={`${axis}-deg`}
          // type="number" only enforces min/max on submit — it happily accepts "+", "-", "e", decimals and arbitrarily large values
          // while typing. A filtered text input keeps the value valid at every keystroke.
          type="text"
          inputMode="numeric"
          maxLength={3}
          value={value.degrees}
          onChange={(e) => onChange({ ...value, degrees: digitsOnly(e.target.value, maxDegrees) })}
        />
        <i>{t("度", undefined, "°")}</i>
        <select aria-label={`${name}分`} value={value.minutes} onChange={(e) => onChange({ ...value, minutes: e.target.value })}>
          {MINUTES.map((m) => (
            <option key={m} value={String(m)}>
              {m}
            </option>
          ))}
        </select>
        <i>{t("分", undefined, "′")}</i>
      </div>
    </div>
  );
}

/** The example row: a random classical case fills the form, and its source and the commentator's words can be shown or folded away. */
function ClassicCasePicker({ form }: { form: BirthFormState }) {
  const { t } = useI18n();
  const { classicCase: shown, classicCaseOpen: open } = form;
  return (
    <div className="example-row">
      <span className="example-label">{t("不知道填什么？看一个典籍命例：")}</span>
      <button type="button" className="example-button" onClick={form.pickClassicCase}>
        {shown ? t("换一个命例") : t("随机看一个命例")}
      </button>
      {shown && (
        <button type="button" className="example-toggle" aria-expanded={open} onClick={() => form.setClassicCaseOpen(!open)}>
          {open ? t("收起说明 ▴") : t("展开说明 ▾")}
        </button>
      )}
      {shown && open && (
        <div className="case-card">
          <div className="case-source">
            《{shown.book}》{shown.chapter.includes(" · ") ? shown.chapter.split(" · ")[1] : shown.chapter} · {shown.speaker}{" "}
            <SourceLink url={shown.kb_url} arrow={false} />
          </div>
          <div className="case-main">
            <div className="case-pillars">{shown.pillars}</div>
            <div className="case-label">{shown.said}</div>
          </div>
          <p className="case-note">{t("下方已填入一个四柱相同的现代出生时刻（与命例的真实出生时间无关），点「生成命盘」查看排盘与分析。")}</p>
        </div>
      )}
    </div>
  );
}

export function BirthForm({ form, pending, onSubmit }: { form: BirthFormState; pending: boolean; onSubmit: () => void }) {
  const { t } = useI18n();
  const { dateParts, timeParts, lunar } = form;
  return (
    <>
      <h2>{t("出生信息")}</h2>
      <p className="panel-intro">{t("输入仅用于本次排盘。出生时间与地点共同决定时柱，请尽量准确。")}</p>

      <ClassicCasePicker form={form} />

      <div className="form-grid bazi-form">
        <div className="field">
          <div className="field-head">
            <label htmlFor="date">{t("出生日期")}</label>
            <Segmented
              label={t("历法")}
              value={form.calendar}
              onChange={form.setCalendar}
              options={[
                { value: "solar", label: t("公历") },
                { value: "lunar", label: t("农历") },
              ]}
            />
          </div>
          {form.calendar === "solar" ? (
            <div className="date-row">
              <Unit unit={t("年", undefined, "y")}>
                <input
                  id="date"
                  type="text"
                  inputMode="numeric"
                  maxLength={4}
                  placeholder="1990"
                  aria-label={t("年")}
                  value={dateParts.y}
                  onChange={(e) => form.setDateParts((p) => ({ ...p, y: e.target.value.replace(/\D/g, "").slice(0, 4) }))}
                />
              </Unit>
              <select
                aria-label={t("月")}
                value={dateParts.m}
                onChange={(e) => form.setDateParts((p) => ({ ...p, m: e.target.value, d: Number(p.d) > daysIn(p.y, e.target.value) ? "" : p.d }))}
              >
                <option value="">{t("月")}</option>
                {MONTHS.map((m) => (
                  <option key={m} value={String(m)}>{t("{month} 月", { month: m })}</option>
                ))}
              </select>
              <select aria-label={t("日")} value={dateParts.d} onChange={(e) => form.setDateParts((p) => ({ ...p, d: e.target.value }))}>
                <option value="">{t("日")}</option>
                {Array.from({ length: daysIn(dateParts.y, dateParts.m) }, (_, i) => i + 1).map((d) => (
                  <option key={d} value={String(d)}>{t("{day} 日", { day: d })}</option>
                ))}
              </select>
            </div>
          ) : (
            <div className="date-row">
              <Unit unit={t("年", undefined, "y")}>
                <input
                  id="date"
                  type="text"
                  inputMode="numeric"
                  maxLength={4}
                  placeholder="1990"
                  aria-label={t("农历年")}
                  value={lunar.year}
                  onChange={(e) => form.setLunar({ ...lunar, year: e.target.value.replace(/\D/g, "").slice(0, 4) })}
                />
              </Unit>
              <select aria-label={t("农历月")} value={lunar.month} onChange={(e) => form.setLunar({ ...lunar, month: e.target.value })}>
                {MONTHS.map((m) => (
                  <option key={m} value={String(m)}>{t("{month} 月", { month: m })}</option>
                ))}
              </select>
              <select aria-label={t("农历日")} value={lunar.day} onChange={(e) => form.setLunar({ ...lunar, day: e.target.value })}>
                {Array.from({ length: 30 }, (_, i) => i + 1).map((d) => (
                  <option key={d} value={String(d)}>{t("{day} 日", { day: d })}</option>
                ))}
              </select>
            </div>
          )}
          {form.calendar === "lunar" && (
            <label className="leap-check">
              <input type="checkbox" checked={form.isLeapMonth} onChange={(e) => form.setIsLeapMonth(e.target.checked)} />
              <span>{t("出生于闰月（不确定可不勾选）")}</span>
            </label>
          )}
          {form.lunarMessage && (
            <small role="alert" className="field-error">
              {form.lunarMessage}
            </small>
          )}
          {form.lunarCheck?.valid && form.lunarCheck.solar_date && <small className="field-note">{t("对应公历 {date}", { date: form.lunarCheck.solar_date })}</small>}
        </div>

        <div className="field">
          <div className="field-head">
            <label htmlFor="time">{t("出生时间")}</label>
            <span className="field-hint">{t("24 小时制")}</span>
          </div>
          <div className="time-row">
            <Unit unit={t("时", undefined, "h")}>
              <input
                id="time"
                type="text"
                inputMode="numeric"
                maxLength={2}
                placeholder="13"
                aria-label={t("时")}
                value={timeParts.h}
                onChange={(e) => form.setTimeParts((p) => ({ ...p, h: digitsOnly(e.target.value, 23) }))}
              />
            </Unit>
            <Unit unit={t("分", undefined, "min")}>
              <input
                type="text"
                inputMode="numeric"
                maxLength={2}
                placeholder="30"
                aria-label={t("分")}
                value={timeParts.min}
                onChange={(e) => form.setTimeParts((p) => ({ ...p, min: digitsOnly(e.target.value, 59) }))}
              />
            </Unit>
          </div>
        </div>

        <div className="field">
          <div className="field-head">
            <label htmlFor="city">{t("出生地点")}</label>
            <Segmented
              label={t("地点输入方式")}
              value={form.placeMode}
              onChange={form.setPlaceMode}
              options={[
                { value: "dropdown", label: t("选城市") },
                { value: "manual_coordinates", label: t("填经纬度") },
              ]}
            />
          </div>
          <input
            id="city"
            type="text"
            autoComplete="off"
            placeholder={t("输入城市英文名，如 Shanghai")}
            value={form.cityQuery}
            disabled={form.placeMode === "manual_coordinates"}
            onChange={(e) => form.typeCity(e.target.value)}
          />
          {form.placeMode === "dropdown" && form.cityHits.length > 0 && (
            <ul role="listbox" className="city-list">
              {form.cityHits.map((hit) => (
                <li key={hit.id} role="option" aria-selected={false}>
                  <button type="button" className="city-option" onClick={() => form.chooseCity(hit)}>
                    {hit.name}
                    {hit.alias ? ` (${hit.alias})` : ""} · {hit.country_code}
                    <small className="city-coords">
                      {"  "}
                      {hit.latitude.toFixed(2)}, {hit.longitude.toFixed(2)}
                    </small>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {form.placeMode === "dropdown" && (
            <small className="field-note">
              {form.city
                ? t("已选：{city}（{country}），经度 {longitude}°", {
                    city: form.city.name,
                    country: form.city.country_code,
                    longitude: form.city.longitude.toFixed(2),
                  })
                : form.cityLoading
                  ? t("搜索中…")
                  : t("城市数据来自 GeoNames，暂只支持英文名；找不到可切换到「填经纬度」。")}
            </small>
          )}
        </div>

        <div className="field">
          <div className="field-head">
            <label>{t("性别")}</label>
            <span className="field-hint">{t("用于大运顺逆")}</span>
          </div>
          <Segmented<Gender>
            block
            label={t("性别")}
            value={form.gender}
            onChange={form.setGender}
            options={[
              { value: "female", label: t("女") },
              { value: "male", label: t("男") },
            ]}
          />
        </div>

        {form.placeMode === "manual_coordinates" && (
          <>
            <DmsField axis="lng" value={form.lng} onChange={form.setLng} />
            <DmsField axis="lat" value={form.lat} onChange={form.setLat} />
          </>
        )}

        <p className="form-note">{t("提示：真太阳时、节气交界与历法校准会影响专业排盘。结果仅供传统文化学习与参考，不用于现实决策。")}</p>
        {form.notice && <p className="notice">{form.notice}</p>}
        <button className="button button-primary" disabled={pending} onClick={onSubmit}>
          {pending ? t("排盘中……") : t("生成命盘")}
        </button>
      </div>
    </>
  );
}
