require("dotenv").config(); // 載入環境變數
const express = require("express");
const { engine } = require("express-handlebars");
const bodyParser = require("body-parser");
const mysql = require("mysql2");
const multer = require("multer");
const csv = require("csv-parser");
const fs = require("fs").promises;
const app = express();
const iconv = require("iconv-lite");
const path = require("path");
const { bikeFieldMapping, carFieldMapping } = require("./fieldMapping");

// 設置模板引擎 (使用 handlebars，並指定預設 layout 為 main)
app.engine("hbs", engine({ extname: ".hbs", defaultLayout: "main" }));
app.set("view engine", "hbs");
app.set("views", "./views");

// 中間件設定：解析 URL 編碼與 JSON 格式請求，同時指定靜態檔案目錄
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(express.static("public"));

// 建立 MySQL 連線池，啟用 keep-alive 相關設定，並設定連線逾時、等待連線等參數
const pool = mysql.createPool({
  host: process.env.DB_HOST,         // 資料庫主機
  user: process.env.DB_USER,         // 資料庫使用者
  password: process.env.DB_PASSWORD, // 資料庫密碼
  database: process.env.DB_DATABASE, // 資料庫名稱
  port: process.env.DB_PORT,         // 資料庫連接埠
  waitForConnections: true,          // 無可用連線時等待新連線
  connectionLimit: 0,               // 最大連線數量，可依需求調整
  queueLimit: 0,                     // 無限排隊等待連線
  connectTimeout: 10000,             // 連線逾時設定 (10 秒)
});

// 測試連線池是否能成功取得連線
pool.getConnection((err, connection) => {
  if (err) {
    console.error("資料庫連線池取得連線失敗:", err);
    return;
  }
  console.log("已成功取得資料庫連線池中的連線");
  connection.release(); // 釋放連線回池中
});

// 首頁路由，渲染 index.hbs
app.get("/", (req, res) => {
  res.render("index");
});

// 匯入車籍資料頁面，渲染 upload_registry.hbs
app.get("/upload-registry", (req, res) => {
  res.render("upload_registry");
});


// 新增 /view-reg 路由，顯示 bike_registry 或 car_registry 資料表所有欄位與所有資料
app.get("/view-reg", async (req, res) => {
  // 1. 從查詢參數中取得 type，若未提供則預設為 "bike"
  const type = req.query.type || "bike";
  
  // 2. 檢查 type 是否正確（僅允許 "bike" 或 "car"）
  if (!["bike", "car"].includes(type)) {
    return res.status(400).send("無效的 type 參數，請使用 'bike' 或 'car'");
  }
  
  // 3. 根據 type 決定目標資料表名稱
  const tableName = type === "bike" ? "bike_registry" : "car_registry";
  
  // 4. 載入儲存在外部檔案的欄位對應資料，key 為資料庫欄位名稱，value 為欲顯示的中文欄位名稱
  const { bikeFieldMapping, carFieldMapping } = require("./fieldMapping");
  const mapping = type === "bike" ? bikeFieldMapping : carFieldMapping;
  
  try {
    // 5. 查詢指定資料表所有資料；rows 為資料內容，fields 為欄位描述資訊
    const [rows, fields] = await pool.promise().query(`SELECT * FROM ${tableName}`);
    
    // 6. 取得資料庫的原始欄位名稱（例如 "query_date", "query_number", ...）
    const dbColumns = fields.map(field => field.name);
    
    // 7. 利用 mapping 轉換原始欄位名稱為顯示用名稱，若 mapping 中未定義則保留原名稱
    const displayColumns = dbColumns.map(col => mapping[col] || col);
    
    // 8. 處理每筆資料：若資料中包含 query_date 欄位，將日期格式轉換成 YYYY/MM/DD 格式
    rows.forEach(row => {
      if (row.query_date) {
        const d = new Date(row.query_date);
        if (!isNaN(d.getTime())) {
          const year = d.getFullYear();
          const month = ("0" + (d.getMonth() + 1)).slice(-2);
          const day = ("0" + d.getDate()).slice(-2);
          row.query_date = `${year}/${month}/${day}`;
        }
      }
    });
    
    // 9. 將 type、displayColumns、原始欄位 key 與資料內容 rows 傳入 view_reg.hbs 模板進行渲染
    // 傳入 keys (原始欄位名稱陣列) 與 columns (顯示用欄位名稱陣列)
    res.render("view_reg", { type, keys: dbColumns, columns: displayColumns, records: rows });
  } catch (error) {
    console.error("查詢資料失敗：", error);
    res.status(500).send("查詢資料失敗，請檢查伺服器日誌！");
  }
});


// 使用 multer 設定記憶體儲存空間，用以處理檔案上傳
const upload_reg = multer({ storage: multer.memoryStorage() });

