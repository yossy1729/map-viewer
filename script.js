// ================================
// ★ 設定
// ================================
const DEFAULT_CENTER = [35.68, 139.76];
const DEFAULT_ZOOM = 6;

const COMMON_MANUAL_CATEGORY = "手動共通";
const COMMON_MANUAL_COLOR = "red";

const MANUAL_CATEGORY = "手動マップ";
const MANUAL_COLOR = "darkred";

const CATEGORY_COLORS = [
    "blue",
    "green",
    "orange",
    "purple",
    "brown",
    "pink",
    "cyan",
    "yellow",
    "gray",
    "cadetblue",
];
const CATEGORY_COLOR_CODES = {
    red: "#D63E2A",
    darkred: "#A23336",
    blue: "#2A81CB",
    green: "#2AAD27",
    orange: "#FF7800",
    purple: "#9C2BCB",
    brown: "#A0522D",
    pink: "#FF69B4",
    cyan: "#00CED1",
    yellow: "#FFD700",
    gray: "#7B7B7B",
    cadetblue: "#3E8E9E",
};

// ================================
// URLパラメータ
// ================================
const params = new URLSearchParams(location.search);
const SHEET_ID = params.get("sheetid");
const MANAGE_GID = params.get("manage");
let CURRENT_GID = params.get("gid");

// ================================
let map;
let clusters = {};
let categoryColorMap = {};
let legendData = {};
let legendCount = {};

// ================================
function csvUrl(gid) {
    return `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${gid}`;
}

async function fetchCSV(url) {
    const text = await fetch(url).then((r) => r.text());
    const rows = text
        .trim()
        .split("\n")
        .map((r) => r.split(","));
    const headers = rows.shift();
    return rows.map((r) => {
        const obj = {};
        headers.forEach((h, i) => (obj[h] = r[i]));
        return obj;
    });
}

// ================================
// 初期化
// ================================
async function init() {
    document.getElementById("loading").style.display = "flex";

    const manage = await fetchCSV(csvUrl(MANAGE_GID));
    const commonRow = manage[0]; // 管理シート2行目＝共通手動枠
    const maps = manage.filter(
        (r) =>
            r["メニュー非表示"] !== "TRUE" &&
            r["メニュー表示名"] &&
            r["メニュー表示名"].trim() !== ""
    );

    if (!CURRENT_GID) CURRENT_GID = maps[0]["gid"];

    buildMenu(maps, commonRow);

    // 初期表示は最初のマップの行を使って center/zoom を決める
    const initialRow = maps.find((r) => r["gid"] === CURRENT_GID) || maps[0];
    await loadMap(commonRow, CURRENT_GID, initialRow);
}

// ================================
function buildMenu(list, commonRow) {
    const menu = document.getElementById("menu");
    menu.innerHTML = "";

    list.forEach((r) => {
        const btn = document.createElement("button");
        btn.textContent = r["メニュー表示名"];
        btn.onclick = async () => {
            CURRENT_GID = r["gid"];
            await loadMap(commonRow, CURRENT_GID, r);
            history.replaceState(
                null,
                "",
                `?sheetid=${SHEET_ID}&manage=${MANAGE_GID}&gid=${CURRENT_GID}`
            );
            document
                .querySelectorAll("#menu button")
                .forEach((b) => b.classList.remove("active"));
            btn.classList.add("active");
        };
        if (r["gid"] === CURRENT_GID) btn.classList.add("active");
        menu.appendChild(btn);
    });
}

// ================================
async function loadMap(commonRow, mapGid, displayRow) {
    document.getElementById("loading").style.display = "flex";

    // マップ初期化
    if (map) map.remove();
    map = L.map("map"); // とりあえず作るだけ
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png").addTo(
        map
    );

    // クラスタ・色・件数初期化
    clusters = {};
    categoryColorMap = {};
    legendData = {};
    legendCount = {};

    // ★ 共通手動 CSVを先に読み込む
    const manageCSV = await fetchCSV(csvUrl(MANAGE_GID));
    const commonManualGid = manageCSV[0]["gid"]; // 共通手動シートの GID
    const commonManualData = await fetchCSV(csvUrl(commonManualGid));
    if (commonManualGid !== mapGid) {
        commonManualData.forEach((d) => addMarker(d, true));
    }

    // ★ 選択マップCSVを読み込む
    const mapData = await fetchCSV(csvUrl(mapGid));
    mapData.forEach((d) => addMarker(d, false));

    Object.values(clusters).forEach((c) => map.addLayer(c));
    buildLegend();

    const center =
        displayRow["中心緯度"] && displayRow["中心経度"]
            ? [Number(displayRow["中心緯度"]), Number(displayRow["中心経度"])]
            : DEFAULT_CENTER;
    const zoom = displayRow["初期ズーム"]
        ? Number(displayRow["初期ズーム"])
        : DEFAULT_ZOOM;
    map.setView(center, zoom);

    document.getElementById("loading").style.display = "none";
}

