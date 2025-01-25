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
  host: "35.212.235.57",
  user: "ccy102u",
  password: "A10341131bc*",
  database: "noisecarDB",
  port: 3306,
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

  const casesData = [];
  const sourceCaseVehicleLinksData = [];
  const caseSourceLinksData = [];

  try {
    // 查詢車主名稱並填充數據
    for (const vehicle of vehicles) {
      const registrySql = `
        SELECT owner_name FROM bike_registry WHERE query_number = ?
        UNION
        SELECT owner_name FROM car_registry WHERE query_number = ?
      `;

      const [results] = await db.promise().query(registrySql, [vehicle, vehicle]);
      const owner_name = results[0] ? results[0].owner_name : "未知";

      casesData.push([vehicle, owner_name, caseMonthFull]);
      sourceCaseVehicleLinksData.push([issueNumber, vehicle]);
    }

    // 如果沒有有效數據，則返回錯誤
    if (casesData.length === 0) {
      return res.status(400).json({ message: "無有效案件數據，請檢查輸入！" });
    }

    // 插入 cases 表
    const casesSql = "INSERT IGNORE INTO cases (vehicle_number, owner_name, case_month) VALUES ?";
    await db.promise().query(casesSql, [casesData]);

    // 插入 source_case 表
    const sourceCaseSql = "INSERT IGNORE INTO source_case (issue_date, issue_dept, issue_number) VALUES ?";
    await db.promise().query(sourceCaseSql, [[[issueDate, issueDept, issueNumber]]]);

    // 插入 source_case_vehicle_links 表
    const sourceCaseVehicleLinksSql =
      "INSERT IGNORE INTO source_case_vehicle_links (issue_number, vehicle_number) VALUES ?";
    await db.promise().query(sourceCaseVehicleLinksSql, [sourceCaseVehicleLinksData]);

    // 查詢插入的 cases 與 source_case 關聯數據
    const caseSourceQuery = `
      SELECT c.id AS case_id, sc.issue_number
      FROM cases c
      JOIN source_case_vehicle_links scvl ON c.vehicle_number = scvl.vehicle_number
      JOIN source_case sc ON scvl.issue_number = sc.issue_number
      WHERE c.vehicle_number IN (?) AND sc.issue_number = ?;
    `;
    const [caseSourceResults] = await db.promise().query(caseSourceQuery, [vehicles, issueNumber]);

    // 構建 case_source_links 表插入數據
    caseSourceResults.forEach(({ case_id, issue_number }) => {
      caseSourceLinksData.push([case_id, issue_number]);
    });

    if (caseSourceLinksData.length > 0) {
      const caseSourceLinksSql = "INSERT IGNORE INTO case_source_links (case_id, issue_number) VALUES ?";
      await db.promise().query(caseSourceLinksSql, [caseSourceLinksData]);
    }

    // 返回成功響應
    res.json({ message: "案件已成功新增並關聯！" });
  } catch (err) {
    console.error("操作失敗：", err);
    res.status(500).json({ message: "新增案件失敗，請檢查伺服器日誌！" });
  }
});


