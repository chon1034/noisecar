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
const session = require("express-session");
const passport = require("passport");
const LocalStrategy = require("passport-local").Strategy;
const bcrypt = require("bcrypt");
const flash = require("connect-flash");
const saltRounds = 10;
const XLSX = require("xlsx"); // 新增 xlsx 套件
const fsSync = require("fs");


// 設置模板引擎，並註冊 ifCond 與 getCellClass 兩個 helper
app.engine("hbs", engine({
  extname: ".hbs",
  defaultLayout: "main",
  helpers: {
    // ifCond 用來在模板中進行比較
    ifCond: function (v1, operator, v2, options) {
      switch (operator) {
        case "==":
          return (v1 == v2) ? options.fn(this) : options.inverse(this);
        default:
          return options.inverse(this);
      }
    },
    // getCellClass 用於 view_reg.hbs 中依據 key 產生 cell class
    getCellClass: function (key) {
      if (key === "current_number") return "current-number";
      if (key === "owner_name") return "owner-name";
      return "";
    }
  }
}));
app.set("view engine", "hbs");
app.set("views", "./views");




// 設定 express-session
app.use(session({
  secret: process.env.SESSION_SECRET || "mySecretKey",  // 請從環境變數讀取或改用安全的字串
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false }  // 若是 HTTPS，則可以設為 true
}));

// 啟用 flash
app.use(flash());


// 初始化 Passport
app.use(passport.initialize());
app.use(passport.session());

// 中間件設定：解析 URL 編碼與 JSON 格式請求，同時指定靜態檔案目錄
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(express.static("public"));

// 設定 express-session
app.use(session({
  secret: process.env.SESSION_SECRET || "mySecretKey", // 請設定安全的 secret
  resave: false,
  saveUninitialized: false
}));

// 初始化 Passport 並使用 session
app.use(passport.initialize());
app.use(passport.session());

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

//檢查認證的 middleware
function ensureAuthenticated(req, res, next) {
  if (req.isAuthenticated()) {
    return next();
  }
  res.redirect("/login");
}



// Passport LocalStrategy 設定
passport.use(new LocalStrategy(async (username, password, done) => {
  try {
    // 查詢用戶資料，假設用戶資料儲存在 users 資料表中
    const [rows] = await pool.promise().query("SELECT * FROM users WHERE username = ?", [username]);
    if (rows.length === 0) {
      return done(null, false, { message: "無效的帳號或密碼" });
    }
    const user = rows[0];
    const match = await bcrypt.compare(password, user.password);
    if (!match) {
      return done(null, false, { message: "無效的帳號或密碼" });
    }
    return done(null, user);
  } catch (err) {
    return done(err);
  }
}));

// 序列化與反序列化用戶
passport.serializeUser((user, done) => {
  done(null, user.id);
});
passport.deserializeUser(async (id, done) => {
  try {
    const [rows] = await pool.promise().query("SELECT * FROM users WHERE id = ?", [id]);
    if (rows.length === 0) {
      return done(new Error("用戶不存在"));
    }
    done(null, rows[0]);
  } catch (err) {
    done(err);
  }
});

// Middleware: 檢查是否已認證
function ensureAuthenticated(req, res, next) {
  if (req.isAuthenticated()) {
    return next();
  }
  res.redirect("/login");
}

// 首頁路由，渲染 index.hbs
//只有已登入的使用者才能看到 index.hbs。如果未認證，使用者會被導向 /login。
app.get("/", ensureAuthenticated, (req, res) => {
  res.render("index", { user: req.user,
    title: "Noisecar",
    username: req.user.username  // 將從資料庫查詢到的 username 傳給模板
  });
});

// 登入頁面，將 flash 訊息傳遞給模板
app.get("/login", (req, res) => {
  res.render("login", {
    errorMessage: req.flash("error"),
    title: "Noisecar - 登入"
  });
});

// 登入請求，啟用 failureFlash：true 讓錯誤訊息儲存至 flash
app.post("/login", passport.authenticate("local", {
  successRedirect: "/",  // 登入成功後導向首頁 (index.hbs)
  failureRedirect: "/login",
  failureFlash: true
}));

// 登出路由
app.get("/logout", (req, res, next) => {
  req.logout((err) => {
    if (err) { return next(err); }
    res.redirect("/login");
  });
});