// ================================
function addMarker(d, isCommon = false) {
    if (d["非表示"] === "TRUE") return;
    if (!d["緯度"] || !d["軽度"]) return;

    const category = isCommon
        ? COMMON_MANUAL_CATEGORY
        : d["カテゴリ"] === MANUAL_CATEGORY
        ? MANUAL_CATEGORY
        : d["カテゴリ"] || "未分類";

    let color;
    if (category === COMMON_MANUAL_CATEGORY) color = COMMON_MANUAL_COLOR;
    else if (category === MANUAL_CATEGORY) color = MANUAL_COLOR;
    else {
        if (!categoryColorMap[category]) {
            const idx = Object.keys(categoryColorMap).length;
            categoryColorMap[category] =
                CATEGORY_COLORS[idx % CATEGORY_COLORS.length];
        }
        color = categoryColorMap[category];
    }

    // 件数カウント
    legendData[category] = color;
    legendCount[category] = (legendCount[category] || 0) + 1;

    const icon = L.AwesomeMarkers.icon({
        icon: "fa-circle",
        markerColor: color,
        prefix: "fa",
    });

    const popup = [
        d["カテゴリ"]
            ? `<div class="badge-category">${d["カテゴリ"]}</div>`
            : null,
        d["ラベル1"] || d["ラベル2"] || d["ラベル3"]
            ? `
      <div class="box-labels">
        ${
            d["ラベル1"]
                ? `<div><span class="label-name">ラベル1：</span>${d["ラベル1"]}</div>`
                : ""
        }
        ${
            d["ラベル2"]
                ? `<div><span class="label-name">ラベル2：</span>${d["ラベル2"]}</div>`
                : ""
        }
        ${
            d["ラベル3"]
                ? `<div><span class="label-name">ラベル3：</span>${d["ラベル3"]}</div>`
                : ""
        }
      </div>
    `
            : null,
        d["住所"]
            ? `<div class="box-address"><span class="label-name">住所：</span>${d["住所"]}</div>`
            : null,
        d["備考"]
            ? `<div class="box-note"><span class="label-name">備考：</span>${d["備考"]}</div>`
            : null,
    ]
        .filter(Boolean)
        .join("");

    if (!clusters[category]) {
        clusters[category] = L.markerClusterGroup({
            iconCreateFunction: (cluster) => {
                const colorName =
                    cluster.getAllChildMarkers()[0].options.icon.options
                        .markerColor || "gray";
                const bgColor = CATEGORY_COLOR_CODES[colorName] || "#7B7B7B";
                // const firstColor =
                //     cluster.getAllChildMarkers()[0].options.icon.options
                //         .markerColor || "gray";
                return L.divIcon({
                    html: `<div style="background:${bgColor};border-radius:50%;width:30px;height:30px;color:#fff;display:flex;align-items:center;justify-content:center;">${cluster.getChildCount()}</div>`,
                    iconSize: [30, 30],
                });
            },
        });
    }

    clusters[category].addLayer(
        L.marker([Number(d["緯度"]), Number(d["軽度"])], { icon }).bindPopup(
            popup
        )
    );
}

// ================================
function buildLegend() {
    const legend = document.getElementById("legend");
    legend.innerHTML = "<strong>カテゴリ</strong><br>";

    Object.entries(legendData).forEach(([k, v]) => {
        const div = document.createElement("div");
        div.className = "legend-item";
        div.innerHTML = `<span class="legend-color" style="background:${v}"></span>${k} (${
            legendCount[k] || 0
        })`;
        legend.appendChild(div);
    });
}

// ================================
init();

document.addEventListener("DOMContentLoaded", () => {
    const hamburger = document.getElementById("hamburger");
    const sidebar = document.getElementById("sidebar");

    hamburger.addEventListener("click", () => {
        sidebar.classList.toggle("active");
        hamburger.classList.toggle("active");

        // アイコン切替
        if (hamburger.classList.contains("active")) {
            hamburger.innerHTML = "&times;"; // ✕
        } else {
            hamburger.innerHTML = "&#9776;"; // ☰
        }
    });
});
