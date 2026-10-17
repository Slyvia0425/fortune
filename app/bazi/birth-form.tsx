import { AXES, type Axis, type Dms, daysIn, digitsOnly } from "@/lib/bazi/birth-input";
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
  const { name, maxDegrees, hemispheres } = AXES[axis];
  return (
    <div className="field">
      <div className="field-head">
        <label htmlFor={`${axis}-deg`}>{name}</label>
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
        <i>度</i>
        <select aria-label={`${name}分`} value={value.minutes} onChange={(e) => onChange({ ...value, minutes: e.target.value })}>
          {MINUTES.map((m) => (
            <option key={m} value={String(m)}>
              {m}
            </option>
          ))}
        </select>
        <i>分</i>
      </div>
    </div>
  );
}

/** The example row: a random classical case fills the form, and its source and the commentator's words can be shown or folded away. */
function ClassicCasePicker({ form }: { form: BirthFormState }) {
  const { classicCase: shown, classicCaseOpen: open } = form;
  return (
    <div className="example-row">
      <span className="example-label">不知道填什么？看一个典籍命例：</span>
      <button type="button" className="example-button" onClick={form.pickClassicCase}>
        {shown ? "换一个命例" : "随机看一个命例"}
      </button>
      {shown && (
        <button type="button" className="example-toggle" aria-expanded={open} onClick={() => form.setClassicCaseOpen(!open)}>
          {open ? "收起说明 ▴" : "展开说明 ▾"}
        </button>
      )}
      {shown && open && (
        <div className="case-card">
          <div className="case-source">
            《{shown.book}》{shown.chapter.includes(" · ") ? shown.chapter.split(" · ")[1] : shown.chapter} · {shown.speaker}{" "}
            <a href={shown.kb_url} target="_blank" rel="noreferrer">查看原文</a>
          </div>
          <div className="case-main">
            <div className="case-pillars">{shown.pillars}</div>
            <div className="case-label">{shown.said}</div>
          </div>
          <p className="case-note">下方已填入一个四柱相同的现代出生时刻（与命例的真实出生时间无关），点「生成命盘」查看排盘与分析。</p>
        </div>
      )}
    </div>
  );
}