app.get("/users", (req, res) => {
  res.render("users",{
    title: "Noisecar"
  });
});

app.post("/users", async (req, res) => {
  try {
    const { username, password, email, name } = req.body;
    // 加密密碼
    const hashedPassword = await bcrypt.hash(password, saltRounds);
    // 將新用戶資料插入資料庫 (這裡假設你的 users 資料表已存在)
    const sql = "INSERT INTO users (username, password, email, name) VALUES (?, ?, ?, ?)";
    const [result] = await pool.promise().query(sql, [username, hashedPassword, email, name]);
    res.render("users", { 
      message: "新增成功！", 
      userId: result.username, 
      username, 
      status: "success" 
    });
  } catch (err) {
    console.error("新增用戶失敗：", err);
    // 如果錯誤代碼為 ER_DUP_ENTRY，就顯示帳號重複訊息
    if (err.code === 'ER_DUP_ENTRY') {
      res.render("users", { 
        message: "該帳號已被註冊，請更換帳號", 
        status: "error" 
      });
    } else {
      res.render("users", { 
        message: "新增用戶失敗，請檢查伺服器日誌", 
        status: "error" 
      });
    }
  }
});


// 匯入車籍資料頁面，渲染 upload_registry.hbs
app.get("/upload-registry", (req, res) => {
  res.render("upload_registry",{
    title: "Noisecar"
  });
});

