require("dotenv").config();
const express = require("express");
const { engine } = require("express-handlebars");
const bodyParser = require("body-parser");
const mysql = require("mysql2");
const multer = require("multer");
const csv = require("csv-parser");
const fs = require("fs");
const upload = multer({ dest: "uploads/" });
const app = express();
const iconv = require("iconv-lite");

// 設置模板引擎
app.engine("hbs", engine({ extname: ".hbs", defaultLayout: "main" }));
app.set("view engine", "hbs");
app.set("views", "./views");

// 中間件
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(express.static("public"));


// 資料庫連接設置
const db = mysql.createConnection({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_DATABASE,
  port: process.env.DB_PORT,
});

db.connect((err) => {
  if (err) {
    console.error("資料庫連接失敗:", err);
    return;
  }
  console.log("已成功連接資料庫");
});

// 首頁路由
app.get("/", (req, res) => {
  res.render("index");
});

// 新增案件頁面路由
app.get("/add-case", (req, res) => {
  res.render("add_case");
});

// 匯入車籍資料頁面
app.get("/upload-registry", (req, res) => {
  res.render("upload_registry");
});


// 處理新增案件的提交請求
app.post("/add-case", async (req, res) => {
  const { caseYear, caseMonth, issueDate, issueDept, issueNumber, vehicleNumbers } = req.body;
  const caseMonthFull = `${caseYear}-${String(caseMonth).padStart(2, "0")}-01`;
  const vehicles = vehicleNumbers.split("\n").map((v) => v.trim()).filter((v) => v);

  try {
    // 插入或更新 source_case
    const sourceCaseSql = "INSERT IGNORE INTO source_case (issue_date, issue_dept, issue_number) VALUES (?, ?, ?)";
    await db.promise().query(sourceCaseSql, [issueDate, issueDept, issueNumber]);
    let responseMessage = "";

    for (const vehicle of vehicles) {
      // 檢查或插入 cases
      const caseCheckSql = "SELECT id FROM cases WHERE vehicle_number = ?";
      const [caseCheckResults] = await db.promise().query(caseCheckSql, [vehicle]);

      let caseId;
      if (caseCheckResults.length > 0) {
        caseId = caseCheckResults[0].id;
      } else {
        const registrySql = `
          SELECT owner_name FROM bike_registry WHERE query_number = ?
          UNION
          SELECT owner_name FROM car_registry WHERE query_number = ?
        `;
        const [registryResults] = await db.promise().query(registrySql, [vehicle, vehicle]);
        const ownerName = registryResults[0] ? registryResults[0].owner_name : "未知";

        const caseInsertSql = "INSERT INTO cases (vehicle_number, owner_name, case_month) VALUES (?, ?, ?)";
        const [caseInsertResult] = await db.promise().query(caseInsertSql, [vehicle, ownerName, caseMonthFull]);
        caseId = caseInsertResult.insertId;
      }

      // 插入 case_source_links
      const caseSourceLinksSql = "INSERT IGNORE INTO case_source_links (case_id, issue_number) VALUES (?, ?)";
      await db.promise().query(caseSourceLinksSql, [caseId, issueNumber]);

      // 插入 source_case_vehicle_links
      const sourceCaseVehicleLinksSql =
        "INSERT IGNORE INTO source_case_vehicle_links (issue_number, vehicle_number) VALUES (?, ?)";
      await db.promise().query(sourceCaseVehicleLinksSql, [issueNumber, vehicle]);


      // 添加成功訊息
      responseMessage += `案件車號: ${vehicle}, ${issueDept}, ${issueNumber} 已成功新增!<br>`;
    }
    res.json({ message: responseMessage });
  } catch (err) {
    console.error("操作失敗：", err);
    res.status(500).json({ message: "新增案件失敗，請檢查伺服器日誌！" });
  }
});

// 處理機車車籍上傳
app.post("/upload-bike-registry", upload.single("bikeFile"), (req, res) => {
  const tableName = "bike_registry";
  const fieldMapping = {
    "查詢車號": "query_number",
    "目前車號": "current_number",
    "前次車號": "last_number",
    "車主": "owner_name",
    "車主証號": "owner_id",
    "郵遞區號": "perm_zip",
    "車主地址": "owner_addr",
    "電話": "tel_number",
    "目前監理站": "current_office",
    "原監理站": "original_office",
    "引擎號碼": "engine_number",
    "廠牌": "brand",
    "環保種類": "vehicle_classification",
    "顏色": "color",
    "排氣量": "engine_displacement",
    "出廠年月": "year_mfg",
    "領牌日期": "license_date",
    "能源類種": "power_type",
    "發牌原因": "license_reason",
    "狀態日期": "status_date",
    "牌照狀況": "license_status",
    "牌照繳回數": "license_return",
    "最近換牌日期": "renewal_license_date",
    "換補照日期": "reissue_license_date",
    "環保違規未結": "illegal_unclosed",
    "禁止異動": "ban",
    "行照有效日": "expiration_date",
    "前車主1": "owner_name_1",
    "前車主証號1": "owner_id_1",
    "前車主地址1": "owner_addr_1",
    "過戶異動日1": "transfer_date_1",
    "前車主2": "owner_name_2",
    "前車主証號2": "owner_id_2",
    "前車主地址2": "owner_addr_2",
    "異動過戶日2": "transfer_date_2",
    "前車主3": "owner_name_3",
    "前車主証號3": "owner_id_3",
    "前車主地址3": "owner_addr_3",
    "異動過戶日3": "transfer_date_3",
    "前車主4": "owner_name_4",
    "証號4": "owner_id_4",
    "前車主地址4": "owner_addr_4",
    "異動過戶日4": "transfer_date_4",
    "動保狀態": "property_secured",
    "通訊地址": "current_addr",
    "型式": "vehicle_type",
    "車身號碼": "serial_number",
  };
  handleCsvUpload(req, res, tableName, fieldMapping);
});