// 處理車籍資料上傳，路由格式為 /upload-registry/:type，其中 type 為 "bike" 或 "car"
app.post("/upload-registry/:type", upload_reg.single("registryFile"), async (req, res) => {
  const type = req.params.type; // 取得上傳資料類型
  if (!["bike", "car"].includes(type)) {
    // 檢查 type 是否為預期的兩種之一
    return res.status(400).json({ message: "無效的類型參數，應為 'bike' 或 'car'" });
  }

  // 根據 type 設定目標資料表名稱與欄位對應資料 (假設欄位對應資料已從外部檔案引入)
  const tableName = type === "bike" ? "bike_registry" : "car_registry";
  const fieldMapping = type === "bike" ? require("./fieldMapping").bikeFieldMapping : require("./fieldMapping").carFieldMapping;

  // 如果沒有檔案，回傳錯誤訊息
  if (!req.file) {
    return res.status(400).json({ message: "請上傳有效的 CSV 檔案！" });
  }

  const dataRows = [];  // 用於儲存 CSV 解析後的每一筆資料
  const headersMap = {};  // 儲存 CSV 標頭與資料庫欄位名稱的對應關係

  try {
    // 解析 CSV 檔案，若確定檔案為 UTF-8 則可使用下列方式
    const buffer = req.file.buffer;  // 取得上傳的檔案 Buffer
    const stream = iconv.decodeStream("utf8");  // 建立 UTF-8 解碼的讀取串流
    stream.write(buffer);  // 將 Buffer 寫入串流中
    stream.end();       // 結束串流寫入

    // 使用 Promise 等待 CSV 解析完成，並檢查欄位是否與 fieldMapping 一致
    await new Promise((resolve, reject) => {
      stream
        .pipe(csv())  // 利用 csv-parser 解析 CSV
        .on("headers", (csvHeaders) => {
          // 取得預期的欄位 (fieldMapping 的鍵)
          const expectedHeaders = Object.keys(fieldMapping);
          // 檢查 CSV 欄位是否缺少預期欄位
          const missingFields = expectedHeaders.filter(field => !csvHeaders.includes(field));
          // 檢查 CSV 中是否有額外的欄位（非預期欄位）
          const extraFields = csvHeaders.filter(field => !expectedHeaders.includes(field));
          if (missingFields.length > 0 || extraFields.length > 0) {
            console.error("CSV 欄位不一致，缺少：", missingFields, "多餘：", extraFields);
            // 欄位不一致時，reject 並回傳錯誤訊息
            return reject(new Error("CSV 欄位與預期不符。缺少: " + missingFields.join(", ") + "；多餘: " + extraFields.join(", ")));
          }
          // 欄位一致時，建立 CSV 標頭與資料庫欄位的對應關係
          csvHeaders.forEach((header) => {
            if (fieldMapping[header]) {
              headersMap[header] = fieldMapping[header];
            }
          });
        })
        .on("data", (row) => {
          // 處理每一筆資料，轉換成對應的資料庫欄位格式
          const formattedRow = {};
          Object.keys(row).forEach((header) => {
            if (headersMap[header]) {
              formattedRow[headersMap[header]] = row[header]?.trim() || null;
            }
          });
          dataRows.push(formattedRow);
        })
        .on("end", () => {
          console.log("CSV 解析完成，資料筆數:", dataRows.length);
          resolve();
        })
        .on("error", (error) => {
          console.error("CSV 解析錯誤:", error);
          reject(error);
        });
    });

    // 構建 SQL 插入語句，使用 ON DUPLICATE KEY UPDATE 來處理重複資料
    const sql = `
        INSERT INTO ${tableName} (${Object.keys(headersMap).join(", ")})
        VALUES ?
        ON DUPLICATE KEY UPDATE ${Object.keys(headersMap)
          .map((key) => `${key} = VALUES(${key})`)
          .join(", ")}
      `;
    const values = dataRows.map((row) => Object.values(row)); // 將每一筆資料轉換成值陣列

    // 直接利用連線池執行 SQL 查詢，MySQL 連線池會自動管理連線
    await pool.promise().query(sql, [values]);

    // 回傳上傳成功訊息
    res.json({ message: `${type} 資料已成功上傳！` });
  } catch (error) {
    console.error("上傳失敗：", error);
    // 若有錯誤，回傳錯誤訊息給前端
    res.status(400).json({ message: error.message });
  }
});