// 新增 /view-reg 路由，顯示 bike_registry 或 car_registry 資料表所有欄位與所有資料
app.get("/view-reg", ensureAuthenticated , async (req, res) => {
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
    res.render("view_reg", { title: "Noisecar", type, keys: dbColumns, columns: displayColumns, records: rows });
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
  res.render("add_case",{
    title: "Noisecar"
  });
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
  res.render("upload_files",{
    title: "Noisecar"
  });
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
  res.render("post_case",{
    title: "Noisecar"
  });
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
    await pool.promise().query(
        `INSERT INTO post_case (post_date, post_number, filepath)
         VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE post_date = VALUES(post_date), filepath = VALUES(filepath)`,
        [postDate, postNumber, filePath]
      );

    // 更新 post_case_vehicle_links 表
    for (const vehicle of vehicleList) {
      await pool.promise().query(
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

// 使用 multer 設定記憶體儲存，處理上傳 Excel 檔案
const splitUpload = multer({ storage: multer.memoryStorage() });
/**
 * POST /split
 * 功能：
 * 1. 驗證上傳檔案的第一列標題是否符合預期：
 *    "項次,受文者名稱,對應機關名稱,郵遞區號,地址"
 * 2. 第一需求：從「受文者名稱,對應機關名稱,郵遞區號,地址」擴充成新欄位：
 *    "本別,受文者名稱,對應機關名稱,含附件,發文方式,郵遞區號,地址,群組名稱"
 *    固定值設定：本別皆填 "正本"，發文方式皆填 "郵寄"，含附件與群組名稱保留空白
 *    輸出 CSV 檔案（UTF8 編碼）
 * 3. 第二需求：將「受文者名稱」改為「受文者」後，從第6欄位依序輸出
 *    使用 tab 作為分隔符號，輸出 TXT 檔案
 * 4. 最後將產生的檔案存入 public/downloads 並回傳下載路徑
 */

app.get("/split",(req, res) => {
  res.render("split",{
    title: "Noisecar"
  });
});

app.post("/split", splitUpload.single("excelFile"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "請上傳 Excel 檔案" });
    }

    // 讀取上傳的 Excel 檔案 (使用 Buffer)
    const workbook = XLSX.read(req.file.buffer, { type: "buffer" });
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    // 以二維陣列取得資料，第一列為 header
    const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

    if (!rows || rows.length < 2) {
      return res.status(400).json({ error: "檔案內容不足，無法處理。" });
    }

    // 檢查標題是否符合預期
    // CSV 部分只檢查前 5 欄
    const expectedCsvHeader = ["項次", "受文者名稱", "對應機關名稱", "郵遞區號", "地址"];
    const header = rows[0];
    for (let i = 0; i < expectedCsvHeader.length; i++) {
      if (header[i] !== expectedCsvHeader[i]) {
        return res.status(400).json({ error: "檔案標題不符預期格式，前五欄必須為：" + expectedCsvHeader.join(", ") });
      }
    }
    // 後面的欄位（從第6欄開始）將作為 txt 的標題來源

    // ──────────────────────────────
    // 產生 CSV 檔案
    // 新欄位：本別,受文者名稱,對應機關名稱,含附件,發文方式,郵遞區號,地址,群組名稱
    // 固定填入："正本"、""、""、"郵寄"、"" 分別對應本別、含附件、群組名稱
    // ──────────────────────────────
    const csvHeader = ["本別", "受文者名稱", "對應機關名稱", "含附件", "發文方式", "郵遞區號", "地址", "群組名稱"];
    const csvRows = [];
    csvRows.push(csvHeader.join(','));

    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      const newRow = [
        "正本",            // 本別
        row[1] || '',      // 受文者名稱
        row[2] || '',      // 對應機關名稱
        '',                // 含附件
        "郵寄",            // 發文方式
        row[3] || '',      // 郵遞區號
        row[4] || '',      // 地址
        ''                 // 群組名稱
      ];
      // 若欄位中含有逗號，則加上雙引號
      const formattedRow = newRow.map(field => {
        if (typeof field === "string" && field.includes(",")) {
          return `"${field}"`;
        }
        return field;
      });
      csvRows.push(formattedRow.join(','));
    }
    const csvOutput = csvRows.join("\n");

    // ──────────────────────────────
    // 產生 TXT 檔案
    // TXT 的標題：
    //  第一欄固定為 "受文者"
    //  之後的標題依上傳檔案從第6欄開始的標題產生
    // 使用 tab (\t) 分隔
    // ──────────────────────────────
    const txtHeader = [];
    txtHeader.push("受文者"); // 第一欄固定
    // 從上傳 header 的第6欄開始
    for (let i = 5; i < header.length; i++) {
      txtHeader.push(header[i] || '');
    }
    const txtRows = [];
    txtRows.push(txtHeader.join('\t'));

    // 產生每一筆資料
    // 第一欄依然使用上傳的「受文者名稱」（即 row[1]），之後的欄位從第6欄開始對應輸出
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      const newRow = [];
      newRow.push(row[1] || ''); // 第一欄：受文者名稱
      // 從第6欄開始的每一個欄位
      for (let j = 5; j < header.length; j++) {
        newRow.push(row[j] || '');
      }
      txtRows.push(newRow.join('\t'));
    }
    const txtOutput = txtRows.join("\n");

    // ──────────────────────────────
    // 將產生的檔案存放到 public/downloads 目錄，並回傳下載路徑
    // ──────────────────────────────
    const downloadsDir = path.join(__dirname, "public", "downloads");
    if (!fsSync.existsSync(downloadsDir)) {
      await fs.mkdir(downloadsDir, { recursive: true });
    }
    // 使用上傳檔案的原始檔名（去除原副檔名）作為輸出檔案名稱
    const originalName = Buffer.from(req.file.originalname, "latin1").toString("utf8");
    const baseName = path.parse(originalName).name;
    const csvFileName = `${baseName}_匯入受文者群組.csv`;
    const txtFileName = `${baseName}_內文分繕設定.txt`;
    const csvFilePath = path.join(downloadsDir, csvFileName);
    const txtFilePath = path.join(downloadsDir, txtFileName);

    // 加上 BOM，確保 CSV 與 TXT 為 UTF-8 並包含 BOM
    const BOM = "\uFEFF";
    const csvOutputWithBOM = BOM + csvOutput;
    const txtOutputWithBOM = BOM + txtOutput;
    await fs.writeFile(csvFilePath, csvOutputWithBOM, { encoding: "utf8" });
    await fs.writeFile(txtFilePath, txtOutputWithBOM, { encoding: "utf8" });

    res.json({
      csvPath: `/downloads/${csvFileName}`,
      txtPath: `/downloads/${txtFileName}`
    });
  } catch (error) {
    console.error("檔案處理錯誤:", error);
    res.status(500).json({ error: "伺服器處理錯誤" });
  }
});



app.get("/query-case", (req, res) => {
  res.render("query_case",{
    title: "Noisecar"
  });
});



// 啟動伺服器，監聽 3000 埠號~~
app.listen(3000, () => {
  console.log("伺服器已啟動：http://localhost:3000");
});