// 處理汽車車籍上傳
app.post("/upload-car-registry", upload.single("carFile"), (req, res) => {
  const tableName = "car_registry";
  const fieldMapping = {
    "查詢車號": "query_number",
    "目前車號": "current_number",
    "前次車號": "last_number",
    "車主": "owner_name",
    "車主証號": "owner_id",
    "郵遞區號": "perm_zip",
    "車主地址": "owner_addr",
    "電話": "tel_number",
    "目前監理站": "current_office",
    "原監理站": "original_office",
    "引擎號碼": "engine_number",
    "車型序號": "vehicle_type",
    "廠牌": "brand",
    "環保種類": "vehicle_classification",
    "顏色": "color",
    "排氣量": "engine_displacement",
    "出廠年月": "year_mfg",
    "發照日期": "license_date",
    "能源類種": "power_type",
    "發牌原因": "license_reason",
    "狀態日期": "status_date",
    "牌照狀況": "license_status",
    "牌照繳回數": "license_return",
    "最近換牌日期": "renewal_license_date",
    "換補照日期": "reissue_license_date",
    "環保違規未結": "illegal_unclosed",
    "禁止異動": "ban",
    "行照有效日": "expiration_date",
    "前車主1": "owner_name_1",
    "前車主証號1": "owner_id_1",
    "前車主地址1": "owner_addr_1",
    "過戶異動日1": "transfer_date_1",
    "動保狀態": "property_secured",
    "總重": "weight",
    "牌照繳回資料": "license_return_info",
    "前車主2": "owner_name_2",
    "前車主証號2": "owner_id_2",
    "前車主地址2": "owner_addr_2",
    "過戶異動日2": "transfer_date_2",
    "前車主3": "owner_name_3",
    "前車主証號3": "owner_id_3",
    "前車主地址3": "owner_addr_3",
    "過戶異動日3": "transfer_date_3",
    "前車主4": "owner_name_4",
    "前車主証號4": "owner_id_4",
    "前車主地址4": "owner_addr_4",
    "過戶異動日4": "transfer_date_4",
    "通訊地址": "current_addr",
    "車身號碼": "serial_number",
    "預定檢驗日期": "next_exam_date",
    "總連結重": "total_weight_tractor",
  };
  handleCsvUpload(req, res, tableName, fieldMapping);
});

// 通用 CSV 上傳處理函數
function handleCsvUpload(req, res, tableName, fieldMapping) {
  const filePath = req.file.path;
  const queryDate = req.body.queryDate?.trim();
  if (!queryDate) {
    return res.status(400).send("查詢日期未提供！");
  }

  const dataRows = [];
  let headersMap = {};

  fs.createReadStream(filePath)
    .pipe(iconv.decodeStream("utf-8"))
    .pipe(csv())
    .on("headers", (headers) => {
      headers.forEach((header) => {
        if (fieldMapping[header]) {
          headersMap[header] = fieldMapping[header];
        } else {
          console.warn(`未對應的 CSV 標題：${header} ${tableName}`);
        }
      });
    })
    .on("data", (row) => {
      const formattedRow = {};
      Object.keys(row).forEach((header) => {
        if (headersMap[header]) {
          formattedRow[headersMap[header]] = row[header]?.trim() || null;
        }
      });

      const rowData = [queryDate];
      Object.values(fieldMapping).forEach((dbField) => {
        rowData.push(formattedRow[dbField] || null);
      });

      dataRows.push(rowData);
    })
    .on("end", () => {
      if (dataRows.length === 0) {
        console.error("CSV 文件無有效數據");
        return res.status(400).send("CSV 文件中無有效數據！");
      }

      const sql = `
        INSERT INTO ${tableName} (${["query_date", ...Object.values(fieldMapping)].join(", ")})
        VALUES ?
      `;

      db.query(sql, [dataRows], (err) => {
        if (err) {
          console.error(`插入 ${tableName} 表失敗:`, err);
          return res.status(500).send(`插入 ${tableName} 表失敗！`);
        }

        fs.unlinkSync(filePath); // 刪除臨時文件
        res.send(`${tableName} 資料已成功上傳！`);
      });
    })
    .on("error", (err) => {
      console.error("讀取 CSV 文件時發生錯誤：", err);
      res.status(500).send("讀取 CSV 文件失敗！");
    });
}



// 啟動伺服器
app.listen(3000, () => {
  console.log("伺服器已啟動：http://localhost:3000");
});