// 新增案件頁面路由
app.get("/add-case", (req, res) => {
  res.render("add_case");
});
// 處理新增案件的提交請求
app.post("/add-case", async (req, res) => {
  const { caseYear, caseMonth, issueDate, issueDept, issueNumber, vehicleNumbers } = req.body;
  const caseMonthFull = `${caseYear}-${String(caseMonth).padStart(2, "0")}-01`;
  const vehicles = vehicleNumbers.split("\n").map((v) => v.trim()).filter((v) => v);

  try {
    // 插入或更新 source_case
    const sourceCaseSql = "INSERT IGNORE INTO source_case (issue_date, issue_dept, issue_number) VALUES (?, ?, ?)";
    await pool.promise().query(sourceCaseSql, [issueDate, issueDept, issueNumber]);

    let responseMessage = "";

    for (const vehicle of vehicles) {
      // 檢查或插入 cases
      //const caseCheckSql = "SELECT id FROM cases WHERE vehicle_number = ?";
      //const [caseCheckResults] = await pool.promise().query(caseCheckSql, [vehicle]);
      const caseCheckSql = "SELECT id FROM cases WHERE vehicle_number = ? AND case_month = ?";
      const [caseCheckResults] = await pool.promise().query(caseCheckSql, [vehicle, caseMonthFull]);

      let caseId;
      if (caseCheckResults.length > 0) {
        caseId = caseCheckResults[0].id;
      } else {
        const registrySql = `
          SELECT owner_name FROM bike_registry WHERE current_number = ?
          UNION
          SELECT owner_name FROM car_registry WHERE current_number = ?
        `;
        const [registryResults] = await pool.promise().query(registrySql, [vehicle, vehicle]);
        const ownerName = registryResults[0] ? registryResults[0].owner_name : "未知";

        const caseInsertSql = "INSERT INTO cases (vehicle_number, owner_name, case_month) VALUES (?, ?, ?)";
        const [caseInsertResult] = await pool.promise().query(caseInsertSql, [vehicle, ownerName, caseMonthFull]);
        caseId = caseInsertResult.insertId;
      }

      // 插入 case_source_links
      const caseSourceLinksSql = "INSERT IGNORE INTO case_source_links (case_id, issue_number) VALUES (?, ?)";
      await pool.promise().query(caseSourceLinksSql, [caseId, issueNumber]);

      // 插入 source_case_vehicle_links
      const sourceCaseVehicleLinksSql =
        "INSERT IGNORE INTO source_case_vehicle_links (issue_number, vehicle_number) VALUES (?, ?)";
      await pool.promise().query(sourceCaseVehicleLinksSql, [issueNumber, vehicle]);

      // 添加成功訊息
      //responseMessage += `案件車號: ${vehicle}, 來文者: ${issueDept}, 來文文號: ${issueNumber} 已成功新增!<br>`;
      responseMessage += `案件車號: ${vehicle}\n來文者: ${issueDept}\n來文文號: ${issueNumber} 已成功新增!\n`;
    }

    res.json({ message: responseMessage });
  } catch (err) {
    console.error("操作失敗：", err);
    res.status(500).json({ message: "新增案件失敗，請檢查伺服器日誌！" });
  }
})


// 上傳檔案(來文)頁面
app.get("/upload-files", (req, res) => {
  res.render("upload_files");
});

// 配置 Multer，處理上傳的檔案
const storage = multer.diskStorage({
  destination: async (req, file, cb) => {
    try {
      // 確保檔案名稱使用 UTF-8 解碼
      const fileName = Buffer.from(file.originalname, "latin1").toString("utf8");
      const match = fileName.match(/^(\d{8})_(.+)\.pdf$/);

      if (!match) {
        return cb(new Error("檔案名稱格式不正確，應為 YYYYMMDD_issue_number.pdf"));
      }

      const [_, date, issueNumber] = match;
      const year = date.substring(0, 4); // 提取年份
      const month = date.substring(4, 6); // 提取月份

      // 檢查 issue_number 是否存在於 source_case 表中
      const issueCheckSql = "SELECT COUNT(*) AS count FROM source_case WHERE issue_number = ?";
      const [results] = await pool.promise().query(issueCheckSql, [issueNumber]);

      if (results[0].count === 0) {
        return cb(new Error(`無法找到對應的 issue_number: ${issueNumber}`));
      }

      // 動態建立目錄 /uploads/issue_number/YYYY/MM
      const uploadPath = path.join(__dirname, "uploads/issue_number", year, month);
      await fs.mkdir(uploadPath, { recursive: true }); // 確保目錄存在

      // 回傳檔案儲存路徑
      cb(null, uploadPath);
    } catch (err) {
      cb(err);
    }
  },
  filename: (req, file, cb) => {
    // 使用 UTF-8 解碼後的檔案名稱儲存
    const fileName = Buffer.from(file.originalname, "latin1").toString("utf8");
    cb(null, fileName);
  },
});


const upload_issue = multer({ storage });