// 處理機車車籍上傳
app.post("/upload-bike-registry", upload.single("bikeFile"), (req, res) => {
  const filePath = req.file.path;
  const queryDate = req.body.queryDate?.trim(); // 表單中的查詢日期
  const bikeData = [];
  let headersMap = {}; // 用於存儲標題與欄位的映射

  fs.createReadStream(filePath)
    .pipe(iconv.decodeStream("utf-8")) // 讀取 UTF-8-SIG 編碼
    .pipe(csv())
    .on("headers", (headers) => {
      console.log("CSV 標題列：", headers); // 打印標題
      const tableComments = {
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
        "前車主證號1": "owner_id_1",
        "前車主地址1": "owner_addr_1",
        "過戶異動日1": "transfer_date_1",
        "前車主2": "owner_name_2",
        "前車主證號2": "owner_id_2",
        "前車主地址2": "owner_addr_2",
        "異動過戶日2": "transfer_date_2",
        "前車主3": "owner_name_3",
        "前車主證號3": "owner_id_3",
        "前車主地址3": "owner_addr_3",
        "異動過戶日3": "transfer_date_3",
        "前車主4": "owner_name_4",
        "證號4": "owner_id_4",
        "前車主地址4": "owner_addr_4",
        "異動過戶日4": "transfer_date_4",
        "動保狀態": "property_secured",
        "通訊地址": "current_addr",
        "型式": "vehicle_type",
        "車身號碼": "serial_number",
      };

      headers.forEach((header) => {
        if (tableComments[header]) {
          headersMap[header] = tableComments[header];
        }
      });
    })
    .on("data", (row) => {
      // 根據對應關係轉換數據
      const formattedRow = {};
      Object.keys(row).forEach((header) => {
        if (headersMap[header]) {
          formattedRow[headersMap[header]] = row[header]?.trim();
        }
      });

      bikeData.push([
        queryDate,
        formattedRow.query_number,
        formattedRow.current_number,
        formattedRow.last_number,
        formattedRow.owner_name,
        formattedRow.owner_id,
        formattedRow.perm_zip,
        formattedRow.owner_addr,
        formattedRow.tel_number,
        formattedRow.current_office,
        formattedRow.original_office,
        formattedRow.engine_number,
        formattedRow.brand,
        formattedRow.vehicle_classification,
        formattedRow.color,
        formattedRow.engine_displacement,
        formattedRow.year_mfg,
        formattedRow.license_date,
        formattedRow.power_type,
        formattedRow.license_reason,
        formattedRow.status_date,
        formattedRow.license_status,
        formattedRow.license_return,
        formattedRow.renewal_license_date,
        formattedRow.reissue_license_date,
        formattedRow.illegal_unclosed,
        formattedRow.ban,
        formattedRow.expiration_date,
        formattedRow.owner_name_1,
        formattedRow.owner_id_1,
        formattedRow.owner_addr_1,
        formattedRow.transfer_date_1,
        formattedRow.owner_name_2,
        formattedRow.owner_id_2,
        formattedRow.owner_addr_2,
        formattedRow.transfer_date_2,
        formattedRow.owner_name_3,
        formattedRow.owner_id_3,
        formattedRow.owner_addr_3,
        formattedRow.transfer_date_3,
        formattedRow.owner_name_4,
        formattedRow.owner_id_4,
        formattedRow.owner_addr_4,
        formattedRow.transfer_date_4,
        formattedRow.property_secured,
        formattedRow.current_addr,
        formattedRow.vehicle_type,
        formattedRow.serial_number,
      ]);
    })
    .on("end", () => {
      if (bikeData.length === 0) {
        console.error("CSV 文件無有效數據");
        return res.status(400).send("CSV 文件中無有效數據！");
      }

      const bikeSql = `
        INSERT INTO bike_registry (
          query_date, query_number, current_number, last_number, owner_name, owner_id, perm_zip, owner_addr, tel_number, current_office,
          original_office, engine_number, brand, vehicle_classification, color, engine_displacement, year_mfg, license_date, power_type,
          license_reason, status_date, license_status, license_return, renewal_license_date, reissue_license_date, illegal_unclosed, ban,
          expiration_date, owner_name_1, owner_id_1, owner_addr_1, transfer_date_1, owner_name_2, owner_id_2, owner_addr_2, transfer_date_2,
          owner_name_3, owner_id_3, owner_addr_3, transfer_date_3, owner_name_4, owner_id_4, owner_addr_4, transfer_date_4,
          property_secured, current_addr, vehicle_type, serial_number
        ) VALUES ?
      `;

      db.query(bikeSql, [bikeData], (err) => {
        if (err) {
          console.error("插入 bike_registry 表失敗:", err);
          return res.status(500).send("插入機車車籍資料失敗！");
        }

        fs.unlinkSync(filePath); // 刪除臨時文件
        res.send("機車車籍資料已成功上傳！");
      });
    })
    .on("error", (err) => {
      console.error("讀取 CSV 文件時發生錯誤：", err);
      res.status(500).send("讀取 CSV 文件失敗！");
    });
});