export function BirthForm({ form, pending, onSubmit }: { form: BirthFormState; pending: boolean; onSubmit: () => void }) {
  const { dateParts, timeParts, lunar } = form;
  return (
    <>
      <h2>出生信息</h2>
      <p className="panel-intro">输入仅用于本次排盘。出生时间与地点共同决定时柱，请尽量准确。</p>

      <ClassicCasePicker form={form} />

      <div className="form-grid bazi-form">
        <div className="field">
          <div className="field-head">
            <label htmlFor="date">出生日期</label>
            <Segmented
              label="历法"
              value={form.calendar}
              onChange={form.setCalendar}
              options={[
                { value: "solar", label: "公历" },
                { value: "lunar", label: "农历" },
              ]}
            />
          </div>
          {form.calendar === "solar" ? (
            <div className="date-row">
              <Unit unit="年">
                <input
                  id="date"
                  type="text"
                  inputMode="numeric"
                  maxLength={4}
                  placeholder="1990"
                  aria-label="年"
                  value={dateParts.y}
                  onChange={(e) => form.setDateParts((p) => ({ ...p, y: e.target.value.replace(/\D/g, "").slice(0, 4) }))}
                />
              </Unit>
              <select
                aria-label="月"
                value={dateParts.m}
                onChange={(e) => form.setDateParts((p) => ({ ...p, m: e.target.value, d: Number(p.d) > daysIn(p.y, e.target.value) ? "" : p.d }))}
              >
                <option value="">月</option>
                {MONTHS.map((m) => (
                  <option key={m} value={String(m)}>{m} 月</option>
                ))}
              </select>
              <select aria-label="日" value={dateParts.d} onChange={(e) => form.setDateParts((p) => ({ ...p, d: e.target.value }))}>
                <option value="">日</option>
                {Array.from({ length: daysIn(dateParts.y, dateParts.m) }, (_, i) => i + 1).map((d) => (
                  <option key={d} value={String(d)}>{d} 日</option>
                ))}
              </select>
            </div>
          ) : (
            <div className="date-row">
              <Unit unit="年">
                <input
                  id="date"
                  type="text"
                  inputMode="numeric"
                  maxLength={4}
                  placeholder="1990"
                  aria-label="农历年"
                  value={lunar.year}
                  onChange={(e) => form.setLunar({ ...lunar, year: e.target.value.replace(/\D/g, "").slice(0, 4) })}
                />
              </Unit>
              <select aria-label="农历月" value={lunar.month} onChange={(e) => form.setLunar({ ...lunar, month: e.target.value })}>
                {MONTHS.map((m) => (
                  <option key={m} value={String(m)}>{m} 月</option>
                ))}
              </select>
              <select aria-label="农历日" value={lunar.day} onChange={(e) => form.setLunar({ ...lunar, day: e.target.value })}>
                {Array.from({ length: 30 }, (_, i) => i + 1).map((d) => (
                  <option key={d} value={String(d)}>{d} 日</option>
                ))}
              </select>
            </div>
          )}
          {form.calendar === "lunar" && (
            <label className="leap-check">
              <input type="checkbox" checked={form.isLeapMonth} onChange={(e) => form.setIsLeapMonth(e.target.checked)} />
              <span>出生于闰月（不确定可不勾选）</span>
            </label>
          )}
          {form.lunarMessage && (
            <small role="alert" className="field-error">
              {form.lunarMessage}
            </small>
          )}
          {form.lunarCheck?.valid && form.lunarCheck.solar_date && <small className="field-note">对应公历 {form.lunarCheck.solar_date}</small>}
        </div>

        <div className="field">
          <div className="field-head">
            <label htmlFor="time">出生时间</label>
            <span className="field-hint">24 小时制</span>
          </div>
          <div className="time-row">
            <Unit unit="时">
              <input
                id="time"
                type="text"
                inputMode="numeric"
                maxLength={2}
                placeholder="13"
                aria-label="时"
                value={timeParts.h}
                onChange={(e) => form.setTimeParts((p) => ({ ...p, h: digitsOnly(e.target.value, 23) }))}
              />
            </Unit>
            <Unit unit="分">
              <input
                type="text"
                inputMode="numeric"
                maxLength={2}
                placeholder="30"
                aria-label="分"
                value={timeParts.min}
                onChange={(e) => form.setTimeParts((p) => ({ ...p, min: digitsOnly(e.target.value, 59) }))}
              />
            </Unit>
          </div>
        </div>

        <div className="field">
          <div className="field-head">
            <label htmlFor="city">出生地点</label>
            <Segmented
              label="地点输入方式"
              value={form.placeMode}
              onChange={form.setPlaceMode}
              options={[
                { value: "dropdown", label: "选城市" },
                { value: "manual_coordinates", label: "填经纬度" },
              ]}
            />
          </div>
          <input
            id="city"
            type="text"
            autoComplete="off"
            placeholder="输入城市英文名，如 Shanghai"
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
                ? `已选：${form.city.name}（${form.city.country_code}），经度 ${form.city.longitude.toFixed(2)}°`
                : form.cityLoading
                  ? "搜索中…"
                  : "城市数据来自 GeoNames，暂只支持英文名；找不到可切换到「填经纬度」。"}
            </small>
          )}
        </div>

        <div className="field">
          <div className="field-head">
            <label>性别</label>
            <span className="field-hint">用于大运顺逆</span>
          </div>
          <Segmented<Gender>
            block
            label="性别"
            value={form.gender}
            onChange={form.setGender}
            options={[
              { value: "female", label: "女" },
              { value: "male", label: "男" },
            ]}
          />
        </div>

        {form.placeMode === "manual_coordinates" && (
          <>
            <DmsField axis="lng" value={form.lng} onChange={form.setLng} />
            <DmsField axis="lat" value={form.lat} onChange={form.setLat} />
          </>
        )}

        <p className="form-note">提示：真太阳时、节气交界与历法校准会影响专业排盘。结果仅供传统文化学习与参考，不用于现实决策。</p>
        {form.notice && <p className="notice">{form.notice}</p>}
        <button className="button button-primary" disabled={pending} onClick={onSubmit}>
          {pending ? "排盘中……" : "生成命盘"}
        </button>
      </div>
    </>
  );
}