// 上傳檔案處理邏輯
app.post("/upload-file", upload_issue.array("files", 10), async (req, res) => {
  try {
    const files = req.files;
    const uploadedFiles = [];

    for (const file of files) {
      const fileName = Buffer.from(file.originalname, "latin1").toString("utf8");
      const match = fileName.match(/^(\d{8})_(.+)\.pdf$/);

      if (!match) {
        return res.status(400).json({ message: `檔案名稱格式不正確，應為 YYYYMMDD_issue_number.pdf：${fileName}` });
      }

      const [_, date, issueNumber] = match;
      const filePath = path.join("uploads/issue_number", date.substring(0, 4), date.substring(4, 6), fileName);

      // 更新資料庫
      const updateSql = "UPDATE source_case SET filepath = ? WHERE issue_number = ?";
      const [result] = await pool.promise().query(updateSql, [filePath, issueNumber]);

      if (result.affectedRows === 0) {
        return res.status(400).json({ message: `無法更新 filepath，未找到 issue_number：${issueNumber}` });
      }

      uploadedFiles.push(fileName); // 記錄成功上傳的檔名
    }

    res.status(200).json({ message: "檔案已成功上傳並更新資料庫！", files: uploadedFiles });
  } catch (err) {
    console.error("檔案上傳失敗：", err);
    res.status(500).json({ message: "檔案上傳失敗，請檢查伺服器日誌！" });
  }
});


// 發文通知頁面
app.get("/post-case",(req, res) => {
  res.render("post_case");
});

const uploadPostFile = multer({
  storage: multer.diskStorage({
    destination: async (req, file, cb) => {
      const year = new Date().getFullYear();
      const month = String(new Date().getMonth() + 1).padStart(2, "0");
      const uploadDir = path.join(__dirname, "uploads", "post_case", year.toString(), month);
      await fs.mkdir(uploadDir, { recursive: true });
      cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
      const originalName = Buffer.from(file.originalname, "latin1").toString("utf8"); // 確保檔名使用 UTF-8 編碼
      cb(null, originalName);
    },
  }),
});

// 車號檢查 API
app.post("/check-vehicle-numbers", async (req, res) => {
  const { issueNumber, vehicleNumbers } = req.body;

  // 驗證請求參數是否完整
  if (!issueNumber || !vehicleNumbers) {
    return res.status(400).json({ message: "請提供來文文號和通知車號！" });
  }

  const vehicleList = vehicleNumbers.split("\n").map((v) => v.trim()).filter((v) => v); // 將通知車號轉為清單

  try {
    // 查詢資料庫，獲取對應的車號
    const [results] = await pool.promise().query(
      "SELECT vehicle_number FROM source_case_vehicle_links WHERE issue_number = ?",
      [issueNumber]
    );

    const existingVehicles = results.map((row) => row.vehicle_number); // 提取現有車號
    const checkResults = vehicleList.map((vehicle) => ({
      vehicleNumber: vehicle,
      exists: existingVehicles.includes(vehicle), // 判斷車號是否存在
    }));

    res.json(checkResults); // 回傳檢查結果
  } catch (error) {
    console.error("車號檢查失敗：", error);
    res.status(500).json({ message: "車號檢查失敗！" });
  }
});

// 發文提交路由
app.post("/post-case", uploadPostFile.single("postFile"), async (req, res) => {
  try {
    const { issueNumber, vehicleNumbers, postDate, postNumber } = req.body;
    if (!issueNumber || !vehicleNumbers || !postDate || !postNumber || !req.file) {
      return res.status(400).json({ message: "請提供完整資料！" });
    }

    const vehicleList = vehicleNumbers.split("\n").map((v) => v.trim()).filter((v) => v);
    const year = new Date().getFullYear();
    const month = String(new Date().getMonth() + 1).padStart(2, "0");
    const fileName = Buffer.from(req.file.originalname, "latin1").toString("utf8"); // 再次確保檔名為 UTF-8
    const filePath = `/uploads/post_case/${year}/${month}/${fileName}`; // 使用解碼後的檔名生成 filepath

    // 更新 post_case 表
    await createPool
      .promise()
      .query(
        `INSERT INTO post_case (post_date, post_number, filepath)
         VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE post_date = VALUES(post_date), filepath = VALUES(filepath)`,
        [postDate, postNumber, filePath]
      );

    // 更新 post_case_vehicle_links 表
    for (const vehicle of vehicleList) {
      await pool
        .promise()
        .query(
          `INSERT INTO post_case_vehicle_links (post_number, vehicle_number)
           VALUES (?, ?)
           ON DUPLICATE KEY UPDATE vehicle_number = VALUES(vehicle_number)`,
          [postNumber, vehicle]
        );
    }

    res.json({ message: "發文資料已成功提交！" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "提交失敗！" });
  }
});



// 啟動伺服器，監聽 3000 埠號~~
app.listen(3000, () => {
  console.log("伺服器已啟動：http://localhost:3000");
});