// 處理汽車車籍上傳
app.post("/upload-car-registry", upload.single("carFile"), (req, res) => {
  const filePath = req.file.path;
  const queryDate = req.body.queryDate?.trim(); // 表單中的查詢日期
  const carData = [];
  let headersMap = {}; // 用於存儲標題與欄位的映射

  fs.createReadStream(filePath)
    .pipe(iconv.decodeStream("utf-8")) // 假設文件是 UTF-8 或 UTF-8-SIG
    .pipe(csv())
    .on("headers", (headers) => {
      // 定義 CSV 標題與資料庫欄位的對應關係
      const tableComments = {
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

      // 建立標題與欄位的對應
      headers.forEach((header) => {
        if (tableComments[header]) {
          headersMap[header] = tableComments[header];
        }
      });
      // 確保所有 CSV 標題都有對應欄位
      headers.forEach((header) => {
        if (!headersMap[header]) {
          console.warn(`未對應的 CSV 標題：${header}`);
        }
      });
    })
    .on("data", (row) => {
      const formattedRow = {};
      // 將 CSV 數據對應到資料庫欄位
      Object.keys(row).forEach((header) => {
        if (headersMap[header]) {
          formattedRow[headersMap[header]] = row[header];
        }
      });

      carData.push([
        queryDate,
        formattedRow.query_number,
        formattedRow.current_number,
        formattedRow.last_number,
        formattedRow.owner_name,
        formattedRow.owner_id,
        formattedRow.perm_zip,
        formattedRow.owner_addr,
        formattedRow.tel_number,
        formattedRow.current_office,
        formattedRow.original_office,
        formattedRow.engine_number,
        formattedRow.vehicle_type,
        formattedRow.brand,
        formattedRow.vehicle_classification,
        formattedRow.color,
        formattedRow.engine_displacement,
        formattedRow.year_mfg,
        formattedRow.license_date,
        formattedRow.power_type,
        formattedRow.license_reason,
        formattedRow.status_date,
        formattedRow.license_status,
        formattedRow.license_return,
        formattedRow.renewal_license_date,
        formattedRow.reissue_license_date,
        formattedRow.illegal_unclosed,
        formattedRow.ban,
        formattedRow.expiration_date,
        formattedRow.owner_name_1,
        formattedRow.owner_id_1,
        formattedRow.owner_addr_1,
        formattedRow.transfer_date_1,
        formattedRow.property_secured,
        formattedRow.weight,
        formattedRow.license_return_info,
        formattedRow.owner_name_2,
        formattedRow.owner_id_2,
        formattedRow.owner_addr_2,
        formattedRow.transfer_date_2,
        formattedRow.owner_name_3,
        formattedRow.owner_id_3,
        formattedRow.owner_addr_3,
        formattedRow.transfer_date_3,
        formattedRow.owner_name_4,
        formattedRow.owner_id_4,
        formattedRow.owner_addr_4,
        formattedRow.transfer_date_4,
        formattedRow.current_addr,
        formattedRow.serial_number,
        formattedRow.next_exam_date,
        formattedRow.total_weight_tractor,
      ]);
    })
    .on("end", () => {
      if (carData.length === 0) {
        console.error("CSV 文件無有效數據");
        return res.status(400).send("CSV 文件中無有效數據！");
      }

      const carSql = `
        INSERT INTO car_registry (
          query_date, query_number, current_number, last_number, owner_name, owner_id, perm_zip, owner_addr, tel_number, current_office,
          original_office, engine_number, vehicle_type, brand, vehicle_classification, color, engine_displacement, year_mfg, license_date,
          power_type, license_reason, status_date, license_status, license_return, renewal_license_date, reissue_license_date,
          illegal_unclosed, ban, expiration_date, owner_name_1, owner_id_1, owner_addr_1, transfer_date_1, property_secured, weight,
          license_return_info, owner_name_2, owner_id_2, owner_addr_2, transfer_date_2, owner_name_3, owner_id_3, owner_addr_3,
          transfer_date_3, owner_name_4, owner_id_4, owner_addr_4, transfer_date_4, current_addr, serial_number, next_exam_date,
          total_weight_tractor
        ) VALUES ?
      `;

      db.query(carSql, [carData], (err) => {
        if (err) {
          console.error("插入 car_registry 表失敗:", err);
          return res.status(500).send("插入汽車車籍失敗！");
        }

        fs.unlinkSync(filePath); // 刪除臨時文件
        res.send("汽車車籍已成功上傳！");
      });
    })
    .on("error", (err) => {
      console.error("讀取 CSV 文件時發生錯誤：", err);
      res.status(500).send("讀取 CSV 文件失敗！");
    });
});



// 啟動伺服器
app.listen(3000, () => {
  console.log("伺服器已啟動：http://localhost:3000");
});
