import { useState, useMemo } from "react";

// =============================
// 定数・ユーティリティ
// =============================

const DISEASE_TYPES = [
  { id: "cerebrovascular", label: "脳血管疾患等リハ（Ⅱ）", shortLabel: "脳血管Ⅱ" },
  { id: "motor", label: "運動器リハ（Ⅰ）", shortLabel: "運動器Ⅰ" },
  { id: "disuse", label: "廃用症候群リハ（Ⅰ）", shortLabel: "廃用Ⅰ" },
];

// 各疾患の設定（2026年改定対応）
const DISEASE_CONFIG = {
  cerebrovascular: {
    baseDate: "onset", // 発症日・手術日・急性増悪日
    baseDateLabel: "発症日 / 手術日 / 急性増悪日",
    standardDays: 180,
    hasDisuseAcuteExacerbation: false,
    specialOptions: [
      { id: "transfer", label: "転院患者（前医入院日を起算日に使用）" },
      { id: "stroke_within_60", label: "発症後60日以内（9単位/日算定可）" },
    ],
  },
  motor: {
    baseDate: "onset",
    baseDateLabel: "発症日 / 手術日 / 急性増悪日",
    standardDays: 150,
    hasDisuseAcuteExacerbation: false,
    specialOptions: [
      { id: "transfer", label: "転院患者（前医入院日を起算日に使用）" },
      { id: "chronic_disease", label: "慢性疾患患者（休日リハ加算算定不可）" },
    ],
  },
  disuse: {
    baseDate: "acute_exacerbation", // 廃用は急性増悪診断日が特殊
    baseDateLabel: "廃用症候群に係る急性増悪の診断日",
    standardDays: 120,
    hasDisuseAcuteExacerbation: true,
    specialOptions: [
      { id: "transfer", label: "転院患者（前医入院日を起算日に使用）" },
    ],
  },
};

// 祝日データ（2024〜2026年）
const HOLIDAYS = new Set([
  // 2024
  "2024-01-01","2024-01-08","2024-02-11","2024-02-12","2024-03-20","2024-04-29",
  "2024-05-03","2024-05-04","2024-05-05","2024-05-06","2024-07-15","2024-08-11",
  "2024-08-12","2024-09-16","2024-09-22","2024-09-23","2024-10-14","2024-11-03",
  "2024-11-04","2024-11-23","2024-12-29","2024-12-30","2024-12-31",
  // 2025
  "2025-01-01","2025-01-02","2025-01-03","2025-01-13","2025-02-11","2025-02-23",
  "2025-02-24","2025-03-20","2025-04-29","2025-05-03","2025-05-04","2025-05-05",
  "2025-05-06","2025-07-21","2025-08-11","2025-09-15","2025-09-23","2025-10-13",
  "2025-11-03","2025-11-23","2025-11-24","2025-12-29","2025-12-30","2025-12-31",
  // 2026
  "2026-01-01","2026-01-02","2026-01-03","2026-01-12","2026-02-11","2026-02-23",
  "2026-03-20","2026-04-29","2026-05-03","2026-05-04","2026-05-05","2026-05-06",
  "2026-07-20","2026-08-11","2026-09-21","2026-09-22","2026-09-23","2026-10-12",
  "2026-11-03","2026-11-23","2026-12-29","2026-12-30","2026-12-31",
]);

function toDateStr(date) {
  return date.toISOString().split("T")[0];
}

function parseDate(str) {
  if (!str) return null;
  const d = new Date(str + "T00:00:00");
  return isNaN(d.getTime()) ? null : d;
}

function addDays(date, n) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

function diffDays(a, b) {
  // b - a の日数
  return Math.round((b - a) / (1000 * 60 * 60 * 24));
}

function isHoliday(date) {
  const dow = date.getDay();
  const str = toDateStr(date);
  return dow === 0 || dow === 6 || HOLIDAYS.has(str);
}

function formatDate(date) {
  if (!date) return "-";
  return `${date.getFullYear()}/${String(date.getMonth() + 1).padStart(2, "0")}/${String(date.getDate()).padStart(2, "0")}`;
}

function formatDateJa(date) {
  if (!date) return "-";
  const days = ["日", "月", "火", "水", "木", "金", "土"];
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日（${days[date.getDay()]}）`;
}

// =============================
// 加算期間計算ロジック
// =============================

function calcKasan(admissionDate, baseDateStr, diseaseType, selectedOptions, hasSeikyuC) {
  const admission = parseDate(admissionDate);
  const baseDate = parseDate(baseDateStr);

  if (!admission || !baseDate) return null;

  const config = DISEASE_CONFIG[diseaseType];
  const isTransfer = selectedOptions.includes("transfer");
  const isChronic = selectedOptions.includes("chronic_disease");

  // 早期リハ加算の起算日：入院日（転院時は前医入院日）
  // ※ここでは入院日フィールドをそのまま使用（転院の場合は前医入院日を入力してもらう）
  const soukiStart = admission;

  // 初期加算・急性期リハ加算・休日リハ加算の起算日
  // 廃用は急性増悪診断日、それ以外は発症/手術/急性増悪日
  // ただし「発症等7日目または治療開始日の早いもの」が休日・急性期の起算
  const kijunDate = baseDate; // 発症等の日

  // 早期リハ加算（系統A）
  // 入院1〜3日目: 60点、4〜14日目: 25点、入院日から14日以内
  const soukiEnd = addDays(soukiStart, 13); // 14日目まで（1日目=入院当日）

  // 初期加算（系統B）
  // 発症等の日から14日以内（廃用：急性増悪診断日から14日以内）
  // ただし「発症等7日目又は治療開始日のいずれか早いもの」から起算ではなく
  // 「発症等の日から14日を限度」
  const shokiStart = kijunDate;
  const shokiEnd = addDays(kijunDate, 13); // 14日目まで

  // 急性期リハ加算（系統C）
  // 「発症等7日目又は治療開始日のいずれか早いもの」から起算して30日以内
  // ここでは治療開始日=入院日として計算（実際は最初にリハを実施した日）
  const day7FromBase = addDays(kijunDate, 6); // 7日目（当日含む）
  const acuteKijun = day7FromBase < admission ? day7FromBase : admission; // 早い方
  const acuteEnd = addDays(acuteKijun, 29); // 30日以内

  // 休日リハ加算（2026新設）
  // 起算日は急性期リハ加算と同じ「発症等7日目又は治療開始日のいずれか早いもの」
  // 期間は30日以内（慢性疾患は不可）
  const kyujitsuEnd = isChronic ? null : addDays(acuteKijun, 29);

  return {
    soukiStart,
    soukiEnd,
    shokiStart,
    shokiEnd,
    acuteKijun,
    acuteEnd: hasSeikyuC ? acuteEnd : null,
    kyujitsuEnd,
    kyujitsuStart: isChronic ? null : acuteKijun,
    kijunDate,
    isChronic,
  };
}

// =============================
// カレンダー生成
// =============================

function buildCalendarData(year, month, kasan) {
  if (!kasan) return [];

  const { soukiStart, soukiEnd, shokiStart, shokiEnd, acuteEnd, kyujitsuEnd, kyujitsuStart, acuteKijun } = kasan;

  const firstDay = new Date(year, month - 1, 1);
  const lastDay = new Date(year, month, 0);
  const startDow = firstDay.getDay();

  const cells = [];
  for (let i = 0; i < startDow; i++) cells.push(null);

  for (let d = 1; d <= lastDay.getDate(); d++) {
    const date = new Date(year, month - 1, d);
    const str = toDateStr(date);
    const isHol = isHoliday(date);

    const inSouki = date >= soukiStart && date <= soukiEnd;
    const isSoukiHigh = inSouki && date <= addDays(soukiStart, 2); // 1〜3日目
    const isSoukiLow = inSouki && !isSoukiHigh; // 4〜14日目

    const inShoki = date >= shokiStart && date <= shokiEnd;
    const inAcute = acuteEnd ? date >= acuteKijun && date <= acuteEnd : false;
    const inKyujitsu = kyujitsuEnd && kyujitsuStart ? (date >= kyujitsuStart && date <= kyujitsuEnd && isHol) : false;

    // 入院日・発症日などのマーカー
    const isAdmission = str === toDateStr(kasan.soukiStart);
    const isBase = str === toDateStr(kasan.kijunDate);

    cells.push({
      date,
      d,
      isHol,
      isSoukiHigh,
      isSoukiLow,
      inSouki,
      inShoki,
      inAcute,
      inKyujitsu,
      isAdmission,
      isBase,
      str,
    });
  }

  // 週の端数を埋める
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

// =============================
// コンポーネント
// =============================

const BADGE_DEFS = [
  { key: "soukiHigh", bg: "#2563eb", label: "早60" },
  { key: "soukiLow",  bg: "#60a5fa", label: "早25" },
  { key: "shoki",     bg: "#16a34a", label: "初期" },
  { key: "acute",     bg: "#9333ea", label: "急性" },
  { key: "kyujitsu",  bg: "#f59e0b", label: "休日" },
];

// 凡例用（サマリーセクションで参照）
const COLORS = {
  soukiHigh: { bg: "#2563eb", label: "早期加算 60点（1〜3日目）" },
  soukiLow:  { bg: "#60a5fa", label: "早期加算 25点（4〜14日目）" },
  shoki:     { bg: "#16a34a", label: "初期加算 45点" },
  acute:     { bg: "#9333ea", label: "急性期リハ加算（系統C）" },
  kyujitsu:  { bg: "#f59e0b", label: "休日リハ加算 25点" },
};

function DayCell({ cell, today }) {
  if (!cell) return <div style={{ minHeight: "64px" }} />;

  const isToday = toDateStr(cell.date) === toDateStr(today);

  // 該当する加算キーを収集
  const activeKeys = [];
  if (cell.isSoukiHigh) activeKeys.push("soukiHigh");
  if (cell.isSoukiLow)  activeKeys.push("soukiLow");
  if (cell.inShoki)     activeKeys.push("shoki");
  if (cell.inAcute)     activeKeys.push("acute");
  if (cell.inKyujitsu)  activeKeys.push("kyujitsu");

  const hasAny = activeKeys.length > 0;

  return (
    <div
      style={{
        background: cell.isHol ? "#fef2f2" : "#fff",
        border: isToday ? "2px solid #ef4444" : "1px solid #e5e7eb",
        borderRadius: "6px",
        minHeight: "64px",
        padding: "3px 3px 3px 3px",
        display: "flex",
        flexDirection: "column",
        gap: "2px",
        boxSizing: "border-box",
      }}
    >
      {/* 日付行 */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", lineHeight: 1 }}>
        <span style={{
          fontSize: "12px",
          fontWeight: "700",
          color: isToday ? "#ef4444" : cell.isHol ? "#dc2626" : "#374151",
        }}>
          {cell.d}
        </span>
        {isToday && (
          <span style={{ fontSize: "8px", color: "#ef4444", fontWeight: "700", lineHeight: 1 }}>今日</span>
        )}
      </div>

      {/* 入院日・発症日ラベル */}
      {cell.isAdmission && (
        <div style={{
          fontSize: "8px", background: "#1e40af", color: "#fff",
          borderRadius: "2px", padding: "1px 3px", lineHeight: 1.4, textAlign: "center",
        }}>入院</div>
      )}
      {cell.isBase && !cell.isAdmission && (
        <div style={{
          fontSize: "8px", background: "#065f46", color: "#fff",
          borderRadius: "2px", padding: "1px 3px", lineHeight: 1.4, textAlign: "center",
        }}>発症等</div>
      )}

      {/* 加算バッジ：各加算を独立した色帯で縦に並べる */}
      {BADGE_DEFS.filter(b => activeKeys.includes(b.key)).map(b => (
        <div
          key={b.key}
          style={{
            background: b.bg,
            color: "#fff",
            fontSize: "8px",
            fontWeight: "700",
            borderRadius: "3px",
            padding: "1px 3px",
            lineHeight: 1.5,
            textAlign: "center",
            letterSpacing: "0.02em",
          }}
        >
          {b.label}
        </div>
      ))}
    </div>
  );
}

function CalendarMonth({ year, month, kasan, today }) {
  const cells = buildCalendarData(year, month, kasan);
  const weeks = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));

  const monthNames = ["1月","2月","3月","4月","5月","6月","7月","8月","9月","10月","11月","12月"];

  return (
    <div style={{ marginBottom: "16px" }}>
      <div style={{ textAlign: "center", fontWeight: "700", fontSize: "14px", color: "#374151", marginBottom: "8px" }}>
        {year}年 {monthNames[month - 1]}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: "2px", marginBottom: "2px" }}>
        {["日","月","火","水","木","金","土"].map((d, i) => (
          <div key={d} style={{
            textAlign: "center", fontSize: "11px", fontWeight: "600",
            color: i === 0 ? "#dc2626" : i === 6 ? "#2563eb" : "#6b7280",
            padding: "2px 0",
          }}>{d}</div>
        ))}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: "2px" }}>
        {weeks.flat().map((cell, idx) => (
          <DayCell key={idx} cell={cell} today={today} />
        ))}
      </div>
    </div>
  );
}

// =============================
// メインアプリ
// =============================

export default function RehaKasanChecker() {
  const today = new Date();

  const [diseaseType, setDiseaseType] = useState("cerebrovascular");
  const [admissionDate, setAdmissionDate] = useState("");
  const [baseDate, setBaseDate] = useState("");
  const [selectedOptions, setSelectedOptions] = useState([]);
  const [hasSeikyuC, setHasSeikyuC] = useState(false);
  const [calendarMonth, setCalendarMonth] = useState({ year: today.getFullYear(), month: today.getMonth() + 1 });

  const config = DISEASE_CONFIG[diseaseType];

  const kasan = useMemo(() => {
    if (!admissionDate || !baseDate) return null;
    return calcKasan(admissionDate, baseDate, diseaseType, selectedOptions, hasSeikyuC);
  }, [admissionDate, baseDate, diseaseType, selectedOptions, hasSeikyuC]);

  const toggleOption = (id) => {
    setSelectedOptions(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  };

  const handleDiseaseChange = (id) => {
    setDiseaseType(id);
    setSelectedOptions([]);
  };

  // 残日数計算
  function calcRemaining(endDate) {
    if (!endDate) return null;
    const diff = diffDays(today, endDate);
    if (diff < 0) return { days: Math.abs(diff), expired: true };
    return { days: diff + 1, expired: false }; // 当日含む
  }

  // カレンダーナビ
  const prevMonth = () => {
    setCalendarMonth(prev => {
      const m = prev.month - 1;
      return m < 1 ? { year: prev.year - 1, month: 12 } : { year: prev.year, month: m };
    });
  };
  const nextMonth = () => {
    setCalendarMonth(prev => {
      const m = prev.month + 1;
      return m > 12 ? { year: prev.year + 1, month: 1 } : { year: prev.year, month: m };
    });
  };
  const resetMonth = () => {
    setCalendarMonth({ year: today.getFullYear(), month: today.getMonth() + 1 });
  };

  const inputStyle = {
    width: "100%",
    padding: "10px 12px",
    border: "1.5px solid #d1d5db",
    borderRadius: "8px",
    fontSize: "15px",
    background: "#fff",
    color: "#111827",
    boxSizing: "border-box",
    appearance: "none",
    WebkitAppearance: "none",
  };

  const labelStyle = {
    display: "block",
    fontSize: "12px",
    fontWeight: "600",
    color: "#374151",
    marginBottom: "5px",
    letterSpacing: "0.02em",
  };

  const cardStyle = {
    background: "#fff",
    borderRadius: "12px",
    padding: "14px 16px",
    marginBottom: "10px",
    boxShadow: "0 1px 4px rgba(0,0,0,0.08)",
    border: "1px solid #f3f4f6",
  };

  const sectionTitle = {
    fontSize: "13px",
    fontWeight: "700",
    color: "#6b7280",
    textTransform: "uppercase",
    letterSpacing: "0.07em",
    marginBottom: "12px",
  };

  return (
    <div style={{
      minHeight: "100vh",
      background: "#f0f4f8",
      fontFamily: "'Noto Sans JP', 'Hiragino Kaku Gothic ProN', sans-serif",
      WebkitFontSmoothing: "antialiased",
    }}>
      {/* ヘッダー */}
      <div style={{
        background: "linear-gradient(135deg, #1e3a5f 0%, #2563eb 100%)",
        padding: "20px 16px 16px",
        color: "#fff",
      }}>
        <div style={{ fontSize: "11px", fontWeight: "600", opacity: 0.7, letterSpacing: "0.1em", marginBottom: "4px" }}>
          令和8年度診療報酬改定対応
        </div>
        <div style={{ fontSize: "18px", fontWeight: "800", letterSpacing: "-0.01em", lineHeight: 1.2 }}>
          疾患別リハビリ<br />加算期間チェッカー
        </div>
        <div style={{ fontSize: "11px", opacity: 0.6, marginTop: "6px" }}>
          2026年6月施行版
        </div>
      </div>

      <div style={{ padding: "14px 14px 80px" }}>

        {/* 疾患区分選択 */}
        <div style={cardStyle}>
          <div style={sectionTitle}>疾患区分</div>
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            {DISEASE_TYPES.map(dt => (
              <button
                key={dt.id}
                onClick={() => handleDiseaseChange(dt.id)}
                style={{
                  padding: "11px 14px",
                  borderRadius: "8px",
                  border: diseaseType === dt.id ? "2px solid #2563eb" : "1.5px solid #e5e7eb",
                  background: diseaseType === dt.id ? "#eff6ff" : "#fafafa",
                  color: diseaseType === dt.id ? "#1d4ed8" : "#374151",
                  fontWeight: diseaseType === dt.id ? "700" : "500",
                  fontSize: "14px",
                  textAlign: "left",
                  cursor: "pointer",
                  transition: "all 0.15s",
                }}
              >
                {dt.label}
              </button>
            ))}
          </div>
        </div>

        {/* 日付入力 */}
        <div style={cardStyle}>
          <div style={sectionTitle}>日付入力</div>
          <div style={{ marginBottom: "14px" }}>
            <label style={labelStyle}>入院日（早期リハ加算の起算日）</label>
            <input
              type="date"
              value={admissionDate}
              onChange={e => setAdmissionDate(e.target.value)}
              style={inputStyle}
            />
            <div style={{ fontSize: "11px", color: "#9ca3af", marginTop: "4px" }}>
              ※転院患者は前医の入院日を入力
            </div>
          </div>
          <div>
            <label style={labelStyle}>{config.baseDateLabel}</label>
            <input
              type="date"
              value={baseDate}
              onChange={e => setBaseDate(e.target.value)}
              style={inputStyle}
            />
            {diseaseType === "disuse" && (
              <div style={{ fontSize: "11px", color: "#9ca3af", marginTop: "4px" }}>
                ※廃用症候群：急性増悪の診断日（発症日・手術日ではない）
              </div>
            )}
          </div>
        </div>

        {/* 特例・オプション */}
        <div style={cardStyle}>
          <div style={sectionTitle}>特例・算定オプション</div>

          {/* 急性期リハ加算（系統C）施設基準 */}
          <div
            onClick={() => setHasSeikyuC(!hasSeikyuC)}
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: "10px",
              padding: "10px 12px",
              borderRadius: "8px",
              border: hasSeikyuC ? "1.5px solid #7c3aed" : "1.5px solid #e5e7eb",
              background: hasSeikyuC ? "#f5f3ff" : "#fafafa",
              cursor: "pointer",
              marginBottom: "8px",
            }}
          >
            <div style={{
              width: "20px", height: "20px", borderRadius: "4px", flexShrink: 0, marginTop: "1px",
              background: hasSeikyuC ? "#7c3aed" : "#fff",
              border: hasSeikyuC ? "none" : "1.5px solid #d1d5db",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              {hasSeikyuC && <span style={{ color: "#fff", fontSize: "13px", lineHeight: 1 }}>✓</span>}
            </div>
            <div>
              <div style={{ fontSize: "13px", fontWeight: "600", color: hasSeikyuC ? "#6d28d9" : "#374151" }}>
                急性期リハ加算（系統C）算定可
              </div>
              <div style={{ fontSize: "11px", color: "#6b7280", marginTop: "2px" }}>
                施設基準：リハ科常勤医師在籍が必要
              </div>
            </div>
          </div>

          {/* 疾患別特例オプション */}
          {config.specialOptions.map(opt => (
            <div
              key={opt.id}
              onClick={() => toggleOption(opt.id)}
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: "10px",
                padding: "10px 12px",
                borderRadius: "8px",
                border: selectedOptions.includes(opt.id) ? "1.5px solid #2563eb" : "1.5px solid #e5e7eb",
                background: selectedOptions.includes(opt.id) ? "#eff6ff" : "#fafafa",
                cursor: "pointer",
                marginBottom: "8px",
              }}
            >
              <div style={{
                width: "20px", height: "20px", borderRadius: "4px", flexShrink: 0, marginTop: "1px",
                background: selectedOptions.includes(opt.id) ? "#2563eb" : "#fff",
                border: selectedOptions.includes(opt.id) ? "none" : "1.5px solid #d1d5db",
                display: "flex", alignItems: "center", justifyContent: "center",
              }}>
                {selectedOptions.includes(opt.id) && <span style={{ color: "#fff", fontSize: "13px", lineHeight: 1 }}>✓</span>}
              </div>
              <div style={{ fontSize: "13px", fontWeight: "500", color: selectedOptions.includes(opt.id) ? "#1d4ed8" : "#374151" }}>
                {opt.label}
              </div>
            </div>
          ))}
        </div>

        {/* 結果表示 */}
        {kasan && (
          <>
            {/* 加算期間サマリー */}
            <div style={cardStyle}>
              <div style={sectionTitle}>算定期間サマリー</div>

              {/* 早期リハ加算 */}
              <div style={{ marginBottom: "12px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "5px" }}>
                  <div style={{ width: "10px", height: "10px", borderRadius: "2px", background: "#2563eb", flexShrink: 0 }} />
                  <div style={{ fontSize: "13px", fontWeight: "700", color: "#1e40af" }}>早期リハビリテーション加算（系統A）</div>
                </div>
                <div style={{ paddingLeft: "18px" }}>
                  <div style={{ display: "flex", gap: "8px", marginBottom: "4px", flexWrap: "wrap" }}>
                    <div style={{ fontSize: "12px", background: "#2563eb", color: "#fff", borderRadius: "4px", padding: "2px 7px" }}>
                      60点：入院1〜3日目（{formatDate(kasan.soukiStart)}〜{formatDate(addDays(kasan.soukiStart, 2))}）
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: "8px", marginBottom: "4px", flexWrap: "wrap" }}>
                    <div style={{ fontSize: "12px", background: "#93c5fd", color: "#1e3a5f", borderRadius: "4px", padding: "2px 7px" }}>
                      25点：入院4〜14日目（{formatDate(addDays(kasan.soukiStart, 3))}〜{formatDate(kasan.soukiEnd)}）
                    </div>
                  </div>
                  {(() => {
                    const rem = calcRemaining(kasan.soukiEnd);
                    return rem && !rem.expired ? (
                      <div style={{ fontSize: "12px", color: "#6b7280" }}>
                        算定終了日：{formatDateJa(kasan.soukiEnd)}　残{rem.days}日
                      </div>
                    ) : rem?.expired ? (
                      <div style={{ fontSize: "12px", color: "#dc2626" }}>⚠ 算定期間終了（{rem.days}日前）</div>
                    ) : null;
                  })()}
                </div>
              </div>

              {/* 初期加算 */}
              <div style={{ marginBottom: "12px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "5px" }}>
                  <div style={{ width: "10px", height: "10px", borderRadius: "2px", background: "#16a34a", flexShrink: 0 }} />
                  <div style={{ fontSize: "13px", fontWeight: "700", color: "#14532d" }}>初期加算（系統B）</div>
                </div>
                <div style={{ paddingLeft: "18px" }}>
                  <div style={{ fontSize: "12px", color: "#374151", marginBottom: "3px" }}>
                    45点 / 単位　{formatDateJa(kasan.shokiStart)}〜{formatDateJa(kasan.shokiEnd)}
                  </div>
                  {(() => {
                    const rem = calcRemaining(kasan.shokiEnd);
                    return rem && !rem.expired ? (
                      <div style={{ fontSize: "12px", color: "#6b7280" }}>残{rem.days}日</div>
                    ) : rem?.expired ? (
                      <div style={{ fontSize: "12px", color: "#dc2626" }}>⚠ 算定期間終了（{rem.days}日前）</div>
                    ) : null;
                  })()}
                </div>
              </div>

              {/* 急性期リハ加算 */}
              {hasSeikyuC && kasan.acuteEnd && (
                <div style={{ marginBottom: "12px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "5px" }}>
                    <div style={{ width: "10px", height: "10px", borderRadius: "2px", background: "#9333ea", flexShrink: 0 }} />
                    <div style={{ fontSize: "13px", fontWeight: "700", color: "#581c87" }}>急性期リハビリテーション加算（系統C）</div>
                  </div>
                  <div style={{ paddingLeft: "18px" }}>
                    <div style={{ fontSize: "12px", color: "#374151", marginBottom: "3px" }}>
                      起算：{formatDateJa(kasan.acuteKijun)}〜{formatDateJa(kasan.acuteEnd)}（30日以内）
                    </div>
                    <div style={{ fontSize: "11px", color: "#9ca3af" }}>
                      ※発症等7日目 or 治療開始日の早い方から起算
                    </div>
                    {(() => {
                      const rem = calcRemaining(kasan.acuteEnd);
                      return rem && !rem.expired ? (
                        <div style={{ fontSize: "12px", color: "#6b7280", marginTop: "2px" }}>残{rem.days}日</div>
                      ) : rem?.expired ? (
                        <div style={{ fontSize: "12px", color: "#dc2626", marginTop: "2px" }}>⚠ 算定期間終了</div>
                      ) : null;
                    })()}
                  </div>
                </div>
              )}

              {/* 休日リハ加算 */}
              {!kasan.isChronic && kasan.kyujitsuEnd && (
                <div style={{ marginBottom: "4px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "5px" }}>
                    <div style={{ width: "10px", height: "10px", borderRadius: "2px", background: "#f59e0b", flexShrink: 0 }} />
                    <div style={{ fontSize: "13px", fontWeight: "700", color: "#78350f" }}>休日リハビリテーション加算（2026新設）</div>
                  </div>
                  <div style={{ paddingLeft: "18px" }}>
                    <div style={{ fontSize: "12px", color: "#374151", marginBottom: "3px" }}>
                      25点 / 単位　{formatDateJa(kasan.kyujitsuStart)}〜{formatDateJa(kasan.kyujitsuEnd)}の土日祝
                    </div>
                    <div style={{ fontSize: "11px", color: "#9ca3af" }}>
                      ※1月2・3日、12月29〜31日も休日扱い／入院患者のみ
                    </div>
                    {(() => {
                      const rem = calcRemaining(kasan.kyujitsuEnd);
                      return rem && !rem.expired ? (
                        <div style={{ fontSize: "12px", color: "#6b7280", marginTop: "2px" }}>残{rem.days}日（当日含む）</div>
                      ) : rem?.expired ? (
                        <div style={{ fontSize: "12px", color: "#dc2626", marginTop: "2px" }}>⚠ 算定期間終了</div>
                      ) : null;
                    })()}
                  </div>
                </div>
              )}

              {kasan.isChronic && (
                <div style={{ background: "#fef9c3", borderRadius: "8px", padding: "10px 12px", marginTop: "4px" }}>
                  <div style={{ fontSize: "12px", color: "#854d0e" }}>
                    ⚠ 慢性疾患患者のため、<strong>休日リハビリテーション加算は算定不可</strong>です（2026年訂正通知）
                  </div>
                </div>
              )}
            </div>

            {/* 凡例 */}
            <div style={{ ...cardStyle, marginBottom: "10px" }}>
              <div style={sectionTitle}>カレンダー凡例</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px" }}>
                {[
                  { color: "#2563eb", label: "早期加算 60点（1〜3日）" },
                  { color: "#60a5fa", label: "早期加算 25点（4〜14日）" },
                  { color: "#16a34a", label: "初期加算 45点" },
                  { color: "#9333ea", label: "急性期リハ加算（系統C）" },
                  { color: "#f59e0b", label: "休日リハ加算 25点" },
                ].map(item => (
                  <div key={item.label} style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                    <div style={{ width: "14px", height: "14px", borderRadius: "3px", background: item.color, flexShrink: 0 }} />
                    <div style={{ fontSize: "11px", color: "#374151", lineHeight: 1.3 }}>{item.label}</div>
                  </div>
                ))}
                <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                  <div style={{ width: "14px", height: "14px", borderRadius: "3px", border: "2px solid #ef4444", flexShrink: 0 }} />
                  <div style={{ fontSize: "11px", color: "#374151" }}>今日</div>
                </div>
              </div>
            </div>

            {/* カレンダー */}
            <div style={cardStyle}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "12px" }}>
                <button onClick={prevMonth} style={{ padding: "6px 12px", border: "1.5px solid #e5e7eb", borderRadius: "6px", background: "#fff", fontSize: "16px", cursor: "pointer" }}>‹</button>
                <div style={{ fontSize: "14px", fontWeight: "700", color: "#374151" }}>
                  {calendarMonth.year}年 {calendarMonth.month}月
                  <button onClick={resetMonth} style={{ marginLeft: "8px", fontSize: "11px", padding: "2px 8px", border: "1px solid #d1d5db", borderRadius: "4px", background: "#f9fafb", cursor: "pointer", color: "#6b7280" }}>今月</button>
                </div>
                <button onClick={nextMonth} style={{ padding: "6px 12px", border: "1.5px solid #e5e7eb", borderRadius: "6px", background: "#fff", fontSize: "16px", cursor: "pointer" }}>›</button>
              </div>
              <CalendarMonth year={calendarMonth.year} month={calendarMonth.month} kasan={kasan} today={today} />
            </div>

            {/* 注意事項 */}
            <div style={{ background: "#fefce8", borderRadius: "10px", padding: "12px 14px", border: "1px solid #fef08a" }}>
              <div style={{ fontSize: "12px", fontWeight: "700", color: "#854d0e", marginBottom: "6px" }}>⚠ 注意事項</div>
              <div style={{ fontSize: "11px", color: "#713f12", lineHeight: 1.7 }}>
                • 系統A（早期）と系統B（初期）は要件を満たす期間内で<strong>併算定可</strong><br />
                • 早期離床・リハ加算（系統D）算定日は系統A・B・Cすべて算定不可<br />
                • 急性期リハ加算（系統C）は<strong>リハ科常勤医師の施設基準届出が必要</strong><br />
                • 休日加算の「休日」は土日祝日＋1/2・1/3・12/29〜31<br />
                • 本ツールは実務確認補助用です。最終判断は点数表・疑義解釈に基づいて行ってください
              </div>
            </div>
          </>
        )}

        {!kasan && (
          <div style={{ textAlign: "center", padding: "32px 16px", color: "#9ca3af" }}>
            <div style={{ fontSize: "40px", marginBottom: "12px" }}>📅</div>
            <div style={{ fontSize: "14px" }}>疾患区分と日付を入力すると<br />加算期間が表示されます</div>
          </div>
        )}
      </div>
    </div>
  );
}
